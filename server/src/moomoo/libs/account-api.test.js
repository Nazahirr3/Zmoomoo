import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAccountStore } from "./account-store.js";
import { registerAccountApi } from "./account-api.js";

const discordId = "234567890123456789";

async function startApi(fetchMock) {
    const previous = {
        clientId: process.env.DISCORD_CLIENT_ID,
        secret: process.env.DISCORD_CLIENT_SECRET,
        redirect: process.env.DISCORD_REDIRECT_URI,
        fetch: globalThis.fetch
    };
    process.env.DISCORD_CLIENT_ID = "client";
    process.env.DISCORD_CLIENT_SECRET = "secret";
    process.env.DISCORD_REDIRECT_URI = "http://127.0.0.1/callback";
    globalThis.fetch = fetchMock;
    const app = express();
    app.use(express.json());
    const store = createAccountStore(":memory:");
    registerAccountApi(app, { store });
    const server = await new Promise(resolve => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    return {
        store,
        server,
        request: previous.fetch,
        restore() {
            server.close();
            store.close();
            process.env.DISCORD_CLIENT_ID = previous.clientId;
            process.env.DISCORD_CLIENT_SECRET = previous.secret;
            process.env.DISCORD_REDIRECT_URI = previous.redirect;
            globalThis.fetch = previous.fetch;
        }
    };
}

function response(status, data, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        async json() { return data; }
    };
}

test("Discord login rejects an unverified Discord email", async () => {
    let calls = 0;
    const api = await startApi(async url => {
        calls++;
        if (String(url).includes("/oauth2/token")) return response(200, { access_token: "token" });
        return response(200, { id: discordId, verified: false, email: "unverified@example.com" });
    });
    try {
        const start = await api.request(`http://127.0.0.1:${api.server.address().port}/api/auth/discord`, { redirect: "manual" });
        const location = new URL(start.headers.get("location"));
        const cookies = start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
        const result = await api.request(
            `http://127.0.0.1:${api.server.address().port}/api/auth/discord/callback?code=code&state=${location.searchParams.get("state")}`,
            { headers: { cookie: cookies } }
        );
        assert.equal(result.status, 403);
        assert.equal(calls, 2);
    } finally {
        api.restore();
    }
});

test("Discord login stores verified email and creates a session", async () => {
    const api = await startApi(async url => {
        if (String(url).includes("/oauth2/token")) return response(200, { access_token: "token" });
        return response(200, { id: discordId, verified: true, email: "verified@example.com" });
    });
    try {
        const start = await api.request(`http://127.0.0.1:${api.server.address().port}/api/auth/discord`, { redirect: "manual" });
        const location = new URL(start.headers.get("location"));
        const cookies = start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
        const result = await api.request(
            `http://127.0.0.1:${api.server.address().port}/api/auth/discord/callback?code=code&state=${location.searchParams.get("state")}`,
            { headers: { cookie: cookies }, redirect: "manual" }
        );
        assert.equal(result.status, 302);
        const user = api.store.getUserById(1);
        assert.equal(user.email, "verified@example.com");
        assert.equal(user.email_verified, 1);
        assert.ok(result.headers.get("set-cookie").includes("zmoomoo_session="));
    } finally {
        api.restore();
    }
});
