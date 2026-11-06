    import test from "node:test";
import assert from "node:assert/strict";
import { getDiscordStaffRoles, hasDiscordRole } from "./discord-role.js";

const discordId = "1566721142251589781";
const guildId = "1566721142251589772";
const roleId = "1566721142251589781";

function options(fetch) {
    return { token: "test-token", guildId, roleId, fetch };
}

test("Discord role lookup recognizes the configured role", async () => {
    const hasRole = await hasDiscordRole(discordId, options(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ roles: [roleId] })
    })));
    assert.equal(hasRole, true);
});

test("Discord staff lookup recognizes owner and administrator roles", async () => {
    const roles = await getDiscordStaffRoles(discordId, {
        token: "test-token",
        guildId,
        ownerRoleId: roleId,
        administratorRoleId: "1566721142251589778",
        fetch: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ roles: [roleId, "1566721142251589778"] })
        })
    });
    assert.deepEqual(roles, { owner: true, administrator: true });
});

test("Discord role lookup rejects members without the configured role", async () => {
    const hasRole = await hasDiscordRole(discordId, options(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ roles: [] })
    })));
    assert.equal(hasRole, false);
});

test("Discord role lookup treats non-members as unauthorized", async () => {
    const hasRole = await hasDiscordRole(discordId, options(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ code: 10007 })
    })));
    assert.equal(hasRole, false);
});

test("Discord role lookup reports a missing guild instead of treating it as unauthorized", async () => {
    await assert.rejects(
        hasDiscordRole(discordId, options(async () => ({
            ok: false,
            status: 404,
            json: async () => ({ code: 10004 })
        }))),
        /member lookup failed \(404, code 10004\)/
    );
});

test("Discord role lookup reports API failures instead of granting access", async () => {
    await assert.rejects(
        hasDiscordRole(discordId, options(async () => ({ ok: false, status: 503 }))),
        /member lookup failed \(503\)/
    );
});
