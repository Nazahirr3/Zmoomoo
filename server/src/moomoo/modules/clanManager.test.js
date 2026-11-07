import test from "node:test";
import assert from "node:assert/strict";
import { ClanManager } from "./clanManager.js";

function makePlayer(sid, remoteAddress) {
    return {
        sid,
        name: `Player${sid}`,
        remoteAddress,
        team: null,
        notify: new Set(),
        send() {}
    };
}

test("custom teams are limited per IP and successful removals free the active slot", () => {
    const players = [];
    const manager = new ClanManager(players, { broadcast() {} });
    const first = makePlayer(1, "192.0.2.10");
    const second = makePlayer(2, "192.0.2.10");
    players.push(first, second);

    assert.equal(manager.create("first", first), true);
    assert.equal(manager.create("second", second), "active_ip_limit");
    assert.equal(manager.remove("first"), true);
    assert.equal(manager.create("second", second), true);
});

test("custom team creation attempts are throttled per IP", () => {
    const players = [];
    const manager = new ClanManager(players, { broadcast() {} });
    const player = makePlayer(1, "192.0.2.20");
    players.push(player);

    for (let index = 0; index < 3; index++) {
        const name = `team${index}`;
        assert.equal(manager.create(name, player), true);
        assert.equal(manager.remove(name), true);
    }

    assert.equal(manager.create("blocked", player), "rate_limit");
    assert.ok(player.clanCreateRetryAfter > 0);
});
