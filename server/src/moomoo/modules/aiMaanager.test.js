import assert from "node:assert/strict";
import test from "node:test";
import { AiManager } from "./aiMaanager.js";
import { config } from "../config.js";
import { Game, isAnimalSpawnBiomeValid } from "../server.js";
import { AI, isWithinAIContactShape } from "./ai.js";
import { UTILS } from "../libs/utils.js";

test("requested animal stats and boss rewards are in the server catalog", () => {
    const manager = new AiManager([], null, [], [], null, {}, {}, () => {}, null);
    const sheep = manager.aiTypes[9];
    const fish = manager.aiTypes[11];
    const vince = manager.aiTypes[12];
    const sid = manager.aiTypes[13];
    const yeti = manager.aiTypes[14];
    const boar = manager.aiTypes[15];
    const cheetah = manager.aiTypes[16];
    const deer = manager.aiTypes[17];
    const fox = manager.aiTypes[18];
    const quack = manager.aiTypes[5];
    const duck = manager.aiTypes[10];

    assert.equal(sheep.id, 9);
    assert.equal(sheep.src, "sheep_1");
    assert.equal(sheep.name, undefined);
    assert.equal(sheep.health, 35 * 19);
    assert.equal(sheep.killScore, 200);
    assert.deepEqual(sheep.drop, ["food", 50]);

    assert.equal(fish.scale, 70);
    assert.equal(fish.aquatic, true);
    assert.equal(vince.health, 20000);
    assert.equal(vince.goldReward, 10000);
    assert.equal(vince.xpReward, 24000);
    assert.equal(vince.hitRange, manager.aiTypes[6].hitRange);
    assert.equal(vince.hitDelay, manager.aiTypes[6].hitDelay);
    assert.equal(sid.health, 23000);
    assert.equal(sid.dmg, 65);
    assert.equal(sid.goldReward, 15000);
    assert.equal(sid.xpReward, 28000);
    assert.equal(sid.hitRange, manager.aiTypes[6].hitRange);
    assert.equal(sid.hitDelay, manager.aiTypes[6].hitDelay);
    assert.equal(sid.leapForce, manager.aiTypes[6].leapForce);

    assert.equal(yeti.health, 3200);
    assert.equal(yeti.viewRange, 750);
    assert.equal(yeti.snowOnly, true);
    assert.equal(yeti.speed, 0.001);
    assert.equal(yeti.fleeSpeed, 0.00142);
    assert.equal(yeti.chargeSpeed, 0.0013);
    assert.ok(yeti.chargeSpeed > config.playerSpeed * config.snowSpeed);
    assert.ok(yeti.chargeSpeed <= config.playerSpeed * config.snowSpeed * 1.1);
    assert.equal(yeti.goldReward, 4500);
    assert.equal(yeti.drop[1], 800);
    assert.equal(yeti.xpReward, yeti.goldReward * 2);
    assert.equal(yeti.scale, 68);
    assert.equal(yeti.spriteMlt, 1.4);
    assert.equal(yeti.fixedSpawn, true);

    assert.equal(boar.health, 900);
    assert.equal(boar.viewRange, 700);
    assert.equal(boar.dmg, 16);
    assert.equal(boar.contactDamage, 16);
    assert.equal(boar.contactDamageInterval, 111);
    assert.equal(boar.contactRangeMultiplier, undefined);
    assert.deepEqual(boar.contactShape, { length: 1.05, width: 0.42 });
    assert.equal(boar.fleeOnlyFromNonPlayers, true);
    assert.equal(boar.bullRepel, true);
    assert.equal(boar.speed, 0.00105);
    assert.equal(boar.fleeSpeed, 0.001491);
    assert.equal(boar.chargeSpeed, 0.0018375);
    assert.equal(boar.goldReward, 800);
    assert.equal(boar.drop[1], 150);
    assert.equal(boar.xpReward, 1500);
    assert.equal(boar.scale, 72);
    assert.equal(isAnimalSpawnBiomeValid(boar, config.mapScale / 2, config), true);

    assert.deepEqual(
        [cheetah.name, cheetah.src, deer.name, deer.src, fox.name, fox.src],
        ["Cheetah", "cheetah", "Deer", "deer", "Fox", "fox"]
    );
    assert.deepEqual(cheetah.spawnBiomes, ["desert"]);
    assert.equal(cheetah.desertOnly, true);
    assert.equal(cheetah.hostile, true);
    assert.equal(cheetah.dmg, 10);
    assert.equal(cheetah.health, 250);
    assert.equal(cheetah.scale, 80);
    assert.equal(cheetah.spawnDelay, 60000);
    assert.equal(cheetah.fleeOnlyFromNonPlayers, true);
    assert.equal(cheetah.speed, 0.0009);
    assert.equal(cheetah.fleeSpeed, 0.00115);
    assert.equal(cheetah.chargeSpeed, 0.00135);
    assert.deepEqual(deer.spawnBiomes, ["normal", "snow"]);
    assert.deepEqual(fox.spawnBiomes, ["normal", "snow"]);
    assert.equal(fox.preserveAspectRatio, true);
    assert.equal(fox.scale, 100);
    assert.equal(fox.retaliatesOnlyWhenAttacked, true);
    assert.equal(fox.chargePlayer, true);
    assert.equal(fox.dmg, 8);
    assert.deepEqual(duck.spawnBiomes, ["normal"]);
    assert.deepEqual(fish.spawnBiomes, ["water"]);
    assert.ok(duck.speed > quack.speed);
    assert.ok(duck.waterSpeedMultiplier > 1);
    assert.equal(isAnimalSpawnBiomeValid(cheetah, config.mapScale - config.snowBiomeTop + cheetah.scale, config), true);
    assert.equal(isAnimalSpawnBiomeValid(cheetah, config.mapScale - config.snowBiomeTop - cheetah.scale, config), false);
    assert.equal(isAnimalSpawnBiomeValid(deer, config.snowBiomeTop - deer.scale, config), true);
    assert.equal(isAnimalSpawnBiomeValid(deer, config.snowBiomeTop + deer.scale + 1, config), true);
    assert.equal(isAnimalSpawnBiomeValid(deer, config.mapScale - config.snowBiomeTop + deer.scale, config), false);
    assert.equal(isAnimalSpawnBiomeValid(fox, config.snowBiomeTop + fox.scale + 1, config), true);
    assert.equal(isAnimalSpawnBiomeValid(fox, config.snowBiomeTop - fox.scale, config), true);
    assert.equal(isAnimalSpawnBiomeValid(fox, config.mapScale - config.snowBiomeTop + fox.scale, config), false);
    assert.equal(isAnimalSpawnBiomeValid(fox, config.mapScale - config.snowBiomeTop - fox.scale, config), false);
    assert.equal(isAnimalSpawnBiomeValid(yeti, config.snowBiomeTop - yeti.scale, config), true);
    assert.equal(isAnimalSpawnBiomeValid(yeti, config.snowBiomeTop + yeti.scale, config), false);
    assert.equal(isAnimalSpawnBiomeValid(duck, config.mapScale / 2, config), false);
    assert.equal(isAnimalSpawnBiomeValid(fish, config.mapScale / 2, config), true);
    assert.equal(config.animalSpawnPlan.find(spawn => spawn.index === 14).desired, 2);
    for (const id of [14, 15, 16, 17, 18]) {
        assert.ok(config.animalSpawnPlan.some(spawn => spawn.index === id && spawn.desired > 0));
    }
});

test("reused Builder mob slots fully initialize Sid instead of retaining the prior animal", () => {
    const ais = [];
    const manager = new AiManager(ais, AI, [], [], null, config, UTILS, () => {}, { send() {} });
    const owner = { sid: 31 };
    const deer = manager.spawn(1000, 1000, 0, 17, true);
    deer.builderSpawnedBySid = owner.sid;

    assert.equal(manager.clearBuilderSpawns(owner), 1);
    const sid = manager.spawn(1000, 1000, 0, 13, true);

    assert.equal(sid, deer);
    assert.equal(sid.name, "Sid");
    assert.equal(sid.src, "sid");
    assert.equal(sid.scale, manager.aiTypes[13].scale);
    assert.equal(sid.spriteMlt, manager.aiTypes[13].spriteMlt);
    assert.equal(sid.maxHealth, manager.aiTypes[13].health);
    assert.equal(sid.health, manager.aiTypes[13].health);
    assert.equal(sid.hitRange, manager.aiTypes[13].hitRange);
    assert.equal(sid.hitDelay, manager.aiTypes[13].hitDelay);
});

test("Boar contact follows a narrow body-shaped hitbox", () => {
    const boar = { x: 1000, y: 1000, dir: 0, scale: 72, contactRangeMultiplier: 1,
        contactShape: { length: 1.05, width: 0.42 } };
    assert.equal(isWithinAIContactShape(boar, { x: 1090, y: 1000, scale: 35 }), true);
    assert.equal(isWithinAIContactShape(boar, { x: 1000, y: 1075, scale: 35 }), false);
    boar.dir = Math.PI / 2;
    assert.equal(isWithinAIContactShape(boar, { x: 1000, y: 1090, scale: 35 }), true);
    assert.equal(isWithinAIContactShape(boar, { x: 1075, y: 1000, scale: 35 }), false);
});

test("Boars flee spikes and Cheetahs flee only spikes but retaliate when players hit them", () => {
    const manager = new AiManager([], null, [], [], null, config, UTILS, () => {}, null);
    const boarType = manager.aiTypes[15];
    const cheetahType = manager.aiTypes[16];
    const objectManager = { getGridArrays: () => [], checkCollision() {} };
    const boar = new AI(0, objectManager, [], [], UTILS, config, () => {}, { send() {} });
    const cheetah = new AI(1, objectManager, [], [], UTILS, config, () => {}, { send() {} });
    const player = { isPlayer: true, alive: true, canSee: () => false };
    const spike = { isPlayer: false, active: true, group: { name: "spikes" } };
    const otherHazard = { isPlayer: false, active: true, group: { name: "mill" } };

    boar.init(1000, 1000, 0, boarType.id, boarType);
    boar.chargeTarget = player;
    boar.changeHealth(-1, null, spike);
    assert.equal(boar.runFrom, spike);
    assert.equal(boar.chargeTarget, null);

    cheetah.init(1000, 1000, 0, cheetahType.id, cheetahType);
    cheetah.chargeTarget = player;
    cheetah.changeHealth(-1, null, otherHazard);
    assert.equal(cheetah.runFrom, null);
    assert.equal(cheetah.chargeTarget, player);

    cheetah.changeHealth(-1, null, spike);
    assert.equal(cheetah.runFrom, spike);
    assert.equal(cheetah.chargeTarget, null);

    cheetah.init(1000, 1000, 0, cheetahType.id, cheetahType);
    cheetah.changeHealth(-1, player);
    assert.equal(cheetah.runFrom, null);
    assert.equal(cheetah.chargeTarget, player);
});

test("natural animal spawn clearance matches obstacle collision size", () => {
    const manager = new AiManager([], AI, [], [], null, config, UTILS, () => {}, { send() {} });
    const cheetahType = manager.aiTypes[16];
    const game = Object.create(Game.prototype);
    game.ai_manager = manager;
    game.ais = [];
    game.object_manager = {
        checkItemLocation(x, y, scale, scaleMultiplier) {
            const obstacle = { x: x + 130, y, scale: 100 };
            const collisionRadius = obstacle.scale * 0.6;
            return UTILS.getDistance(x, y, obstacle.x, obstacle.y) >=
                scale + collisionRadius * scaleMultiplier;
        }
    };

    const desertY = config.mapScale - config.snowBiomeTop + cheetahType.scale;
    assert.equal(game.validateAnimalSpawn(cheetahType.id, 1000, desertY), false);
});

test("Boars cannot damage players while fleeing from a spike", () => {
    const player = {
        sid: 1,
        x: 1000,
        y: 1000,
        scale: 35,
        alive: true,
        health: 100,
        changeHealth(amount) {
            this.health += amount;
        }
    };
    const spike = { isPlayer: false, active: true, x: 900, y: 1000 };
    const objectManager = { getGridArrays: () => [], checkCollision() {} };
    const manager = new AiManager([], null, [], [], null, config, UTILS, () => {}, null);
    const boarType = manager.aiTypes[15];
    const boar = new AI(0, objectManager, [player], [], UTILS, config, () => {}, { send() {} });
    boar.init(1000, 1000, 0, boarType.id, boarType);
    boar.runFrom = spike;
    boar.chargeTarget = player;
    boar.waitCount = 0;
    boar.moveCount = 2000;

    boar.update(1);

    assert.equal(boar.runFrom, spike);
    assert.equal(player.health, 100);
});

test("mobs drop an existing target when the player activates the sleigh", () => {
    const sleighPlayer = {
        isPlayer: true,
        alive: true,
        sleighMode: true,
        x: 1100,
        y: 1000
    };
    const objectManager = { getGridArrays: () => [], checkCollision() {} };
    const manager = new AiManager([], null, [], [], null, config, UTILS, () => {}, null);
    const wolfType = manager.aiTypes[4];
    const wolf = new AI(0, objectManager, [sleighPlayer], [], UTILS, config, () => {}, { send() {} });
    wolf.init(1000, 1000, 0, wolfType.id, wolfType);
    wolf.chargeTarget = sleighPlayer;
    wolf.provokedPlayer = sleighPlayer;
    wolf.moveCount = 4000;
    wolf.waitCount = 0;

    wolf.update(16);

    assert.equal(wolf.chargeTarget, null);
    assert.equal(wolf.provokedPlayer, null);
});

test("trapped Boars cannot deal contact damage", () => {
    const players = [{
        sid: 1,
        x: 1000,
        y: 1000,
        scale: 35,
        alive: true,
        health: 100,
        changeHealth() {
            this.health -= 16;
        }
    }];
    const objectManager = {
        getGridArrays: () => [[{ active: true }]],
        checkCollision(ai) {
            ai.lockMove = true;
        }
    };
    const manager = new AiManager([], null, [], [], null, config, UTILS, () => {}, null);
    const boarType = manager.aiTypes[15];
    const boar = new AI(0, objectManager, players, [], UTILS, config, () => {}, { send() {} });
    boar.init(1000, 1000, 0, boarType.id, boarType);
    boar.update(1);
    assert.equal(boar.lockMove, true);
    assert.equal(players[0].health, 100);
});

test("foxes retaliate only against players and stop when the player leaves view range", () => {
    const manager = new AiManager([], null, [], [], null, {}, {}, () => {}, null);
    const players = [];
    const objectManager = {
        getGridArrays: () => [],
        checkCollision() {}
    };
    const fox = new AI(0, objectManager, players, [], UTILS, config, () => {}, { send() {} });
    const foxType = manager.aiTypes[18];
    fox.init(1000, 1000, 0, foxType.id, foxType);
    const player = {
        isPlayer: true,
        alive: true,
        canSee: () => false,
        x: 1100,
        y: 1000
    };

    fox.changeHealth(-10, player);
    assert.equal(fox.provokedPlayer, player);
    assert.equal(fox.chargeTarget, player);

    player.x = 1000 + foxType.viewRange + 1;
    fox.update(1);
    assert.equal(fox.provokedPlayer, null);
    assert.equal(fox.chargeTarget, null);

    const spike = { isPlayer: false, active: true, x: 1000, y: 1000, canSee: () => false };
    fox.changeHealth(-10, spike);
    assert.equal(fox.provokedPlayer, null);
    assert.equal(fox.chargeTarget, null);
});

test("natural Yetis spawn in snow while Builder Yetis retain their requested position", () => {
    const ais = [];
    const manager = new AiManager(ais, AI, [], [], null, config, UTILS, () => {}, { send() {} });
    const yeti = manager.aiTypes[14];
    const desertY = config.mapScale - config.snowBiomeTop - yeti.scale;

    const naturalYeti = manager.spawn(1000, desertY, 0, yeti.id);
    assert.equal(naturalYeti.builderSpawned, false);
    assert.equal(naturalYeti.y, config.snowBiomeTop - yeti.scale);

    const builderYeti = manager.spawn(2000, desertY, 0, yeti.id, true);
    assert.equal(builderYeti.builderSpawned, true);
    assert.equal(builderYeti.y, desertY);
});

test("natural Cheetahs spawn in the desert but can leave; Builder Cheetahs can spawn anywhere", () => {
    const objectManager = { getGridArrays: () => [], checkCollision() {} };
    const manager = new AiManager([], AI, [], [], objectManager, config, UTILS, () => {}, { send() {} });
    const cheetah = manager.aiTypes[16];
    const desertMinY = config.mapScale - config.snowBiomeTop + cheetah.scale;
    const snowY = config.snowBiomeTop + cheetah.scale;
    const naturalCheetah = manager.spawn(1000, snowY, 0, cheetah.id);
    const builderCheetah = manager.spawn(2000, snowY, 0, cheetah.id, true);

    assert.equal(naturalCheetah.y, desertMinY);
    assert.equal(naturalCheetah.health, cheetah.health);
    naturalCheetah.y = desertMinY + 1;
    naturalCheetah.yVel = -1;
    naturalCheetah.update(10);
    assert.ok(naturalCheetah.y < desertMinY);
    assert.equal(builderCheetah.y, snowY);
    builderCheetah.update(1);
    assert.equal(builderCheetah.y, snowY);
});

test("dead natural Cheetahs respawn at their desert spawn point after the cooldown", () => {
    const objectManager = { getGridArrays: () => [], checkCollision() {} };
    const manager = new AiManager([], AI, [], [], objectManager, config, UTILS, () => {}, { send() {} });
    const cheetah = manager.aiTypes[16];
    const desertY = config.mapScale - config.snowBiomeTop + cheetah.scale;
    const naturalCheetah = manager.spawn(1000, desertY, 0, cheetah.id);
    const spawnX = naturalCheetah.startX;
    const spawnY = naturalCheetah.startY;

    naturalCheetah.changeHealth(-cheetah.health);
    assert.equal(naturalCheetah.spawnCounter, cheetah.spawnDelay);
    naturalCheetah.update(cheetah.spawnDelay - 1);
    assert.equal(naturalCheetah.x, -1000000);
    naturalCheetah.update(1);
    assert.equal(naturalCheetah.x, spawnX);
    assert.equal(naturalCheetah.y, spawnY);
    assert.ok(naturalCheetah.y - naturalCheetah.scale >= config.mapScale - config.snowBiomeTop);
});

test("the configured natural Yeti pair spawns at valid snow positions", () => {
    const ais = [];
    const manager = new AiManager(ais, AI, [], [], null, config, UTILS, () => {}, { send() {} });
    const game = Object.create(Game.prototype);
    game.ais = ais;
    game.ai_manager = manager;
    game.object_manager = { checkItemLocation: () => true };
    game.aiSpawnPlan = game.buildAiSpawnPlan().filter(plan => plan.index === 14);

    game.ensureAnimals();

    const yetis = ais.filter(ai => ai.active && !ai.builderSpawned && ai.index === 14);
    const snowStart = config.snowBiomeTop;
    assert.equal(yetis.length, 2);
    assert.ok(yetis.every(yeti => yeti.y + yeti.scale <= snowStart));
});

test("clearing Builder mobs removes only the calling player's spawned mobs", () => {
    const ais = [];
    const manager = new AiManager(ais, AI, [], [], null, config, UTILS, () => {}, { send() {} });
    const boar = manager.aiTypes[15];
    const caller = { sid: 21 };
    const otherPlayer = { sid: 22 };
    const callerMob = manager.spawn(1000, 1000, 0, boar.id, true);
    callerMob.builderSpawnedBySid = caller.sid;
    const otherMob = manager.spawn(1200, 1000, 0, boar.id, true);
    otherMob.builderSpawnedBySid = otherPlayer.sid;
    const naturalMob = manager.spawn(1400, 1000, 0, boar.id);

    assert.equal(manager.clearBuilderSpawns(caller), 1);
    assert.equal(callerMob.active, false);
    assert.equal(callerMob.alive, false);
    assert.equal(otherMob.active, true);
    assert.equal(naturalMob.active, true);
});
