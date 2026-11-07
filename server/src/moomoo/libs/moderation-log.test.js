import test from "node:test";
import assert from "node:assert/strict";
import { createModerationLogger } from "./moderation-log.js";

test("moderation logger requires a Discord HTTPS webhook URL", () => {
    assert.equal(createModerationLogger(""), null);
    assert.throws(() => createModerationLogger("http://discord.com/api/webhooks/1/token"));
    assert.throws(() => createModerationLogger("https://example.com/api/webhooks/1/token"));
    assert.throws(() => createModerationLogger("https://discord.com/api/webhooks/1/token?x=1"));
    assert.equal(typeof createModerationLogger("https://discord.com/api/webhooks/123456/token"), "function");
});

test("moderation logger sends mention-safe action details and surfaces HTTP errors", async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true, status: 204 };
    };

    try {
        const logger = createModerationLogger("https://discord.com/api/webhooks/123456/token");
        await logger({
            action: "automatic_chat_mute",
            actor: "server",
            actorHasAccount: false,
            target: "player",
            targetHasAccount: true,
            details: "@everyone severe chat violation"
        });
        const body = JSON.parse(request.options.body);
        assert.equal(request.options.redirect, "error");
        assert.deepEqual(body.allowed_mentions, { parse: [] });
        assert.equal(body.embeds[0].title, "Server activity log");
        assert.deepEqual(body.embeds[0].fields.map(field => [field.name, field.value]), [
            ["Action", "automatic_chat_mute"],
            ["Actor", "server"],
            ["Target", "player"],
            ["Actor account", "NO"],
            ["Target account", "YES"],
            ["Details", "@everyone severe chat violation"]
        ]);
        assert.equal(JSON.stringify(body).includes("@everyone severe chat violation"), true);

        globalThis.fetch = async () => ({ ok: false, status: 500 });
        await assert.rejects(logger({ action: "mute" }), /HTTP 500/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
