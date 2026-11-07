import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHmac } from "node:crypto";
import { createAccountStore } from "./account-store.js";
import { registerPrivateAdminApi } from "./private-admin-api.js";

const API_KEY = "test-admin-api-key-012345678901234567890123";
const EXECUTOR = "123456789012345678";

async function withApi(callback, logAction) {
    const previousKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = API_KEY;
    const app = express();
    app.use(express.json());
    const store = createAccountStore(":memory:");
    registerPrivateAdminApi(app, { store, logAction });
    const server = await new Promise(resolve => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
        await callback(server, store);
    } finally {
        await new Promise(resolve => server.close(resolve));
        store.close();
        if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
        else process.env.ADMIN_API_KEY = previousKey;
    }
}

async function request(server, path, body, overrides = {}) {
    const timestamp = String(Date.now());
    const executor = overrides.executor || EXECUTOR;
    const encodedBody = JSON.stringify(body);
    const payload = `${timestamp}.${executor}.${path}.${encodedBody}`;
    const signature = createHmac("sha256", API_KEY).update(payload).digest("base64url");
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "zmoomoo-api-key": overrides.key || API_KEY,
            "x-zmoomoo-executor": executor,
            "x-zmoomoo-timestamp": timestamp,
            "x-zmoomoo-signature": overrides.signature || signature
        },
        body: encodedBody
    });
}

test("private API rejects invalid authentication and accepts signed executor context", async () => {
    await withApi(async (server, store) => {
        const user = store.findOrCreateDiscordUser("234567890123456789");
        const denied = await request(server, "/api/private/account/ban", {
            discordId: user.discord_id,
            bannedUntil: Date.now() + 60000
        }, { key: "wrong" });
        assert.equal(denied.status, 403);

        const allowed = await request(server, "/api/private/account/ban", {
            discordId: user.discord_id,
            bannedUntil: Date.now() + 60000,
            reason: "test"
        });
        assert.equal(allowed.status, 200);
        assert.equal(store.getBan(user.discord_id).reason, "test");
    });
});

test("private API deletes accounts and persists hashed IP bans", async () => {
    await withApi(async (server, store) => {
        const user = store.findOrCreateDiscordUser("234567890123456789");
        const deleted = await request(server, "/api/private/account/delete", { userId: user.id });
        assert.equal(deleted.status, 200);
        assert.equal(store.getUserById(user.id), null);

        const banned = await request(server, "/api/private/ip/ban", {
            address: "203.0.113.10",
            bannedUntil: Date.now() + 60000
        });
        assert.equal(banned.status, 200);
        assert.ok(store.isIpBanned("203.0.113.10"));
        assert.equal(store.isIpBanned("203.0.113.11"), null);
    });
});

test("private API queues action logs without exposing raw IP addresses", async () => {
    const events = [];
    await withApi(async (server, store) => {
        const user = store.findOrCreateDiscordUser("234567890123456789");
        const accountBanned = await request(server, "/api/private/account/ban", {
            discordId: user.discord_id,
            bannedUntil: Date.now() + 60_000,
            reason: "test"
        });
        assert.equal(accountBanned.status, 200);

        const ipBanned = await request(server, "/api/private/ip/ban", {
            address: "203.0.113.10",
            bannedUntil: Date.now() + 60_000,
            reason: "test"
        });
        assert.equal(ipBanned.status, 200);
        assert.equal(events[0].action, "account_ban");
        assert.equal(events[0].target, user.discord_id);
        assert.equal(events[1].action, "ip_ban");
        assert.notEqual(events[1].target, "203.0.113.10");
        assert.equal(JSON.stringify(events).includes("203.0.113.10"), false);
    }, event => events.push(event));
});
