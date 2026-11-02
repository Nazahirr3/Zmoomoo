import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAccountStore } from "./account-store.js";
import { createJoinTokenService } from "./account-api.js";

test("Discord accounts, sessions, stats, names, and mutes persist in the store", () => {
    const store = createAccountStore(":memory:");
    try {
        const user = store.findOrCreateDiscordUser("123456789012345678");
        assert.match(user.username, /^Player[a-f0-9]{6}$/);
        assert.deepEqual(store.getProfile(user.id).stats, {
            kills: 0,
            deaths: 0,
            best_score: 0,
            play_seconds: 0,
            damage: 0,
            healing: 0,
            wood: 0,
            food: 0,
            stone: 0,
            gold: 0,
            animal_kills: 0,
            boss_kills: 0,
            animal_damage: 0,
            best_kills: 0,
            lives: 0
        });

        const session = store.createSession(user.id);
        assert.equal(store.getSession(session.token).id, user.id);
        assert.equal(store.updateUsername(user.id, "Yandel"), true);
        assert.equal(store.updateUsername(user.id, "NewName"), false);

        store.recordMatch(user.id, {
            kills: 4,
            score: 800,
            damage: 350,
            healing: 80,
            wood: 40,
            food: 20,
            stone: 10,
            gold: 5,
            animal_kills: 3,
            boss_kills: 1,
            animal_damage: 1200,
            lives: 1
        }, 120, true);
        assert.deepEqual(store.getProfile(user.id).stats, {
            kills: 4,
            deaths: 1,
            best_score: 800,
            play_seconds: 120,
            damage: 350,
            healing: 80,
            wood: 40,
            food: 20,
            stone: 10,
            gold: 5,
            animal_kills: 3,
            boss_kills: 1,
            animal_damage: 1200,
            best_kills: 4,
            lives: 1
        });

        store.savePunishment(user.id, 2, 1000, 2000);
        assert.deepEqual(store.getPunishment(user.id), {
            offense_count: 2,
            last_offense_at: 1000,
            muted_until: 2000
        });

        store.deleteUser(user.id);
        assert.equal(store.getSession(session.token), null);
        assert.equal(store.getProfile(user.id), null);
    } finally {
        store.close();
    }
});

test("existing account databases gain username cooldown tracking", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "zmoomoo-account-"));
    const databasePath = path.join(directory, "accounts.sqlite");
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            discord_id TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            created_at INTEGER NOT NULL,
            last_login_at INTEGER NOT NULL,
            banned_until INTEGER,
            ban_reason TEXT
        );
        CREATE TABLE stats (
            user_id INTEGER PRIMARY KEY,
            kills INTEGER NOT NULL DEFAULT 0,
            deaths INTEGER NOT NULL DEFAULT 0,
            best_score INTEGER NOT NULL DEFAULT 0,
            play_seconds INTEGER NOT NULL DEFAULT 0
        );
    `);
    legacyDatabase.close();

    const store = createAccountStore(databasePath);
    try {
        const user = store.findOrCreateDiscordUser("123456789012345678");
        assert.equal(store.updateUsername(user.id, "Yandel"), true);
        assert.equal(store.getProfile(user.id).stats.animal_kills, 0);
    } finally {
        store.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("join tokens are signed, expire, and can only be used once", () => {
    const store = createAccountStore(":memory:");
    const joinTokens = createJoinTokenService(store, "0123456789abcdef0123456789abcdef");
    try {
        const token = joinTokens.create(null);
        assert.equal(joinTokens.verify(token).userId, null);
        assert.equal(joinTokens.verify(token), null);

        const altered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
        assert.equal(joinTokens.verify(altered), null);

        const expired = joinTokens.create(null);
        const realNow = Date.now;
        Date.now = () => realNow() + 61 * 1000;
        try {
            assert.equal(joinTokens.verify(expired), null);
        } finally {
            Date.now = realNow;
        }
    } finally {
        store.close();
    }
});
