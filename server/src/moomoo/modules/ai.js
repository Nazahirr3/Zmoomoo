var PI2 = Math.PI * 2;

export function isWithinAIContactShape(ai, player) {
    if (!ai.contactShape) {
        return Math.hypot(player.x - ai.x, player.y - ai.y) <=
            (ai.scale + player.scale) * ai.contactRangeMultiplier;
    }

    var dx = player.x - ai.x;
    var dy = player.y - ai.y;
    var cos = Math.cos(ai.dir);
    var sin = Math.sin(ai.dir);
    var localX = dx * cos + dy * sin;
    var localY = -dx * sin + dy * cos;
    var reachX = ai.scale * ai.contactShape.length + player.scale;
    var reachY = ai.scale * ai.contactShape.width + player.scale;
    return (localX * localX) / (reachX * reachX) +
        (localY * localY) / (reachY * reachY) <= 1;
}

export class AI {
    constructor(sid, objectManager, players, items, UTILS, config, scoreCallback, server) {
        this.sid = sid;
        this.isAI = true;
        this.nameIndex = UTILS.randInt(0, config.cowNames.length - 1);

        // INIT:
        this.init = function(x, y, dir, index, data) {
            this.x = x;
            this.y = y;
            this.startX = data.fixedSpawn ? x : null;
            this.startY = data.fixedSpawn ? y : null;
            this.xVel = 0;
            this.yVel = 0;
            this.zIndex = 0;
            this.dir = dir;
            this.dirPlus = 0;
            this.index = index;
            this.src = data.src;
            this.name = data.name || null;
            this.boss = data.boss === true;
            this.aquatic = data.aquatic === true;
            this.bullRepel = data.bullRepel === true;
            this.waterSpeedMultiplier = data.waterSpeedMultiplier;
            this.fleeOnlyFromNonPlayers = data.fleeOnlyFromNonPlayers === true;
            this.fleeOnDamage = data.fleeOnDamage === true;
            this.fleeFromSpikes = data.fleeFromSpikes === true;
            this.snowOnly = data.snowOnly === true;
            this.desertOnly = data.desertOnly === true;
            this.retaliatesOnlyWhenAttacked = data.retaliatesOnlyWhenAttacked === true;
            this.preserveAspectRatio = data.preserveAspectRatio === true;
            this.waterLocked = this.aquatic &&
                y >= config.mapScale / 2 - config.riverWidth / 2 &&
                y <= config.mapScale / 2 + config.riverWidth / 2;
            this.landDamageTimer = 0;
            this.weightM = data.weightM;
            this.speed = data.speed;
            this.fleeSpeed = data.fleeSpeed;
            this.chargeSpeed = data.chargeSpeed;
            this.killScore = data.killScore;
            this.xpReward = data.xpReward;
            this.goldReward = data.goldReward;
            this.turnSpeed = data.turnSpeed;
            this.scale = data.scale;
            this.maxHealth = data.health;
            this.leapForce = data.leapForce;
            this.health = this.maxHealth;
            this.chargePlayer = data.chargePlayer;
            this.viewRange = data.viewRange;
            this.drop = data.drop;
            this.dmg = data.dmg;
            this.contactDamage = data.contactDamage;
            this.contactDamageInterval = data.contactDamageInterval;
            this.contactRangeMultiplier = data.contactRangeMultiplier || 1;
            this.contactShape = data.contactShape || null;
            this.contactDamageTimers = Object.create(null);
            this.hostile = data.hostile;
            this.dontRun = data.dontRun;
            this.hitRange = data.hitRange;
            this.hitDelay = data.hitDelay;
            this.hitScare = data.hitScare;
            this.spriteMlt = data.spriteMlt;
            this.nameScale = data.nameScale;
            this.colDmg = data.colDmg;
            this.noTrap = data.noTrap;
            this.spawnDelay = data.spawnDelay;
            this.hitWait = 0;
            this.waitCount = 1000;
            this.moveCount = 0;
            this.targetDir = 0;
            this.active = true;
            this.alive = true;
            this.runFrom = null;
            this.chargeTarget = null;
            this.provokedPlayer = null;
            this.dmgOverTime = {};
        };

        // UPDATE:
        var timerCount = 0;
        this.update = function(delta) {
            if (this.active) {
                if (this.retaliatesOnlyWhenAttacked && this.provokedPlayer &&
                    (!this.provokedPlayer.alive || this.provokedPlayer.builderMode || this.provokedPlayer.sleighMode ||
                        UTILS.getDistance(this.x, this.y, this.provokedPlayer.x, this.provokedPlayer.y) > this.viewRange)) {
                    this.provokedPlayer = null;
                    this.chargeTarget = null;
                    this.runFrom = null;
                    this.moveCount = 0;
                    this.waitCount = 1000;
                }
                if (this.chargeTarget && this.chargeTarget.sleighMode) {
                    if (this.provokedPlayer === this.chargeTarget) this.provokedPlayer = null;
                    this.chargeTarget = null;
                    this.runFrom = null;
                    this.moveCount = 0;
                    this.waitCount = 1;
                }
                if (this.aquatic) {
                    var riverTop = config.mapScale / 2 - config.riverWidth / 2;
                    var riverBottom = config.mapScale / 2 + config.riverWidth / 2;
                    if (this.y >= riverTop && this.y <= riverBottom) {
                        this.waterLocked = true;
                    }
                    if (this.waterLocked) {
                        var waterMinY = riverTop + this.scale;
                        var waterMaxY = riverBottom - this.scale;
                        if (this.y < waterMinY) {
                            this.y = waterMinY;
                            this.yVel = Math.max(0, this.yVel);
                        } else if (this.y > waterMaxY) {
                            this.y = waterMaxY;
                            this.yVel = Math.min(0, this.yVel);
                        }
                    } else {
                        this.landDamageTimer += delta;
                        if (this.landDamageTimer >= 1000) {
                            this.landDamageTimer %= 1000;
                            this.changeHealth(-Math.max(1, this.maxHealth * 0.05), null, null, true);
                            if (!this.active) return;
                        }
                    }
                }
                // SPAWN DELAY:
                if (this.spawnCounter) {
                    this.spawnCounter -= delta;
                    if (this.spawnCounter <= 0) {
                        this.spawnCounter = 0;
                        this.x = this.startX || UTILS.randInt(0, config.mapScale);
                        this.y = this.startY || UTILS.randInt(0, config.mapScale);
                    }
                    return;
                }

                // REGENS AND AUTO:
                timerCount -= delta;
                if (timerCount <= 0) {
                    if (this.dmgOverTime.dmg) {
                        this.changeHealth(-this.dmgOverTime.dmg, this.dmgOverTime.doer);
                        this.dmgOverTime.time -= 1;
                        if (this.dmgOverTime.time <= 0) {
                            this.dmgOverTime.dmg = 0;
                        }
                    }
                    timerCount = 1000;
                }

                // BEHAVIOUR:
                var charging = false;
                var slowMlt = 1;
                if (!this.zIndex && !this.lockMove && this.y >= config.mapScale / 2 - config.riverWidth / 2 && this.y <= config.mapScale / 2 + config.riverWidth / 2) {
                    slowMlt = this.waterSpeedMultiplier || 0.33;
                    this.xVel += config.waterCurrent * delta;
                }
                if (this.lockMove) {
                    this.xVel = 0;
                    this.yVel = 0;
                } else {
                    if (this.waitCount > 0) {
                        this.waitCount -= delta;
                        if (this.waitCount <= 0) {
                            if (this.chargePlayer) {
                                var tmpPlayer;
                                var bestDst;
                                var tmpDist;
                                for (var i = 0; i < players.length; ++i) {
                                    if (players[i].alive && !players[i].builderMode && !players[i].sleighMode &&
                                        (!this.retaliatesOnlyWhenAttacked || players[i] === this.provokedPlayer) &&
                                        !(players[i].skin && players[i].skin.bullRepel &&
                                            (!this.bullRepel || players[i] !== this.provokedPlayer))) {
                                        tmpDist = UTILS.getDistance(this.x, this.y, players[i].x, players[i].y);
                                        if (tmpDist <= this.viewRange && (!tmpPlayer || tmpDist < bestDst)) {
                                            bestDst = tmpDist;
                                            tmpPlayer = players[i];
                                        }
                                    }
                                }
                                if (tmpPlayer) {
                                    this.chargeTarget = tmpPlayer;
                                    this.moveCount = UTILS.randInt(8000, 12000);
                                } else {
                                    this.moveCount = UTILS.randInt(1000, 2000);
                                    this.targetDir = UTILS.randFloat(-Math.PI, Math.PI);
                                }
                            } else {
                                this.moveCount = UTILS.randInt(4000, 10000);
                                this.targetDir = UTILS.randFloat(-Math.PI, Math.PI);
                            }
                        }
                    } else {
                        if (this.moveCount > 0) {
                            var tmpSpd = this.speed * slowMlt;
                            if (this.runFrom && this.runFrom.active && !(this.runFrom.isPlayer && !this.runFrom.alive)) {
                                this.targetDir = UTILS.getDirection(this.x, this.y, this.runFrom.x, this.runFrom.y);
                                tmpSpd = (this.fleeSpeed || this.speed * 1.42) * slowMlt;
                            } else {
                                if (this.chargeTarget && this.chargeTarget.alive && !this.chargeTarget.builderMode) {
                                    this.targetDir = UTILS.getDirection(this.chargeTarget.x, this.chargeTarget.y, this.x, this.y);
                                    tmpSpd = (this.chargeSpeed || this.speed * 1.75) * slowMlt;
                                    charging = true;
                                }
                            }
                            if (this.hitWait) {
                                tmpSpd *= 0.3;
                            }
                            if (this.dir != this.targetDir) {
                                this.dir %= PI2;
                                var netAngle = (this.dir - this.targetDir + PI2) % PI2;
                                var amnt = Math.min(Math.abs(netAngle - PI2), netAngle, this.turnSpeed * delta);
                                var sign = netAngle - Math.PI >= 0 ? 1 : -1;
                                this.dir += sign * amnt + PI2;
                            }
                            this.dir %= PI2;
                            this.xVel += tmpSpd * delta * Math.cos(this.dir);
                            this.yVel += tmpSpd * delta * Math.sin(this.dir);
                            this.moveCount -= delta;
                            if (this.moveCount <= 0) {
                                this.runFrom = null;
                                this.chargeTarget = null;
                                this.waitCount = this.hostile ? 1500 : UTILS.randInt(1500, 6000);
                            }
                        }
                    }
                }

                // OBJECT COLL:
                this.zIndex = 0;
                this.lockMove = false;
                var tmpList;
                var tmpSpeed = UTILS.getDistance(0, 0, this.xVel * delta, this.yVel * delta);
                var depth = Math.min(4, Math.max(1, Math.round(tmpSpeed / 40)));
                var tMlt = 1 / depth;
                for (var i = 0; i < depth; ++i) {
                    if (this.xVel) {
                        this.x += this.xVel * delta * tMlt;
                    }
                    if (this.yVel) {
                        this.y += this.yVel * delta * tMlt;
                    }
                    tmpList = objectManager.getGridArrays(this.x, this.y, this.scale);
                    for (var x = 0; x < tmpList.length; ++x) {
                        for (var y = 0; y < tmpList[x].length; ++y) {
                            if (tmpList[x][y].active) {
                                objectManager.checkCollision(this, tmpList[x][y], tMlt);
                            }
                        }
                    }
                }

                // HITTING:
                var hitting = false;
                if (this.hitWait > 0) {
                    this.hitWait -= delta;
                    if (this.hitWait <= 0) {
                        hitting = true;
                        this.hitWait = 0;
                        if (this.leapForce && !UTILS.randInt(0, 2)) {
                            this.xVel += this.leapForce * Math.cos(this.dir);
                            this.yVel += this.leapForce * Math.sin(this.dir);
                        }
                        var tmpList = objectManager.getGridArrays(this.x, this.y, this.hitRange);
                        var tmpObj;
                        var tmpDst;
                        for (var t = 0; t < tmpList.length; ++t) {
                            for (var x = 0; x < tmpList[t].length; ++x) {
                                tmpObj = tmpList[t][x];
                                if (tmpObj.health) {
                                    tmpDst = UTILS.getDistance(this.x, this.y, tmpObj.x, tmpObj.y);
                                    if (tmpDst < tmpObj.scale + this.hitRange) {
                                        if (tmpObj.changeHealth(-this.dmg * 5)) {
                                            objectManager.disableObj(tmpObj);
                                        }
                                        objectManager.hitObj(tmpObj, UTILS.getDirection(this.x, this.y, tmpObj.x, tmpObj.y));
                                    }
                                }
                            }
                        }
                        for (var x = 0; x < players.length; ++x) {
                            if (players[x].canSee(this)) {
                                server.send(players[x].id, "J", this.sid);
                            }
                        }
                    }
                }

                // PLAYER COLLISIONS:
                var fleeingFromThreat = this.runFrom && this.runFrom.active &&
                    !(this.runFrom.isPlayer && !this.runFrom.alive);
                if (!this.lockMove && !fleeingFromThreat &&
                    (charging || hitting || this.contactDamageInterval)) {
                    var tmpObj;
                    var tmpDst;
                    var tmpDir;
                    for (var i = 0; i < players.length; ++i) {
                        tmpObj = players[i];
                        if (tmpObj && tmpObj.alive && !tmpObj.builderMode && !tmpObj.sleighMode) {
                            tmpDst = UTILS.getDistance(this.x, this.y, tmpObj.x, tmpObj.y);
                            if (this.hitRange) {
                                if (!this.hitWait && tmpDst <= this.hitRange + tmpObj.scale) {
                                    if (hitting) {
                                        tmpDir = UTILS.getDirection(tmpObj.x, tmpObj.y, this.x, this.y);
                                        tmpObj.changeHealth(-this.dmg);
                                        tmpObj.xVel += 0.6 * Math.cos(tmpDir);
                                        tmpObj.yVel += 0.6 * Math.sin(tmpDir);
                                        this.runFrom = null;
                                        this.chargeTarget = null;
                                        this.waitCount = 3000;
                                        this.hitWait = !UTILS.randInt(0, 2) ? 600 : 0;
                                    } else {
                                        this.hitWait = this.hitDelay;
                                    }
                                }
                            } else {
                                var touchingPlayer = isWithinAIContactShape(this, tmpObj);
                                if (touchingPlayer) {
                                    tmpDir = UTILS.getDirection(tmpObj.x, tmpObj.y, this.x, this.y);
                                    if (this.contactDamageInterval) {
                                        var contactTimer = (this.contactDamageTimers[tmpObj.sid] || 0) + delta;
                                        if (contactTimer >= this.contactDamageInterval) {
                                            contactTimer %= this.contactDamageInterval;
                                            tmpObj.changeHealth(-(this.contactDamage || this.dmg));
                                            tmpObj.xVel += 0.55 * Math.cos(tmpDir);
                                            tmpObj.yVel += 0.55 * Math.sin(tmpDir);
                                        }
                                        this.contactDamageTimers[tmpObj.sid] = contactTimer;
                                    } else {
                                        tmpObj.changeHealth(-this.dmg);
                                        tmpObj.xVel += 0.55 * Math.cos(tmpDir);
                                        tmpObj.yVel += 0.55 * Math.sin(tmpDir);
                                    }
                                } else if (this.contactDamageInterval) {
                                    delete this.contactDamageTimers[tmpObj.sid];
                                }
                            }
                        }
                    }
                }

                // DECEL:
                if (this.xVel) {
                    this.xVel *= Math.pow(config.playerDecel, delta);
                }
                if (this.yVel) {
                    this.yVel *= Math.pow(config.playerDecel, delta);
                }

                // MAP BOUNDARIES:
                var tmpScale = this.scale;
                if (this.x - tmpScale < 0) {
                    this.x = tmpScale;
                    this.xVel = 0;
                } else {
                    if (this.x + tmpScale > config.mapScale) {
                        this.x = config.mapScale - tmpScale;
                        this.xVel = 0;
                    }
                }
                if (this.y - tmpScale < 0) {
                    this.y = tmpScale;
                    this.yVel = 0;
                } else {
                    if (this.y + tmpScale > config.mapScale) {
                        this.y = config.mapScale - tmpScale;
                        this.yVel = 0;
                    }
                }
                if (this.aquatic && !this.waterLocked &&
                    this.y >= config.mapScale / 2 - config.riverWidth / 2 &&
                    this.y <= config.mapScale / 2 + config.riverWidth / 2) {
                    this.waterLocked = true;
                }
                if (this.aquatic && this.waterLocked) {
                    var riverTop = config.mapScale / 2 - config.riverWidth / 2;
                    var riverBottom = config.mapScale / 2 + config.riverWidth / 2;
                    var waterMinY = riverTop + this.scale;
                    var waterMaxY = riverBottom - this.scale;
                    if (this.y < waterMinY) {
                        this.y = waterMinY;
                        this.yVel = Math.max(0, this.yVel);
                    } else if (this.y > waterMaxY) {
                        this.y = waterMaxY;
                        this.yVel = Math.min(0, this.yVel);
                    }
                }
                if (this.snowOnly && !this.builderSpawned) {
                    var snowMaxY = config.snowBiomeTop - this.scale;
                    if (this.y > snowMaxY) {
                        this.y = snowMaxY;
                        this.yVel = Math.min(0, this.yVel);
                    }
                }
            }
        };

        // CAN SEE:
        this.canSee = function(other) {
            if (!other) {
                return false;
            }
            if (other.skin && other.skin.invisTimer && other.noMovTimer >= other.skin.invisTimer) {
                return false;
            }
            var dx = Math.abs(other.x - this.x) - other.scale;
            var dy = Math.abs(other.y - this.y) - other.scale;
            return dx <= config.maxScreenWidth / 2 * 1.3 * 2.5 &&
                dy <= config.maxScreenHeight / 2 * 1.3 * 2.5;
        };
        var tmpRatio = 0;
        var animIndex = 0;
        this.animate = function(delta) {
            if (this.animTime > 0) {
                this.animTime -= delta;
                if (this.animTime <= 0) {
                    this.animTime = 0;
                    this.dirPlus = 0;
                    tmpRatio = 0;
                    animIndex = 0;
                } else {
                    if (animIndex == 0) {
                        tmpRatio += delta / (this.animSpeed * config.hitReturnRatio);
                        this.dirPlus = UTILS.lerp(0, this.targetAngle, Math.min(1, tmpRatio));
                        if (tmpRatio >= 1) {
                            tmpRatio = 1;
                            animIndex = 1;
                        }
                    } else {
                        tmpRatio -= delta / (this.animSpeed * (1 - config.hitReturnRatio));
                        this.dirPlus = UTILS.lerp(0, this.targetAngle, Math.max(0, tmpRatio));
                    }
                }
            }
        };

        // ANIMATION:
        this.startAnim = function() {
            this.animTime = this.animSpeed = 600;
            this.targetAngle = Math.PI * 0.8;
            tmpRatio = 0;
            animIndex = 0;
        };

        // CHANGE HEALTH:
        this.changeHealth = function(val, doer, runFrom, environmental) {
            if (this.active) {
                if (runFrom && runFrom.builderMode) runFrom = null;
                var oldHealth = this.health;
                if (val < 0 && doer && doer.isPlayer && doer.accountMatchStats && !this.boss) {
                    doer.accountMatchStats.animalDamage += Math.min(-val, Math.max(0, oldHealth));
                }
                var threat = runFrom || doer;
                if (val < 0 && this.bullRepel && threat && threat.isPlayer) {
                    this.provokedPlayer = threat;
                }
                this.health += val;
                if (val < 0 && threat && (this.fleeOnDamage ||
                    (this.fleeFromSpikes && threat.group && threat.group.name === "spikes") ||
                    (this.fleeOnlyFromNonPlayers && !threat.isPlayer))) {
                    this.runFrom = threat;
                    this.chargeTarget = null;
                    this.waitCount = 0;
                    this.moveCount = 2000;
                } else if (val < 0 && threat &&
                    !(this.fleeFromSpikes && !threat.isPlayer)) {
                    if (this.hitScare && !UTILS.randInt(0, this.hitScare)) {
                        this.runFrom = threat;
                        this.waitCount = 0;
                        this.moveCount = 2000;
                    } else {
                        if (this.hostile && this.chargePlayer && threat.isPlayer) {
                            if (this.retaliatesOnlyWhenAttacked) {
                                this.provokedPlayer = threat;
                                this.runFrom = null;
                            }
                            this.chargeTarget = threat;
                            this.waitCount = 0;
                            this.moveCount = 8000;
                        } else {
                            if (!this.dontRun) {
                                this.runFrom = threat;
                                this.waitCount = 0;
                                this.moveCount = 2000;
                            }
                        }
                    }
                }
                if (val < 0 && this.hitRange && UTILS.randInt(0, 1)) {
                    this.hitWait = 500;
                }
                if (doer && doer.canSee(this) && val < 0) {
                    server.send(doer.id, "8", Math.round(this.x), Math.round(this.y), Math.round(-val), 1);
                }
                if (this.health <= 0) {
                    if (this.aquatic && environmental) {
                        this.health = 0;
                        this.active = false;
                        this.alive = false;
                        return;
                    }
                    if (this.spawnDelay) {
                        this.spawnCounter = this.spawnDelay;
                        this.x = -1000000;
                        this.y = -1000000;
                    } else {
                        this.x = this.startX || UTILS.randInt(0, config.mapScale);
                        this.y = this.startY || UTILS.randInt(0, config.mapScale);
                    }
                    this.health = this.maxHealth;
                    this.runFrom = null;
                    if (doer) {
                        if (doer.isPlayer && doer.accountMatchStats) {
                            if (this.boss) doer.accountMatchStats.boss_kills++;
                            else doer.accountMatchStats.animal_kills++;
                        }
                        scoreCallback(doer, this.goldReward ?? this.killScore);
                        var xpReward = this.xpReward ?? this.killScore * 2;
                        if (xpReward && typeof doer.earnXP === "function") {
                            doer.earnXP(xpReward);
                        }
                        if (this.drop) {
                            for (var i = 0; i < this.drop.length;) {
                                doer.addResource(config.resourceTypes.indexOf(this.drop[i]), this.drop[i + 1]);
                                i += 2;
                            }
                        }
                    }
                }
            }
        };
    };
}
