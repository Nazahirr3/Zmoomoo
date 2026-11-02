import { randomBytes, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
const DEFAULT_DB_PATH = path.join(DATA_DIR, "accounts.sqlite");
const SESSION_LENGTH = 30 * 24 * 60 * 60 * 1000;

function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

export function createAccountStore(dbPath = process.env.ACCOUNT_DB_PATH || DEFAULT_DB_PATH) {
    if (dbPath !== ":memory:") {
        mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }

    const db = new DatabaseSync(dbPath);
    db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            discord_id TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            username_changed_at INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_login_at INTEGER NOT NULL,
            banned_until INTEGER,
            ban_reason TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS stats (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            kills INTEGER NOT NULL DEFAULT 0,
            deaths INTEGER NOT NULL DEFAULT 0,
            best_score INTEGER NOT NULL DEFAULT 0,
            play_seconds INTEGER NOT NULL DEFAULT 0,
            damage INTEGER NOT NULL DEFAULT 0,
            healing INTEGER NOT NULL DEFAULT 0,
            wood INTEGER NOT NULL DEFAULT 0,
            food INTEGER NOT NULL DEFAULT 0,
            stone INTEGER NOT NULL DEFAULT 0,
            gold INTEGER NOT NULL DEFAULT 0,
            animal_kills INTEGER NOT NULL DEFAULT 0,
            boss_kills INTEGER NOT NULL DEFAULT 0,
            animal_damage INTEGER NOT NULL DEFAULT 0,
            best_kills INTEGER NOT NULL DEFAULT 0,
            lives INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS chat_punishments (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            offense_count INTEGER NOT NULL DEFAULT 0,
            last_offense_at INTEGER NOT NULL DEFAULT 0,
            muted_until INTEGER NOT NULL DEFAULT 0
        );
    `);
    const userColumns = db.prepare("PRAGMA table_info(users)").all();
    if (!userColumns.some(column => column.name === "username_changed_at")) {
        db.exec("ALTER TABLE users ADD COLUMN username_changed_at INTEGER NOT NULL DEFAULT 0");
    }
    const statColumns = db.prepare("PRAGMA table_info(stats)").all();
    const existingStatColumns = new Set(statColumns.map(column => column.name));
    for (const column of [
        "damage", "healing", "wood", "food", "stone", "gold", "animal_kills",
        "boss_kills", "animal_damage", "best_kills", "lives"
    ]) {
        if (!existingStatColumns.has(column)) {
            db.exec(`ALTER TABLE stats ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
        }
    }

    const findUserByDiscordId = db.prepare("SELECT * FROM users WHERE discord_id = ?");
    const findUserById = db.prepare("SELECT * FROM users WHERE id = ?");
    const findUserBySession = db.prepare(`
        SELECT users.* FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `);
    const findStats = db.prepare("SELECT * FROM stats WHERE user_id = ?");
    const findPunishment = db.prepare("SELECT offense_count, last_offense_at, muted_until FROM chat_punishments WHERE user_id = ?");

    function findOrCreateDiscordUser(discordId) {
        const now = Date.now();
        let user = findUserByDiscordId.get(discordId);
        if (user) {
            db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, user.id);
            return findUserById.get(user.id);
        }

        for (let attempt = 0; attempt < 5; attempt++) {
            const username = "Player" + randomBytes(3).toString("hex").slice(0, 6);
            try {
                const result = db.prepare(`
                    INSERT INTO users (discord_id, username, created_at, last_login_at)
                    VALUES (?, ?, ?, ?)
                `).run(discordId, username, now, now);
                const userId = Number(result.lastInsertRowid);
                db.prepare("INSERT INTO stats (user_id) VALUES (?)").run(userId);
                db.prepare("INSERT INTO chat_punishments (user_id) VALUES (?)").run(userId);
                return findUserById.get(userId);
            } catch (error) {
                if (!String(error.message).includes("users.username")) throw error;
            }
        }

        throw new Error("Could not create a unique account name");
    }

    function createSession(userId) {
        const token = randomBytes(32).toString("base64url");
        const now = Date.now();
        db.prepare(`
            INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(hashToken(token), userId, now, now + SESSION_LENGTH);
        db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
        return { token, expiresAt: now + SESSION_LENGTH };
    }

    function getSession(token) {
        if (!token) return null;
        const now = Date.now();
        return findUserBySession.get(hashToken(token), now) || null;
    }

    function deleteSession(token) {
        if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    }

    function deleteUser(userId) {
        db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    }

    function updateUsername(userId, username) {
        const now = Date.now();
        return db.prepare(`
            UPDATE users SET username = ?, username_changed_at = ?
            WHERE id = ? AND (username_changed_at = 0 OR username_changed_at <= ?)
        `).run(username, now, userId, now - 24 * 60 * 60 * 1000).changes > 0;
    }

    function getProfile(userId) {
        const user = findUserById.get(userId);
        if (!user) return null;
        const stats = findStats.get(userId);
        return {
            id: Number(user.id),
            username: user.username,
            createdAt: Number(user.created_at),
            stats: stats ? Object.fromEntries(
                Object.entries(stats).filter(([key]) => key !== "user_id")
            ) : {
                kills: 0, deaths: 0, best_score: 0, play_seconds: 0, damage: 0,
                healing: 0, wood: 0, food: 0, stone: 0, gold: 0, animal_kills: 0,
                boss_kills: 0, animal_damage: 0, best_kills: 0, lives: 0
            }
        };
    }

    function getUserById(userId) {
        return findUserById.get(userId) || null;
    }

    function recordMatch(userId, matchStats, seconds, died) {
        if (!userId) return;
        const stats = matchStats || {};
        const value = key => Math.max(0, Math.floor(Number(stats[key]) || 0));
        db.prepare(`
            INSERT INTO stats (
                user_id, kills, deaths, best_score, play_seconds, damage, healing,
                wood, food, stone, gold, animal_kills, boss_kills, animal_damage,
                best_kills, lives
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                kills = kills + excluded.kills,
                deaths = deaths + excluded.deaths,
                best_score = MAX(best_score, excluded.best_score),
                play_seconds = play_seconds + excluded.play_seconds,
                damage = damage + excluded.damage,
                healing = healing + excluded.healing,
                wood = wood + excluded.wood,
                food = food + excluded.food,
                stone = stone + excluded.stone,
                gold = gold + excluded.gold,
                animal_kills = animal_kills + excluded.animal_kills,
                boss_kills = boss_kills + excluded.boss_kills,
                animal_damage = animal_damage + excluded.animal_damage,
                best_kills = MAX(best_kills, excluded.best_kills),
                lives = lives + excluded.lives
        `).run(
            userId,
            value("kills"),
            died ? 1 : 0,
            value("score"),
            Math.max(0, Math.floor(Number(seconds) || 0)),
            value("damage"),
            value("healing"),
            value("wood"),
            value("food"),
            value("stone"),
            value("gold"),
            value("animal_kills"),
            value("boss_kills"),
            value("animal_damage"),
            value("kills"),
            value("lives")
        );
    }

    function getPunishment(userId) {
        const punishment = findPunishment.get(userId);
        return punishment ? { ...punishment } : { offense_count: 0, last_offense_at: 0, muted_until: 0 };
    }

    function savePunishment(userId, offenseCount, lastOffenseAt, mutedUntil) {
        db.prepare(`
            INSERT INTO chat_punishments (user_id, offense_count, last_offense_at, muted_until)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                offense_count = excluded.offense_count,
                last_offense_at = excluded.last_offense_at,
                muted_until = excluded.muted_until
        `).run(userId, offenseCount, lastOffenseAt, mutedUntil);
    }

    return {
        close: () => db.close(),
        createSession,
        deleteSession,
        deleteUser,
        findOrCreateDiscordUser,
        getProfile,
        getPunishment,
        getSession,
        getUserById,
        recordMatch,
        savePunishment,
        updateUsername
    };
}

export { SESSION_LENGTH };
