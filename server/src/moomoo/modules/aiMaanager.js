// AI MANAGER:
export class AiManager {
    constructor(ais, AI, players, items, objectManager, config, UTILS, scoreCallback, server) {
        // AI TYPES:
        this.aiTypes = [{
            id: 0,
            src: "cow_1",
            killScore: 150,
            health: 500,
            weightM: 0.8,
            speed: 0.00095,
            turnSpeed: 0.001,
            scale: 72,
            drop: ["food", 50]
        }, {
            id: 1,
            src: "pig_1",
            killScore: 200,
            health: 800,
            weightM: 0.6,
            speed: 0.00085,
            turnSpeed: 0.001,
            scale: 72,
            drop: ["food", 80]
        }, {
            id: 2,
            name: "Bull",
            src: "bull_2",
            hostile: true,
            dmg: 20,
            killScore: 1000,
            health: 1800,
            weightM: 0.5,
            speed: 0.00094,
            turnSpeed: 0.00074,
            scale: 78,
            viewRange: 800,
            chargePlayer: true,
            drop: ["food", 100]
        }, {
            id: 3,
            name: "Bully",
            src: "bull_1",
            hostile: true,
            dmg: 20,
            killScore: 2000,
            health: 2800,
            weightM: 0.45,
            speed: 0.001,
            turnSpeed: 0.0008,
            scale: 90,
            viewRange: 900,
            chargePlayer: true,
            drop: ["food", 400]
        }, {
            id: 4,
            name: "Wolf",
            src: "wolf_1",
            hostile: true,
            dmg: 8,
            killScore: 500,
            health: 300,
            weightM: 0.45,
            speed: 0.001,
            turnSpeed: 0.002,
            scale: 84,
            viewRange: 800,
            chargePlayer: true,
            drop: ["food", 200]
        }, {
            id: 5,
            name: "Quack",
            src: "chicken_1",
            dmg: 8,
            killScore: 2000,
            noTrap: true,
            health: 300,
            weightM: 0.2,
            speed: 0.0018,
            turnSpeed: 0.006,
            scale: 70,
            drop: ["food", 100]
        }, {
            id: 6,
            name: "MOOSTAFA",
            boss: true,
            nameScale: 50,
            src: "enemy",
            hostile: true,
            dontRun: true,
            fixedSpawn: true,
            spawnDelay: 60000,
            noTrap: true,
            colDmg: 100,
            dmg: 40,
            killScore: 8000,
            health: 18000,
            weightM: 0.4,
            speed: 0.0007,
            turnSpeed: 0.01,
            scale: 80,
            spriteMlt: 1.8,
            leapForce: 0.9,
            viewRange: 1000,
            hitRange: 210,
            hitDelay: 1000,
            chargePlayer: true,
            drop: ["food", 100]
        }, {
            id: 7,
            name: "Treasure",
            boss: true,
            hostile: true,
            nameScale: 35,
            src: "crate_1",
            fixedSpawn: true,
            spawnDelay: 120000,
            colDmg: 200,
            killScore: 5000,
            health: 20000,
            weightM: 0.1,
            speed: 0.0,
            turnSpeed: 0.0,
            scale: 70,
            spriteMlt: 1.0
        }, {
            id: 8,
            name: "MOOFIE",
            boss: true,
            src: "wolf_2",
            hostile: true,
            fixedSpawn: true,
            dontRun: true,
            hitScare: 4,
            spawnDelay: 30000,
            noTrap: true,
            nameScale: 35,
            dmg: 10,
            colDmg: 100,
            killScore: 3000,
            health: 7000,
            weightM: 0.45,
            speed: 0.0015,
            turnSpeed: 0.002,
            scale: 90,
            viewRange: 800,
            chargePlayer: true,
            drop: ["food", 1000]
        }, {
            id: 9,
            src: "sheep_1",
            killScore: 200,
            health: 665,
            weightM: 0.7,
            speed: 0.00065,
            turnSpeed: 0.001,
            scale: 66,
            drop: ["food", 50]
        }, {
            id: 10,
            name: "Duck",
            src: "duck_1",
            spawnBiomes: ["normal"],
            fixedSpawn: true,
            noTrap: true,
            killScore: 200,
            health: 300,
            weightM: 0.2,
            speed: 0.002,
            waterSpeedMultiplier: 1.5,
            turnSpeed: 0.006,
            scale: 60,
            drop: ["food", 100]
        }, {
            id: 11,
            name: "Fish",
            src: "fish_1",
            spawnBiomes: ["water"],
            fixedSpawn: true,
            aquatic: true,
            noTrap: true,
            killScore: 100,
            health: 100,
            weightM: 0.1,
            speed: 0.0015,
            turnSpeed: 0.003,
            scale: 70,
            drop: ["food", 25]
        }, {
            id: 12,
            name: "Vince",
            src: "vince",
            boss: true,
            nameScale: 50,
            hostile: true,
            dontRun: true,
            dmg: 25,
            leapForce: 0.9,
            hitRange: 210,
            hitDelay: 1000,
            killScore: 10000,
            xpReward: 24000,
            goldReward: 10000,
            health: 20000,
            weightM: 0.4,
            speed: 0.0005,
            fleeSpeed: 0.00071,
            chargeSpeed: 0.000875,
            turnSpeed: 0.004,
            scale: 80,
            spriteMlt: 1.8,
            viewRange: 800,
            chargePlayer: true,
            drop: ["food", 100]
        }, {
            id: 13,
            name: "Sid",
            src: "sid",
            boss: true,
            nameScale: 50,
            hostile: true,
            dontRun: true,
            dmg: 65,
            leapForce: 0.9,
            hitRange: 210,
            hitDelay: 1000,
            killScore: 15000,
            xpReward: 28000,
            goldReward: 15000,
            health: 23000,
            weightM: 0.4,
            speed: 0.0005,
            fleeSpeed: 0.00071,
            chargeSpeed: 0.000875,
            turnSpeed: 0.004,
            scale: 80,
            spriteMlt: 1.8,
            viewRange: 800,
            chargePlayer: true,
            drop: ["food", 150]
        }, {
            id: 14,
            name: "Yeti",
            src: "yeti",
            boss: true,
            snowOnly: true,
            spawnBiomes: ["snow"],
            fixedSpawn: true,
            fleeOnlyFromNonPlayers: true,
            hostile: true,
            dmg: 20,
            killScore: 4500,
            goldReward: 4500,
            xpReward: 9000,
            health: 3200,
            weightM: 0.4,
            speed: 0.001,
            fleeSpeed: 0.00142,
            chargeSpeed: 0.0013,
            turnSpeed: 0.004,
            scale: 68,
            spriteMlt: 1.4,
            viewRange: 750,
            chargePlayer: true,
            drop: ["food", 800]
        }, {
            id: 15,
            name: "Boar",
            src: "boar",
            hostile: true,
            bullRepel: true,
            fleeOnlyFromNonPlayers: true,
            dmg: 16,
            contactDamage: 16,
            contactDamageInterval: 111,
            contactShape: { length: 1.05, width: 0.42 },
            killScore: 800,
            goldReward: 800,
            xpReward: 1500,
            health: 900,
            weightM: 0.45,
            speed: 0.00105,
            fleeSpeed: 0.001491,
            chargeSpeed: 0.0018375,
            turnSpeed: 0.004,
            scale: 72,
            viewRange: 700,
            chargePlayer: true,
            drop: ["food", 150]
        }, {
            id: 16,
            name: "Cheetah",
            src: "cheetah",
            spawnBiomes: ["desert"],
            fixedSpawn: true,
            spawnDelay: 60000,
            desertOnly: true,
            hostile: true,
            fleeFromSpikes: true,
            dmg: 10,
            killScore: 1200,
            goldReward: 1200,
            xpReward: 2400,
            health: 250,
            weightM: 0.4,
            speed: 0.0009,
            fleeSpeed: 0.00115,
            chargeSpeed: 0.00135,
            turnSpeed: 0.004,
            scale: 80,
            spriteMlt: 1,
            viewRange: 750,
            chargePlayer: true,
            drop: ["food", 200]
        }, {
            id: 17,
            name: "Deer",
            src: "deer",
            spawnBiomes: ["normal", "snow"],
            fixedSpawn: true,
            killScore: 300,
            goldReward: 300,
            xpReward: 600,
            health: 500,
            weightM: 0.5,
            speed: 0.001,
            fleeSpeed: 0.00142,
            turnSpeed: 0.003,
            scale: 64,
            spriteMlt: 1.25,
            drop: ["food", 100]
        }, {
            id: 18,
            name: "Fox",
            src: "fox",
            spawnBiomes: ["normal", "snow"],
            fixedSpawn: true,
            preserveAspectRatio: true,
            hostile: true,
            retaliatesOnlyWhenAttacked: true,
            dmg: 8,
            chargePlayer: true,
            viewRange: 650,
            killScore: 400,
            goldReward: 400,
            xpReward: 800,
            health: 350,
            weightM: 0.3,
            speed: 0.0012,
            fleeSpeed: 0.001704,
            turnSpeed: 0.004,
            scale: 100,
            drop: ["food", 80]
        }];

        // SPAWN AI:
        this.spawn = function(x, y, dir, index, builderSpawned = false) {
            var tmpObj;
            for (var i = 0; i < ais.length; ++i) {
                if (!ais[i].active) {
                    tmpObj = ais[i];
                    break;
                }
            }
            if (!tmpObj) {
                tmpObj = new AI(ais.length, objectManager, players, items, UTILS, config, scoreCallback, server);
                ais.push(tmpObj);
            }
            var data = this.aiTypes[index];
            if (data && data.snowOnly && !builderSpawned) {
                y = Math.min(y, config.snowBiomeTop - data.scale);
            } else if (data && data.desertOnly && !builderSpawned) {
                y = Math.max(y, config.mapScale - config.snowBiomeTop + data.scale);
            }
            tmpObj.init(x, y, dir, index, this.aiTypes[index]);
            tmpObj.builderSpawned = builderSpawned;
            tmpObj.builderSpawnedBySid = null;
            return tmpObj;
        };

        this.clearBuilderSpawns = function(player) {
            var removed = 0;
            for (var i = 0; i < ais.length; ++i) {
                var ai = ais[i];
                if (!ai.active || !ai.builderSpawned || ai.builderSpawnedBySid !== player.sid) continue;
                ai.active = false;
                ai.alive = false;
                ai.builderSpawnedBySid = null;
                removed++;
            }
            return removed;
        };
    };
}