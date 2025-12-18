"use strict";

// Check if running in Node.js environment
var hasProcess = typeof process === "object" && process !== null;
var hasArgv = hasProcess && Array.isArray(process.argv);

// Returns 80 if --largeserver flag, otherwise 10
function resolveMaxPlayers() {
    if (hasArgv && process.argv.indexOf("--largeserver") !== -1) {
        return 80;
    }
    return 10;
}

// Flattens grouped config and validates no duplicate keys
function defineConfig(groups) {
    var flat = { groups: groups };
    Object.keys(groups).forEach(function (groupName) {
        var group = groups[groupName];
        Object.keys(group).forEach(function (settingKey) {
            if (flat.hasOwnProperty(settingKey)) {
                throw new Error("Duplicate config key detected: " + settingKey);
            }
            flat[settingKey] = group[settingKey];
        });
    });
    return flat;
}

var baseMaxPlayers = resolveMaxPlayers();

// Weapon upgrade tiers: id, src (image suffix), xp (required XP), val (damage multiplier), poison
// 0: Default, 1: Gold (_g, 3k XP, 1.1x), 2: Diamond (_d, 7k XP, 1.18x), 3: Ruby (_r, 12k XP, 1.18x + poison), 4: Emerald (_e, 24k XP, 1.18x + poison)
var weaponVariants = [{
    id: 0,
    src: "",
    xp: 0,
    val: 1
}, {
    id: 1,
    src: "_g",
    xp: 3000,
    val: 1.1
}, {
    id: 2,
    src: "_d",
    xp: 7000,
    val: 1.18
}, {
    id: 3,
    src: "_r",
    poison: true,
    xp: 12000,
    val: 1.18
}, {
    id: 4,
    src: "_e",
    poison: true,
    xp: 24000,
    val: 1.18
}];

// Player spawn defaults
var defaultStartItems = [0, 3, 6, 10];  // Item IDs players spawn with
var defaultStartWeapons = [0];  // Weapon IDs players spawn with
var startResources = {
    normal: 100,    // Starting score/points
    moofoll: 100    // Starting moofoll currency
};

// Sandbox mode building limits
var sandboxBuildLimits = {
    mill: 1,
    spikes: 200,
    traps: 100,
    general: 300
};

// World resource spawn counts (trees/bushes are per area, rocks/gold are total for entire map)
var worldSpawnCounts = {
    treesPerArea: 30,
    bushesPerArea: 12,
    totalRocks: 120,
    goldOres: 7
};

// Animal spawn plan: index (animal type: 0=Cow, 1=Pig, 2=Bull, 3=Bully, 4=Wolf, 5=Bear, 6-8=Bosses),
// desired (count to maintain), positions (optional: xRatio/yRatio 0-1 for spawn location)
var animalSpawnPlan = [{
    index: 0, desired: 2  // Cow
}, {
    index: 1, desired: 2  // Pig
}, {
    index: 4, desired: 3  // Wolf
}, {
    index: 5, desired: 1  // Duck
}, {
    index: 2, desired: 1  // Bull
}, {
    index: 3, desired: 1  // Bully
}, {
    index: 6, desired: 0, positions: [{ xRatio: 0.42, yRatio: 0.72 }]  // Boss #1
}, {
    index: 7, desired: 0, positions: [{ xRatio: 0.18, yRatio: 0.22 }]  // Boss #2
}, {
    index: 8, desired: 0, positions: [{ xRatio: 0.78, yRatio: 0.64 }]  // Boss #3
}];

// Main game configuration
var groupedConfig = {

    render: {
        maxScreenWidth: 1920,
        maxScreenHeight: 1080
    },

    server: {
        serverUpdateRate: 9,
        maxPlayers: baseMaxPlayers,
        maxPlayersHard: baseMaxPlayers + 10,
        collisionDepth: 6,
        minimapRate: 3000  // ms
    },

    collisions: {
        colGrid: 10
    },

    networking: {
        clientSendRate: 5
    },

    ui: {
        healthBarWidth: 50,
        healthBarPad: 4.5,
        iconPadding: 15,
        iconPad: 0.9,
        deathFadeout: 3000,  // ms
        crownIconScale: 60,
        crownPad: 35
    },

    chat: {
        chatCountdown: 3000,  // ms
        chatCooldown: 500     // ms
    },

    sandbox: {
        isSandbox: true,
        millPpsMultiplier: 5,
        sandboxBuildLimits: sandboxBuildLimits
    },

    player: {
        maxAge: 100,
        gatherAngle: Math.PI / 2.6,
        gatherWiggle: 10,
        hitReturnRatio: 0.25,
        hitAngle: Math.PI / 2,
        baseHealth: 100,
        playerScale: 35,
        playerSpeed: 0.0016,
        playerDecel: 0.993,
        nameY: 34,
        startItems: defaultStartItems,
        startWeapons: defaultStartWeapons,
        startResources: startResources
    },

    customization: {
        skinColors: ["#bf8f54", "#cbb091", "#896c4b", "#fadadc", "#ececec", "#c37373", "#4c4c4c", "#ecaff7", "#738cc3", "#8bc373"]
    },

    animals: {
        animalCount: 100000,  // deprecated - use animalSpawnPlan
        aiTurnRandom: 0.06,
        cowNames: ["Sid", "Steph", "Bmoe", "Romn", "Jononthecool", "Fiona", "Vince", "Nathan", "Nick", "Flappy", "Ronald", "Otis", "Pepe", "Mc Donald", "Theo", "Fabz", "Oliver", "Jeff", "Jimmy", "Helena", "Reaper", "Ben", "Alan", "Naomi", "XYZ", "Clever", "Jeremy", "Mike", "Destined", "Stallion", "Allison", "Meaty", "Sophia", "Vaja", "Joey", "Pendy", "Murdoch", "Theo", "Jared", "July", "Sonia", "Mel", "Dexter", "Quinn", "Milky"],
        animalSpawnPlan: animalSpawnPlan
    },

    weapons: {
        shieldAngle: Math.PI / 3,
        weaponVariants: weaponVariants,
        fetchVariant: function (player) {
            var tmpXP = player.weaponXP[player.weaponIndex] || 0;
            for (var i = weaponVariants.length - 1; i >= 0; --i) {
                if (tmpXP >= weaponVariants[i].xp) {
                    return weaponVariants[i];
                }
            }
            return weaponVariants[0];
        }
    },

    world: Object.assign({
        resourceTypes: ["wood", "food", "stone", "points"],
        areaCount: 7,
        riverWidth: 724,
        riverPadding: 114,
        waterCurrent: 0.0011,
        waveSpeed: 0.0001,
        waveMax: 1.3,
        treeScales: [150, 160, 165, 175],
        bushScales: [80, 85, 95],
        rockScales: [80, 85, 90]
    }, worldSpawnCounts, {
        spawnCounts: worldSpawnCounts
    }),

    biome: {
        snowBiomeTop: 2400,
        snowSpeed: 0.75
    },

    meta: {
        maxNameLength: 15
    },

    map: {
        mapScale: 14400,
        mapPingScale: 40,
        mapPingTime: 2200  // ms
    },

    experience: {
        initialXP: 300,
        levelMultiplier: 1.2,
        gatheringMultiplier: 4,
        goldBonusResources: 4,
        goldGenerationXP: 0.1
    },

    economy: {
        millPointsPerTick: 5000
    },

    combat: {
        baseKnockback: 0.3,
        projectileKnockback: 0.3,
        spikeKnockback: 1.5,
        defaultHitSlow: 0.3,
        slowRecoveryRate: 0.0008,
        playerHitScale: 1.8,
        objectDamageMultiplier: 5,
        killScoreMultiplier: 100,
        goldStealPercent: 0.5,
        poisonDamage: 5,
        poisonDuration: 5
    },

    water: {
        normalSpeedMultiplier: 0.33,
        immunitySpeedMultiplier: 0.75,
        normalCurrentEffect: 1.0,
        immunityCurrentEffect: 0.4
    },

    environment: {
        cactusDamage: 20
    },

    shameSystem: {
        detectionWindow: 120,     // ms
        threshold: 8,
        penaltyDuration: 30000,   // ms
        countReduction: 2
    },

    ai: {
        initialWait: 1000,           // ms
        updateInterval: 1000,        // ms
        chargeDurationMin: 8000,     // ms
        chargeDurationMax: 12000,    // ms
        wanderDurationMin: 1000,     // ms
        wanderDurationMax: 2000,     // ms
        movementDurationMin: 4000,   // ms
        movementDurationMax: 10000,  // ms
        hostileWaitTime: 1500,       // ms
        passiveWaitMin: 1500,        // ms
        passiveWaitMax: 6000,        // ms
        postHitWait: 3000,           // ms
        fleeDuration: 2000,          // ms
        fleeSpeedMultiplier: 1.42,
        chargeSpeedMultiplier: 1.75,
        hitWindupSlowdown: 0.3,
        waterSlowdown: 0.33,
        leapChance: 0.33,
        playerKnockback: 0.6,
        collisionKnockback: 0.55,
        hitDelay: 600,               // ms
        hitDelayAfterDamage: 500,    // ms
        animationSpeed: 600,         // ms
        attackAngle: 0.8,
        collisionDepthDivisor: 40,
        maxCollisionDepth: 4,
        minCollisionDepth: 1
    },

    physics: {
        velocityStopThreshold: 0.01,
        collisionVelocityRetention: 0.75,
        objectScaleMultiplier: 0.6,
        wiggleDecayRate: 0.99,
        buildingSpeedPenalty: 0.5
    },

    turret: {
        gearHatID: 53,
        empHelmetID: 22,
        targetRange: 735,
        projectileSpeed: 1.6,
        fireRate: 2500,              // ms
        structureMinCooldown: 250    // ms
    },

    leaderboard: {
        leaderboardMaxPlayers: 10,
        allianceNameMaxLength: 7
    },

    specialItems: {
        shameHatID: 45,
        turretGearID: 53
    },

    spawning: {
        aiSpawnCheckInterval: 1000,  // ms
        turretProjectileOffset: 45
    }
};

module.exports = defineConfig(groupedConfig);
