import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../config.js";
import { UTILS } from "../libs/utils.js";
import { items } from "./items.js";
import { Player } from "./player.js";
import { accessories, hats } from "./store.js";
import { decode } from "msgpack-lite";

function createPlayer(socket = { readyState: 0 }) {
    return new Player(
        "test-player",
        1,
        config,
        UTILS,
        {},
        {},
        [],
        [],
        items,
        hats,
        accessories,
        socket,
        () => {},
        () => {}
    );
}

test("builder mode restores the player's inventory and stats", () => {
    const player = createPlayer();
    player.autoGather = 1;
    player.mouseState = 1;
    player.hits = 2;
    player.gathering = 1;
    player.items = [0, 3];
    player.itemCounts = { 1: 2 };
    player.buildIndex = 3;
    player.speed = config.playerSpeed;
    player.pps = 4;
    player.sandboxMillCount = 2;

    player.setBuilderMode(true);

    assert.equal(player.builderMode, true);
    assert.equal(player.autoGather, 0);
    assert.equal(player.mouseState, 0);
    assert.equal(player.hits, 0);
    assert.equal(player.gathering, 0);
    assert.equal(player.speed, config.playerSpeed * 4);
    assert.deepEqual(player.items, [0, 3]);
    assert.deepEqual(player.itemCounts, { 1: 2 });

    player.autoGather = 1;
    player.mouseState = 1;
    player.hits = 2;
    player.gathering = 1;
    player.setBuilderMode(false);

    assert.equal(player.builderMode, false);
    assert.equal(player.autoGather, 0);
    assert.equal(player.mouseState, 0);
    assert.equal(player.hits, 0);
    assert.equal(player.gathering, 0);
    assert.deepEqual(player.items, [0, 3]);
    assert.deepEqual(player.itemCounts, { 1: 2 });
    assert.equal(player.buildIndex, 3);
    assert.equal(player.speed, config.playerSpeed);
    assert.equal(player.pps, 4);
    assert.equal(player.sandboxMillCount, 2);
});

test("builder mode prevents damage", () => {
    const player = createPlayer();
    player.builderMode = true;
    player.health = 100;
    player.maxHealth = 100;

    assert.equal(player.changeHealth(-25), false);
    assert.equal(player.health, 100);
});

test("sleigh mode prevents damage", () => {
    const player = createPlayer();
    player.sleighMode = true;
    player.health = 100;
    player.maxHealth = 100;

    assert.equal(player.changeHealth(-25), false);
    assert.equal(player.health, 100);
});

test("shield prevents damage and tells the attacker they hit an invincible player", () => {
    const packets = [];
    const attacker = createPlayer({
        readyState: 1,
        send(packet) {
            packets.push(decode(packet));
        }
    });
    attacker.canSee = () => true;
    const target = createPlayer();
    target.shielded = true;
    target.x = 25;
    target.y = 35;
    target.health = 100;
    target.maxHealth = 100;

    assert.equal(target.changeHealth(-25, attacker), false);
    assert.equal(target.health, 100);
    assert.deepEqual(packets, [["iv", [25, 35]]]);
});
