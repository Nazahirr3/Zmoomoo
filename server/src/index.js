import e from "express";
import { randomBytes } from "node:crypto";
import { fork, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { rateLimit } from "express-rate-limit";
import { encode } from "msgpack-lite";
import { Game } from "./moomoo/server.js";
import { Player } from "./moomoo/modules/player.js";
import { items } from "./moomoo/modules/items.js";
import { UTILS } from "./moomoo/libs/utils.js";
import { hats, accessories } from "./moomoo/modules/store.js";
import { filter_chat, getMuteDuration, formatMuteDuration, parseMuteDuration, handleDevCommand, getChatViolation, isSevereAcrossMessages, normalizeMessage, resetMuteStateIfNeeded } from "./moomoo/libs/filterchat.js";
import { parseClientPacket } from "./network/packetUtils.js";
import { createAccountStore } from "./moomoo/libs/account-store.js";
import { createJoinTokenService, registerAccountApi } from "./moomoo/libs/account-api.js";
import { getDiscordStaffRoles } from "./moomoo/libs/discord-role.js";
import { startDiscordBot } from "./moomoo/libs/discord-bot.js";
import { registerPrivateAdminApi } from "./moomoo/libs/private-admin-api.js";
import { createIpBlockList, getClientAddress, isAddressInBlockList, normalizeIpAddress, RollingWindowLimiter } from "./moomoo/libs/network-controls.js";
import { createModerationLogger, queueModerationLog } from "./moomoo/libs/moderation-log.js";
import { config } from "./moomoo/config.js";
import { ConnectionLimit } from "./moomoo/libs/limit.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const ROOT_ENV_FILE = path.resolve(__dirname, "../../.env");
const SERVER_ENV_FILE = path.resolve(__dirname, "../.env");
if (typeof process.loadEnvFile === "function") {
    if (fs.existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
    if (SERVER_ENV_FILE !== ROOT_ENV_FILE && fs.existsSync(SERVER_ENV_FILE)) process.loadEnvFile(SERVER_ENV_FILE);
}

const app = e();
const publicRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false
});


app.use(e.json()); // Add JSON body parser for API requests 

const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP || 4);
if (!Number.isSafeInteger(MAX_CONNECTIONS_PER_IP) || MAX_CONNECTIONS_PER_IP < 1) {
    throw new Error("MAX_CONNECTIONS_PER_IP must be a positive integer.");
}
const colimit = new ConnectionLimit(MAX_CONNECTIONS_PER_IP);

const server = createServer(app);
const wss = new WebSocketServer({
    server,
    maxPayload: Number(process.env.MAX_PACKET_BYTES) || 2048
});


const CLIENT_DIST_DIR = path.resolve(__dirname, "../../dist/client");
const UPDATE_CLIENT_DIST_DIR = path.resolve(__dirname, `../../dist/.client-update-${process.pid}`);
const INDEX = path.join(CLIENT_DIST_DIR, "html/play.html");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const SERVER_START_TIME = Date.now();
const CLAN_CREATE_COOLDOWN = 20 * 1000;
const CHAT_MUTE_STORE = new Map();
const JOIN_ATTEMPTS = new RollingWindowLimiter(10, 60 * 1000);
const proxyVpnRanges = createIpBlockList(process.env.PROXY_VPN_CIDRS || "");
const logModerationAction = createModerationLogger(process.env.MODERATION_LOG_WEBHOOK_URL || "");
const accountStore = createAccountStore();
// keep bot moderation behind the signed private api
registerPrivateAdminApi(app, {
    store: accountStore,
    logAction: logModerationAction
        ? event => queueModerationLog(logModerationAction, event)
        : null,
    disconnectAccount(discordId) {
        for (const player of game.players) {
            const user = player.accountId ? accountStore.getUserById(player.accountId) : null;
            if (user?.discord_id === discordId && player.socket) {
                player.socket.close(4003, "Account banned");
            }
        }
    }
});
const accountApi = registerAccountApi(app, {
    store: accountStore,
    joinTokens: createJoinTokenService(accountStore),
    authLimit: rateLimit({
        windowMs: 60 * 1000,
        limit: 5,
        standardHeaders: "draft-8",
        legacyHeaders: false
    }),
    joinLimit: rateLimit({
        windowMs: 60 * 1000,
        limit: 20,
        standardHeaders: "draft-8",
        legacyHeaders: false
    }),
    usernameLimit: rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 5,
        standardHeaders: "draft-8",
        legacyHeaders: false
    })
});
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
const SERVER_METADATA = {
    name: process.env.SERVER_NAME ?? "MooMoo Server",
    type: process.env.SERVER_TYPE ?? (config.isSandbox ? "sandbox" : "standard"),
    region: process.env.SERVER_REGION ?? "global"
};

const POINTS_RESOURCE_INDEX = config.resourceTypes ? config.resourceTypes.indexOf("points") : -1;

process.on("uncaughtException", error => {
    console.error("[server] Uncaught exception:", error);
    process.exit(1);
});
process.on("unhandledRejection", error => {
    console.error("[server] Unhandled rejection:", error);
    process.exit(1);
});

function isLocalAddress(address) {
    const value = normalizeIpAddress(address);
    return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

function allowJoinAttempt(address) {
    return JOIN_ATTEMPTS.allow(address);
}

function recordLowSeverityChat(player, now) {
    const windowMs = Number(config.chatShadowMuteWindow) || 10 * 60 * 1000;
    player.lowSeverityChatTimes = (player.lowSeverityChatTimes || []).filter(time => now - time < windowMs);
    player.lowSeverityChatTimes.push(now);
    if (player.lowSeverityChatTimes.length >= (Number(config.chatShadowMuteCount) || 3) &&
        player.shadowMuteUntil <= now) {
        player.shadowMuteUntil = now + windowMs;
        queueModerationLog(logModerationAction, {
            action: "automatic_shadow_mute",
            actor: "server",
            actorHasAccount: false,
            target: formatServerIdentity(player),
            targetHasAccount: Boolean(player.accountId),
            details: `Repeated low-severity chat violations for ${Math.ceil(windowMs / 60000)} minute(s).`
        });
    }
}

function formatServerIdentity(player) {
    return `${player.name || "unknown"} (Server ID: ${player.gameId || "unknown"})`;
}

function logGameCommand(player, commandText) {
    queueModerationLog(logModerationAction, {
        action: "game_command",
        actor: formatServerIdentity(player),
        actorHasAccount: Boolean(player.accountId),
        details: String(commandText).slice(0, 1000)
    });
}

function getChatMuteKey(player, addr) {
    const candidates = [];
    if (player && player.accountId) {
        candidates.push("user:" + player.accountId);
    }
    if (player && typeof player.name === "string" && player.name.trim().length > 0) {
        candidates.push(player.name.trim().toLowerCase());
    }
    if (addr) {
        candidates.push(String(addr).toLowerCase());
    }
    if (player && player.sid) {
        candidates.push(String(player.sid).toLowerCase());
    }
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (CHAT_MUTE_STORE.has(candidate)) {
            return candidate;
        }
    }
    return (candidates[0] || "unknown").toLowerCase();
}

function getChatMuteState(player, addr) {
    const key = getChatMuteKey(player, addr);
    const state = CHAT_MUTE_STORE.get(key) || {
        offenseCount: 0,
        lastOffenseAt: 0,
        muteUntil: 0,
        muteReason: "no reason given"
    };
    player.offenseCount = Number(state.offenseCount) || 0;
    player.lastOffenseAt = Number(state.lastOffenseAt) || 0;
    player.muteUntil = Number(state.muteUntil) || 0;
    player.muteReason = state.muteReason || "no reason given";
    player.shadowMuteUntil = Number(state.shadowMuteUntil) || 0;
    player.lowSeverityChatTimes = Array.isArray(state.lowSeverityChatTimes) ? state.lowSeverityChatTimes : [];
    resetMuteStateIfNeeded(player);
    const nextState = {
        offenseCount: player.offenseCount,
        lastOffenseAt: player.lastOffenseAt,
        muteUntil: player.muteUntil,
        muteReason: player.muteReason || "no reason given",
        shadowMuteUntil: player.shadowMuteUntil,
        lowSeverityChatTimes: player.lowSeverityChatTimes
    };
    CHAT_MUTE_STORE.set(key, nextState);
    return nextState;
}

function persistChatMuteState(player, addr) {
    const key = getChatMuteKey(player, addr);
    const state = {
        offenseCount: Number(player.offenseCount) || 0,
        lastOffenseAt: Number(player.lastOffenseAt) || 0,
        muteUntil: Number(player.muteUntil) || 0,
        muteReason: player.muteReason || "no reason given",
        shadowMuteUntil: Number(player.shadowMuteUntil) || 0,
        lowSeverityChatTimes: player.lowSeverityChatTimes || []
    };
    CHAT_MUTE_STORE.set(key, state);
    return state;
}

function recordAccountMatch(player, died) {
    if (!player || !player.accountId || player.accountMatchRecorded || !player.accountMatchStartedAt) return;
    player.accountMatchStats.score = player.points;
    accountStore.recordMatch(
        player.accountId,
        player.accountMatchStats,
        (Date.now() - player.accountMatchStartedAt) / 1000,
        died
    );
    player.accountMatchRecorded = true;
}

async function checkDiscordStaffRoles(player) {
    if (!player.accountId) return { owner: false, administrator: false };
    const user = accountStore.getUserById(player.accountId);
    if (!user || typeof user.discord_id !== "string") return { owner: false, administrator: false };
    return getDiscordStaffRoles(user.discord_id);
}

if (!fs.existsSync(INDEX)) {
    console.warn("[server] Client build not found. Run `npm run build --workspace client` first.");
}

const game = new Game;
let restartScheduled = false;
let updateInProgress = false;
let activeGlobalAnnouncement = null;

setInterval(() => {
    const roster = game.players.map(player => [
        player.sid,
        player.accountId || null,
        player.hasDiscordOwnerRole ? "owner" :
            player.hasDiscordAdministratorRole ? "administrator" : null,
        Boolean(player.staffHidden)
    ]);
    for (const player of game.players) {
        if (player.hasDiscordOwnerRole || player.hasDiscordAdministratorRole) player.send("oid", roster);
    }
}, 1000);

function updateStaffRoles(player, roles) {
    player.hasDiscordOwnerRole = Boolean(roles && roles.owner);
    player.hasDiscordAdministratorRole = Boolean(roles && roles.administrator);
    player.send("own", {
        owner: player.hasDiscordOwnerRole,
        administrator: player.hasDiscordAdministratorRole
    });
    if (!player.hasDiscordOwnerRole && !player.hasDiscordAdministratorRole) {
        player.send("oid", []);
        if (player.ownerShown) {
            player.ownerShown = false;
            game.server.broadcast("os", player.sid, false);
        }
    }
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd || REPO_ROOT,
            env: options.env || process.env,
            windowsHide: true,
            shell: options.shell || false,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let output = "";
        let settled = false;
        const timeout = setTimeout(() => {
            child.kill();
            finish(new Error(`${path.basename(command)} timed out`));
        }, options.timeout || 120000);

        function finish(error, result) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve(result);
        }

        child.stdout.on("data", chunk => {
            output = (output + chunk.toString()).slice(-10000);
        });
        child.stderr.resume();
        child.on("error", () => finish(new Error(`Could not start ${path.basename(command)}`)));
        child.on("close", code => {
            if (code !== 0) {
                finish(new Error(`${path.basename(command)} exited with code ${code}`));
                return;
            }
            finish(null, output.trim());
        });
    });
}

function replaceClientBuild() {
    const backupDir = CLIENT_DIST_DIR + `.backup-${process.pid}`;
    if (fs.existsSync(backupDir)) {
        throw new Error("A previous client build backup already exists.");
    }

    const hadBuild = fs.existsSync(CLIENT_DIST_DIR);
    if (hadBuild) fs.renameSync(CLIENT_DIST_DIR, backupDir);
    try {
        fs.renameSync(UPDATE_CLIENT_DIST_DIR, CLIENT_DIST_DIR);
    } catch (error) {
        if (hadBuild) fs.renameSync(backupDir, CLIENT_DIST_DIR);
        throw new Error("Could not activate the rebuilt game client.");
    }

    if (hadBuild) {
        try {
            fs.rmSync(backupDir, { recursive: true, force: true });
        } catch (error) {
            console.error("[server] Could not remove the previous client build:", error);
        }
    }
}

async function updateGameServer() {
    if (restartScheduled || updateInProgress) {
        throw new Error("A server update or restart is already in progress.");
    }
    updateInProgress = true;
    try {
        const changes = await runCommand("git", ["status", "--porcelain", "--untracked-files=normal"]);
        if (changes) {
            throw new Error("The server has local changes. Commit or stash them before using /update.");
        }

        const upstream = await runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
        if (!upstream) throw new Error("This server branch has no GitHub upstream configured.");
        const previousCommit = await runCommand("git", ["rev-parse", "--verify", "HEAD"]);
        await runCommand("git", ["fetch", "--quiet"], { timeout: 120000 });
        await runCommand("git", ["pull", "--ff-only", "--quiet"], { timeout: 120000 });

        const commit = await runCommand("git", ["rev-parse", "--short", "HEAD"]);
        const changedFiles = await runCommand("git", ["diff", "--name-only", previousCommit, commit]);
        if (changedFiles.split(/\r?\n/).some(file =>
            /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|client\/package\.json|server\/package\.json)$/.test(file)
        )) {
            const npmArgs = ["install", "--include=dev", "--no-package-lock"];
            if (process.env.npm_execpath) {
                await runCommand(process.execPath, [process.env.npm_execpath, ...npmArgs], {
                    timeout: 300000
                });
            } else {
                await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, {
                    shell: process.platform === "win32",
                    timeout: 300000
                });
            }
        }

        const webpack = [
            path.join(REPO_ROOT, "node_modules/webpack/bin/webpack.js"),
            path.join(REPO_ROOT, "client/node_modules/webpack/bin/webpack.js")
        ].find(file => fs.existsSync(file));
        if (!webpack) throw new Error("Client build tools are missing. Install the project dependencies first.");

        fs.rmSync(UPDATE_CLIENT_DIST_DIR, { recursive: true, force: true });
        await runCommand(process.execPath, [webpack, "--config", "webpack.config.js"], {
            cwd: path.join(REPO_ROOT, "client"),
            env: {
                ...process.env,
                CLIENT_DIST_DIR: UPDATE_CLIENT_DIST_DIR,
                NODE_ENV: "production"
            },
            timeout: 300000
        });
        replaceClientBuild();

        updateInProgress = false;
        if (!restartGameServer(20)) {
            throw new Error("The update built successfully, but the restart could not be scheduled.");
        }
        return commit;
    } catch (error) {
        console.error("[server] /update failed:", error);
        throw error;
    } finally {
        updateInProgress = false;
        if (fs.existsSync(UPDATE_CLIENT_DIST_DIR)) {
            fs.rmSync(UPDATE_CLIENT_DIST_DIR, { recursive: true, force: true });
        }
    }
}

function startReplacementServer() {
    let replacement;
    let settled = false;
    const startupTimeout = setTimeout(() => {
        if (replacement && replacement.exitCode === null) replacement.kill();
        failRestart(new Error("Replacement server did not become ready in 30 seconds."));
    }, 30000);

    function failRestart(error) {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimeout);
        restartScheduled = false;
        console.error("[server] Could not restart:", error);
    }

    try {
        replacement = fork(__filename, process.argv.slice(2), {
            cwd: REPO_ROOT,
            env: process.env,
            detached: true,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            windowsHide: true
        });
    } catch (error) {
        failRestart(error);
        return;
    }

    replacement.on("message", message => {
        if (settled || message?.type !== "server-ready") return;
        settled = true;
        clearTimeout(startupTimeout);
        replacement.disconnect();
        replacement.unref();
        process.exit(0);
    });
    replacement.once("error", failRestart);
    replacement.once("exit", (code, signal) => {
        if (!settled) {
            failRestart(new Error(`Replacement server exited before ready (${signal || code}).`));
        }
    });
}

function restartGameServer(seconds = 5) {
    if (restartScheduled || updateInProgress) return false;
    restartScheduled = true;

    let remaining = seconds;
    game.server.broadcast("Z", remaining);
    const countdown = setInterval(() => {
        remaining--;
        game.server.broadcast("Z", remaining);
        if (remaining > 0) return;
        clearInterval(countdown);

        for (const socket of wss.clients) {
            if (socket.readyState === 1) socket.close(1012, "Game server restarting");
        }

        const closeTimeout = setTimeout(() => {
            for (const socket of wss.clients) {
                if (socket.readyState !== 3) socket.terminate();
            }
        }, 1000);

        wss.close(() => {
            clearTimeout(closeTimeout);
            server.close(error => {
                if (error) {
                    restartScheduled = false;
                    console.error("[server] Could not close before restart:", error);
                    return;
                }

                accountStore.close();
                startReplacementServer();
            });
        });
    }, 1000);
    return true;
}

startDiscordBot({
    adminApi: {
        baseUrl: process.env.ADMIN_API_URL || `http://127.0.0.1:${PORT}`,
        apiKey: process.env.ADMIN_API_KEY
    },
    announce: announcement => {
        const sentAt = Date.now();
        activeGlobalAnnouncement = {
            ...announcement,
            sentAt,
            expiresAt: sentAt + announcement.message.length * 30 + 12000
        };
        game.server.broadcast("gm", activeGlobalAnnouncement);
    },
    restart: restartGameServer,
    update: updateGameServer,
    logCommand: event => queueModerationLog(logModerationAction, event),
    moderation: {
        ban(discordId, bannedUntil, reason, executorId) {
            const user = accountStore.banUser(discordId, bannedUntil, reason);
            accountStore.writeModerationAudit(executorId, "ban", discordId, {
                bannedUntil,
                reason,
                accountId: user?.id || null
            });
            let disconnected = false;
            for (const player of game.players) {
                const playerUser = player.accountId ? accountStore.getUserById(player.accountId) : null;
                if (!playerUser || playerUser.discord_id !== discordId || !player.socket) continue;
                disconnected = true;
                player.socket.close(4003, "Account banned");
            }
            return { user, disconnected };
        },
        unban(discordId, executorId) {
            const user = accountStore.unbanUser(discordId);
            accountStore.writeModerationAudit(executorId, "unban", discordId, {
                accountId: user?.id || null
            });
            return user;
        },
        banIp(address, bannedUntil, reason, executorId) {
            accountStore.banIp(address, bannedUntil, reason, executorId);
            return accountStore.writeModerationAudit(executorId, "ban_ip", executorId, {
                bannedUntil,
                reason,
                addressHash: accountStore.hashIpForAudit(address)
            }, "ip", accountStore.hashIpForAudit(address));
        },
        unbanIp(address, executorId) {
            accountStore.unbanIp(address);
            return accountStore.writeModerationAudit(executorId, "unban_ip", executorId, {
                addressHash: accountStore.hashIpForAudit(address)
            }, "ip", accountStore.hashIpForAudit(address));
        },
        lookup(query) {
            return accountStore.findModerationUsers(query);
        },
        isBanned(discordId) {
            return Boolean(accountStore.getBan(discordId));
        }
    }
});

app.get("/", publicRateLimit, (req, res) => {
    res.sendFile(INDEX)
});

app.get("/ping", publicRateLimit, (_req, res) => {
    const activePlayers = game.players.filter(player => player.alive);
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
        server: {
            ...SERVER_METADATA,
            host: HOST,
            port: PORT,
            isSandbox: Boolean(config.isSandbox),
            maxPlayers: config.maxPlayers,
            maxPlayersHard: config.maxPlayersHard
        },
        players: {
            totalConnected: game.players.length,
            activeCount: activePlayers.length,
            list: activePlayers.map(player => ({
                sid: player.sid,
                name: player.name,
                score: player.points,
                kills: player.kills
            }))
        }
    });
});

app.get("/play", publicRateLimit, (req, res) => {
    res.sendFile(INDEX);
});

app.use(e.static(CLIENT_DIST_DIR));

wss.on("connection", async (socket, req) => {

    if (game.players.length >= config.maxPlayersHard) {
        return void socket.close();
    }

    const addr = getClientAddress(req, process.env.TRUST_PROXY === "true");
    const localConnection = isLocalAddress(addr);
    // This only marks staff-visible risk; it never blocks a connection.
    const proxyVpnRisk = isAddressInBlockList(addr, proxyVpnRanges);
    if (accountStore.isIpBanned(addr)) {
        return void socket.close(4003, "IP banned");
    }

    if (
        colimit.check(addr)
    ) {
        return void socket.close(4001, "Connection limit");
    }

    colimit.up(addr);

    let player = game.addPlayer(socket, false);
    let handshakeTimer = setTimeout(() => {
        if (!player.joinTokenVerified && socket.readyState === 1) socket.close(4003, "join token timeout");
    }, 5000);
    player.isMuted = function() {
        return Boolean(this.muteUntil && this.muteUntil > Date.now());
    };
    player.offenseCount = 0;
    player.lastOffenseAt = 0;
    player.muteUntil = 0;
    player.muteReason = "no reason given";
    player.chatCooldownDisabled = false;
    player.shadowMuteUntil = 0;
    player.lowSeverityChatTimes = [];
    player.recentChatMessages = [];
    player.chatAttemptTimes = [];
    player.lastChatMessage = "";
    player.joinTokenVerified = false;
    player.accountId = null;
    player.gameId = randomBytes(12).toString("base64url");
    player.proxyVpnRisk = proxyVpnRisk;
    player.remoteAddress = addr;
    player.ownerCommandCooldownUntil = 0;
    player.staffHidden = false;
    player.accountMatchStartedAt = 0;
    player.accountMatchRecorded = false;
    const killPlayer = player.kill.bind(player);
    player.kill = function(doer) {
        const wasAlive = this.alive;
        killPlayer(doer);
        if (wasAlive) recordAccountMatch(this, true);
    };
    getChatMuteState(player, addr);
    player.send("m", {
        muted: player.isMuted(),
        until: player.muteUntil || 0,
        timeLeft: formatMuteDuration(Math.max(0, (player.muteUntil || 0) - Date.now())),
        reason: player.muteReason || "no reason given"
    });

    const emit = (type, ...data) => {

        if (!player.socket || socket.readyState !== 1) return false;
        try {
            socket.send(encode([type, data]));
            return true;
        } catch (error) {
            console.error(`[server] Failed to send packet to ${player.id}:`, error);
            return false;
        }
    };

    const handleInvalidPacket = reason => {

        const identifier = typeof player.sid !== "undefined" ? player.sid : "unknown";
        console.warn(`[server] Closing connection for player ${identifier} at ${addr}: ${reason}`);

        if (player.socket) {
            try {
                player.socket.close(4002);
            } catch (closeError) {
                console.error("Failed to close socket after invalid packet:", closeError);
            } finally {
                player.socket = null;
            }
        }

    };

    socket.on("message", async msg => {

        try {

            const now = Date.now();
            if (!player.packetWindowStart || (now - player.packetWindowStart) >= 1000) {
                player.packetWindowStart = now;
                player.packetCounter = 0;
            }
            player.packetCounter++;
            if (player.packetCounter > 1000) {
                handleInvalidPacket(`packet rate limit exceeded (${player.packetCounter} > 1000)`);
                return;
            }

            const { type: t, payload: data } = parseClientPacket(msg);

            if (!player.joinTokenVerified) {
                if (t !== "A" || typeof data[0] !== "string") {
                    handleInvalidPacket("missing account join token");
                    return;
                }

                const claims = accountApi.joinTokens.verify(data[0]);
                if (!claims) {
                    handleInvalidPacket("invalid or expired account join token");
                    return;
                }

                if (claims.userId !== null) {
                    const user = accountStore.getUserById(claims.userId);
                    if (!user || (user.banned_until && user.banned_until > Date.now())) {
                        handleInvalidPacket("account is unavailable");
                        return;
                    }
                    player.accountId = Number(user.id);
                    player.gameId = user.game_id;
                    player.accountUsername = user.username;
                    checkDiscordStaffRoles(player)
                        .then(roles => {
                            if (player.socket) updateStaffRoles(player, roles);
                        })
                        .catch(error => console.error("[discord] Staff role check failed:", error.message));
                    const punishment = accountStore.getPunishment(player.accountId);
                    const now = Date.now();
                    const resetAfter = (Number(config.chatMuteResetDays) || 3) * 24 * 60 * 60 * 1000;
                    if (punishment.last_offense_at && now - punishment.last_offense_at >= resetAfter) {
                        accountStore.savePunishment(player.accountId, 0, 0, 0);
                        player.offenseCount = 0;
                        player.lastOffenseAt = 0;
                        player.muteUntil = 0;
                    } else {
                        player.offenseCount = Number(punishment.offense_count) || 0;
                        player.lastOffenseAt = Number(punishment.last_offense_at) || 0;
                        player.muteUntil = Number(punishment.muted_until) || 0;
                    }
                    player.muteReason = player.isMuted()
                        ? String(punishment.mute_reason || "no reason given")
                        : "no reason given";
                    CHAT_MUTE_STORE.set(getChatMuteKey(player, addr), {
                        offenseCount: player.offenseCount,
                        lastOffenseAt: player.lastOffenseAt,
                        muteUntil: player.muteUntil,
                        muteReason: player.muteReason,
                        shadowMuteUntil: 0,
                        lowSeverityChatTimes: []
                    });
                    player.send("m", {
                        muted: player.isMuted(),
                        until: player.muteUntil || 0,
                        timeLeft: formatMuteDuration(Math.max(0, (player.muteUntil || 0) - Date.now())),
                        reason: player.muteReason
                    });
                }

                if (!game.activatePlayer(player)) {
                    handleInvalidPacket("server is full");
                    return;
                }
                player.joinTokenVerified = true;
                clearTimeout(handshakeTimer);
                player.send("cd", player.chatCooldownDisabled);
                player.send("os", game.players
                    .filter(target => target.ownerShown && target.socket?.readyState === 1)
                    .map(target => target.sid));
                player.send("sh", game.players
                    .filter(target => target.shielded && target.socket?.readyState === 1)
                    .map(target => target.sid));
                player.send("sl", game.players
                    .filter(target => target.sleighMode && target.socket?.readyState === 1)
                    .map(target => target.sid));
                player.send("j");
                if (activeGlobalAnnouncement) {
                    if (activeGlobalAnnouncement.expiresAt > Date.now()) {
                        player.send("gm", activeGlobalAnnouncement);
                    } else {
                        activeGlobalAnnouncement = null;
                    }
                }
                return;
            }

            switch(t) {
                case "M": {

                    if (player.alive) {
                        break;
                    }

                    if (!allowJoinAttempt(addr)) {
                        socket.close(4001, "Too many join attempts");
                        return;
                    }

                    const requestedUserData = data[0] && typeof data[0] === "object" ? data[0] : {};
                    const userData = player.accountId ?
                        { ...requestedUserData, name: player.accountUsername } : data[0];
                    const validName = player.setUserData(userData);
                    if (!validName) {
                        try {
                            socket.close(1008, "Your username has been flagged as inappropriate. Please choose a different username to continue playing");
                        } catch (closeError) {
                            console.warn("Failed to reject bad username:", closeError);
                        }
                        return;
                    }

                    player.accountMatchStartedAt = Date.now();
                    player.accountMatchRecorded = false;
                    player.accountMatchStats = {
                        kills: 0,
                        score: 0,
                        damage: 0,
                        healing: 0,
                        wood: 0,
                        food: 0,
                        stone: 0,
                        gold: 0,
                        animal_kills: 0,
                        boss_kills: 0,
                        animal_damage: 0,
                        lives: 1
                    };
                    player.spawn(data[0]?.moofoll);
                    player.send("C", player.sid);

                    break;
                }
                case "9": {

                    if (!player.alive) {
                        break;
                    }

                    if (!(data[0] === undefined || data[0] === null) && !UTILS.isNumber(data[0])) break;

                    player.moveDir = data[0];
                    break;

                }
                case "F": {

                    if (!player.alive) {
                        break;
                    }

                    if (player.sleighMode) {
                        player.mouseState = 0;
                        player.hits = 0;
                        player.gathering = 0;
                        break;
                    }

                    player.mouseState = data[0];
                    if (!data[0]) {
                        player.hits = 0;
                        player.gathering = 0;
                    }
                    if (data[0] && player.buildIndex === -1) {
                        player.hits++;
                    }
    
                    if (UTILS.isNumber(data[1])) {
                        player.dir = data[1];
                    }
    
                    if (player.buildIndex >= 0) {
                        const item = items.list[player.buildIndex];
                        if (data[0]) {

                            player.packet_spam++;

                            if (player.packet_spam >= 10000) {
                                if (player.socket) {
                                    player.socket.close();
                                    player.socket = null;
                                }
                            }

                            player.buildItem(item);
                            
                        }
                        player.mouseState = 0;
                        player.hits = 0;
                    }
                    break;

                }
                case "bp": {
                    if (!player.alive || !player.builderMode ||
                        !Number.isFinite(data[0]) || !Number.isFinite(data[1])) {
                        break;
                    }
                    player.builderPlaceX = Math.min(config.mapScale, Math.max(0, data[0]));
                    player.builderPlaceY = Math.min(config.mapScale, Math.max(0, data[1]));
                    break;
                }
                case "bs": {
                    if (!player.alive || !player.builderMode ||
                        !Number.isInteger(data[0]) ||
                        !Number.isFinite(data[1]) || !Number.isFinite(data[2])) {
                        break;
                    }
                    const mobType = game.ai_manager.aiTypes[data[0]];
                    if (!mobType || (player.builderMobSpawnCooldownUntil || 0) > Date.now()) {
                        break;
                    }
                    const builderMobCount = game.ais.reduce((count, mob) =>
                        count + (mob.active && mob.builderSpawned ? 1 : 0), 0);
                    if (builderMobCount >= 100) {
                        player.send("w", "Builder mob limit reached (100).");
                        break;
                    }
                    const x = Math.min(config.mapScale - mobType.scale,
                        Math.max(mobType.scale, data[1]));
                    const y = Math.min(config.mapScale - mobType.scale,
                        Math.max(mobType.scale, data[2]));
                    const mob = game.ai_manager.spawn(x, y, 0, data[0], true);
                    mob.builderSpawnedBySid = player.sid;
                    player.builderMobSpawnCooldownUntil = Date.now() + 500;
                    break;
                }
                case "K": {
                    if (!player.alive) {
                        break;
                    }

                    if (player.sleighMode) {
                        player.autoGather = 0;
                        player.mouseState = 0;
                        player.hits = 0;
                        player.gathering = 0;
                        player.send("ag", false);
                        break;
                    }

                    if (data[0]) {
                        player.autoGather = typeof data[1] === "boolean"
                            ? data[1]
                            : !player.autoGather;
                        if (!player.autoGather) {
                            player.mouseState = 0;
                            player.hits = 0;
                            player.gathering = 0;
                        }
                        player.send("ag", Boolean(player.autoGather));
                    }
                    break;

                }
                case "sw": {
                    if (!player.alive || !player.sleighMode ||
                        (data[0] !== -1 && data[0] !== 1)) {
                        break;
                    }
                    player.sleighSpeedMultiplier = Math.max(0.5, Math.min(20,
                        Math.round((player.sleighSpeedMultiplier + data[0] * 0.25) * 100) / 100));
                    player.send("sls", player.sleighSpeedMultiplier);
                    break;
                }
                case "D": {

                    if (!player.alive) {
                        break;
                    }

                    if (!UTILS.isNumber(data[0])) break;

                    player.dir = data[0];
                    break;

                }
                case "z": {

                    if (!player.alive) {
                        break;
                    }

                    if (!UTILS.isNumber(data[0])) {
                        break;
                    }

                    if (data[1]) {

                        const wpn = items.weapons[data[0]];

                        if (!wpn) {
                            break;
                        }

                        if (player.weapons[wpn.type] !== data[0]) {
                            break;
                        }

                        player.buildIndex = -1;
                        player.weaponIndex = data[0];
                        break;
                    }

                    const item = items.list[data[0]];
                    if (!item || !Array.isArray(player.items) ||
                        (player.builderMode
                            ? !item.group || !item.group.place || item.consume
                            : !player.items.includes(data[0]))) {
                        break;
                    }

                    if (player.buildIndex === data[0]) {
                        player.buildIndex = -1;
                        player.mouseState = 0;
                        break;
                    }

                    player.buildIndex = data[0];
                    player.mouseState = 0;
                    break;

                }
                case "c": {

                    if (!player.alive) {
                        break;
                    }

                    const [type, id, index] = data;

                    if (index) {
                        let tail = accessories.find(acc => acc.id == id);
            
                        if (tail) {
                            if (type) {
                                if (!player.tails[id] && player.points >= tail.price) {
                                    player.tails[id] = 1;
                                    emit("5", 0, id, 1);
                                }
                            } else {
                                if (player.tails[id]) {
                                    player.tail = tail;
                                    player.tailIndex = player.tail.id;
                                    emit("5", 1, id, 1);
                                }
                            }
                        } else {
                            if (id == 0) {
                                player.tail = {};
                                player.tailIndex = 0;
                                emit("5", 1, 0, 1);
                            }
                        }
                    } else {
                        let hat = hats.find(hat => hat.id == id);
            
                        if (hat) {
                            if (type) {
                                if (!player.skins[id] && player.points >= hat.price) {
                                    if (hat.price > 0) {
                                        if (POINTS_RESOURCE_INDEX !== -1) {
                                            player.addResource(POINTS_RESOURCE_INDEX, -hat.price, true);
                                        } else {
                                            player.points -= hat.price;
                                            player.send("N", "points", player.points, 1);
                                        }
                                    }
                                    player.skins[id] = 1;
                                    emit("5", 0, id, 0);
                                }
                            } else {
                                if (player.skins[id]) {
                                    player.skin = hat;
                                    player.skinIndex = player.skin.id;
                                    emit("5", 1, id, 0);
                                }
                            }
                        } else {
                            if (id == 0) {
                                player.skin = {};
                                player.skinIndex = 0;
                                emit("5", 1, 0, 0);
                            }
                        }
                    }

                    break;

                }
                case "H": {

                    if (!player.alive) {
                        break;
                    }

                    if (player.upgradePoints <= 0) break;

                    const item = Number.parseInt(data[0]);

                    const upgr_items = items.list.filter(x => x.age === player.upgrAge);
                    const upgr_weapons = items.weapons.filter(x => x.age === player.upgrAge);

                    const update = (() => {

                        if (item < items.weapons.length) {

                            const wpn = upgr_weapons.find(x => x.id === item);

                            if (!wpn) return false;

                            player.weapons[wpn.type] = wpn.id;
                            player.weaponXP[wpn.type] = 0;

                            const type = player.weaponIndex < 9 ? 0 : 1;

                            if (wpn.type === type) {
                                player.weaponIndex = wpn.id;
                            }

                            return true;

                        }

                        const i2 = item - items.weapons.length;

                        if (!upgr_items.some(x => x.id === i2)) return false;

                        player.addItem(i2);

                        return true;
                        
                    })();

                    if (!update) break;

                    player.upgrAge++;
                    player.upgradePoints--;

                    player.send("V", player.items, 0);
                    player.send("V", player.weapons, 1);

                    if (player.age >= 0) {
                        player.send("U", player.upgradePoints, player.upgrAge);
                    } else {
                        player.send("U", 0, 0);
                    }

                    break;
                }
                case "6": {
                    if (typeof data[0] !== "string") {
                        break;
                    }

                    let rawText = data[0].trim();
                    if (rawText.length === 0) {
                        break;
                    }

                    const sleighCommandMatch = /^\/sleigh(?:\s|$)/i.exec(rawText);
                    if (sleighCommandMatch) {
                        logGameCommand(player, rawText);
                        const args = rawText.split(/\s+/).slice(1);
                        const selfTarget = args.length === 0 ||
                            (args.length === 2 && args[0].toLowerCase() === "no" &&
                                args[1].toLowerCase() === "id");
                        if (!selfTarget && (args.length !== 1 || !/^[A-Za-z0-9_-]{16}$/.test(args[0]))) {
                            player.send("w", "Use /sleigh to toggle your sleigh, or /sleigh <player ID> to toggle another player's sleigh.");
                            break;
                        }
                        if ((player.sleighCommandCooldownUntil || 0) > Date.now()) break;
                        player.sleighCommandCooldownUntil = Date.now() + 1000;
                        if (!player.alive) {
                            player.send("w", "You can only use /sleigh while alive.");
                            break;
                        }
                        if (player.builderMode) {
                            player.send("w", "Disable Builder mode before using the sleigh.");
                            break;
                        }
                        if (!player.accountId) {
                            player.send("w", "Sign in and verify your Discord owner or administrator role to use the sleigh command.");
                            break;
                        }
                        const roles = await checkDiscordStaffRoles(player);
                        updateStaffRoles(player, roles);
                        if (!roles.owner && !roles.administrator) {
                            player.send("w", "Only Discord owners and administrators can use the sleigh command.");
                            break;
                        }
                        let target = player;
                        if (!selfTarget) {
                            target = game.players.find(value =>
                                value.gameId === args[0] &&
                                value.joinTokenVerified &&
                                value.hasJoinedGame &&
                                value.alive &&
                                value.socket?.readyState === 1
                            );
                            if (!target) {
                                player.send("w", "That player ID is not online or is not alive.");
                                break;
                            }
                            if (target.builderMode) {
                                player.send("w", "That player must disable Builder mode before using the sleigh.");
                                break;
                            }
                        }
                        target.sleighMode = !target.sleighMode;
                        target.sleighSpeedMultiplier = 1;
                        target.autoGather = 0;
                        target.mouseState = 0;
                        target.hits = 0;
                        target.gathering = 0;
                        if (target.sleighMode) target.dmgOverTime = {};
                        game.server.broadcast("sl", target.sid, target.sleighMode);
                        target.send("sls", target.sleighSpeedMultiplier);
                        target.send("w", target.sleighMode
                            ? "Sleigh enabled. Scroll up to speed up or down to slow down."
                            : "Sleigh disabled.");
                        if (target !== player) {
                            player.send("w", `Sleigh ${target.sleighMode ? "enabled" : "disabled"} for ${target.name || "that player"}.`);
                        }
                        break;
                    }

                    const clearCommandMatch = /^\/(clear|clearmo)(?:\s|$)/i.exec(rawText);
                    if (clearCommandMatch) {
                        const command = clearCommandMatch[1].toLowerCase();
                        logGameCommand(player, rawText);
                        const args = rawText.split(/\s+/).slice(1);
                        if (args.length) {
                            player.send("w", command === "clear"
                                ? "Use /clear to destroy your buildings."
                                : "Use /clearmo to remove the mobs you spawned in Builder mode.");
                            break;
                        }
                        if ((player.clearCommandCooldownUntil || 0) > Date.now()) break;
                        player.clearCommandCooldownUntil = Date.now() + 1000;
                        if (command === "clear") {
                            game.object_manager.removePlayerBuildings(player, game.server);
                            player.send("w", "All of your buildings have been destroyed.");
                        } else {
                            const removed = game.ai_manager.clearBuilderSpawns(player);
                            player.send("w", removed
                                ? `Cleared ${removed} Builder-spawned mob${removed === 1 ? "" : "s"}.`
                                : "You have no Builder-spawned mobs to clear.");
                        }
                        break;
                    }

                    const commandMatch = /^\/(owner|mute|unmute|show|hide|chatcooldown|tp|builder|shield)(?:\s|$)/i.exec(rawText);
                    if (commandMatch) {
                        const command = commandMatch[1].toLowerCase();
                        const args = rawText.trim().split(/\s+/).slice(1);
                        logGameCommand(player, rawText);
                        if (player.ownerCommandCooldownUntil > Date.now()) break;
                        player.ownerCommandCooldownUntil = Date.now() + 1000;

                        if (!player.accountId) {
                            break;
                        }

                        try {
                            const roles = await checkDiscordStaffRoles(player);
                            updateStaffRoles(player, roles);
                            if (command === "owner" && !roles.owner) {
                                break;
                            }
                            if (!roles.owner && !roles.administrator) {
                                break;
                            }

                            if (command === "owner") {
                                player.send("w", roles.administrator && !roles.owner
                                    ? "Discord administrator role verified. Your name is red. Press Tab for the staff player menu."
                                    : "Discord owner role verified. Your name is orange. Press Tab for the staff player menu.");
                            } else if (command === "show" || command === "hide") {
                                player.ownerShown = command === "show";
                                player.staffHidden = command === "hide";
                                game.server.broadcast("os", player.sid, player.ownerShown);
                                const staffLabel = roles.administrator && !roles.owner ? "administrator" : "owner";
                                player.send("w", player.ownerShown
                                    ? `You are now shown as an ${staffLabel} to other players.`
                                    : `You are hidden as an ${staffLabel} from other players.`);
                            } else if (command === "tp") {
                                const targetId = args[0] || "";
                                if (args.length !== 1 || !/^[A-Za-z0-9_-]{16}$/.test(targetId)) {
                                    player.send("w", "Use /tp <player ID>. Press Tab to find player IDs.");
                                    break;
                                }
                                const target = game.players.find(value =>
                                    value.gameId === targetId &&
                                    value.joinTokenVerified &&
                                    value.hasJoinedGame &&
                                    value.alive &&
                                    value.socket?.readyState === 1
                                );
                                if (!target) {
                                    player.send("w", "That player ID is not online or is not alive.");
                                    break;
                                }
                                if (target === player ||
                                    (player.accountId && target.accountId === player.accountId)) {
                                    player.send("w", "That is your own player ID.");
                                    break;
                                }
                                const x = Math.min(config.mapScale - player.scale,
                                    Math.max(player.scale, target.x));
                                const y = Math.min(config.mapScale - player.scale,
                                    Math.max(player.scale, target.y));
                                player.x = x;
                                player.y = y;
                                player.xVel = 0;
                                player.yVel = 0;
                                player.resetMoveDir();
                                player.send("tp", x, y);
                                player.send("w", `Teleported to ${target.name}.`);
                                queueModerationLog(logModerationAction, {
                                    action: "teleport",
                                    actor: formatServerIdentity(player),
                                    actorHasAccount: Boolean(player.accountId),
                                    target: formatServerIdentity(target),
                                    targetHasAccount: Boolean(target.accountId)
                                });
                            } else if (command === "builder") {
                                if (args.length) {
                                    player.send("w", "Use /builder to toggle builder mode.");
                                    break;
                                }
                                if (!player.alive) {
                                    player.send("w", "Builder mode can only be toggled while alive.");
                                    break;
                                }
                                player.setBuilderMode(!player.builderMode);
                                player.send("V", player.items, 0);
                                player.send("bm", player.builderMode);
                                player.send("w", player.builderMode
                                    ? "Builder mode enabled. Press Shift+Tab for the building catalog."
                                    : "Builder mode disabled. Your original inventory has been restored.");
                            } else if (command === "shield") {
                                if (args.length) {
                                    player.send("w", "Use /shield to toggle your shield.");
                                    break;
                                }
                                player.shielded = !player.shielded;
                                game.server.broadcast("sh", player.sid, player.shielded);
                                player.send("w", player.shielded
                                    ? "Shield enabled. Attacks against you will show as invincible!"
                                    : "Shield disabled.");
                            } else if (command === "chatcooldown") {
                                const action = (args[0] || "").toLowerCase();
                                const targetId = args[1] || "";
                                if (args.length !== 2 || !["disable", "enable"].includes(action) ||
                                    !/^[A-Za-z0-9_-]{16}$/.test(targetId)) {
                                    player.send("w", "Use /chatcooldown <disable|enable> <player ID>. Press Tab to find IDs.");
                                    break;
                                }
                                const target = game.players.find(value =>
                                    value.gameId === targetId &&
                                    value.joinTokenVerified &&
                                    value.hasJoinedGame &&
                                    value.socket?.readyState === 1
                                );
                                if (!target) {
                                    player.send("w", "That player ID is not online.");
                                    break;
                                }
                                target.chatCooldownDisabled = action === "disable";
                                target.chat_cooldown = 0;
                                target.send("cd", target.chatCooldownDisabled);
                                target.send("w", `Chat cooldown ${action}d for your current session.`);
                                player.send("w", `Chat cooldown ${action}d for ${target.name} until they disconnect.`);
                                queueModerationLog(logModerationAction, {
                                    action: `chatcooldown_${action}`,
                                    actor: formatServerIdentity(player),
                                    actorHasAccount: Boolean(player.accountId),
                                    target: formatServerIdentity(target),
                                    targetHasAccount: Boolean(target.accountId),
                                    details: `Cooldown ${action}d for this connection.`
                                });
                            } else if (command === "mute" || command === "unmute") {
                                const targetId = args[0] || "";
                                const target = /^[A-Za-z0-9_-]{16}$/.test(targetId)
                                    ? game.players.find(value =>
                                        value.gameId === targetId &&
                                        value.joinTokenVerified &&
                                        value.hasJoinedGame &&
                                        value.socket?.readyState === 1
                                    )
                                    : null;
                                const invalidArguments = command === "mute"
                                    ? args.length < 2
                                    : args.length !== 1;
                                if (invalidArguments) {
                                    player.send("w", command === "mute"
                                        ? "Use /mute <player ID> <duration> [reason], such as /mute <player ID> 10m spam."
                                        : "Use /unmute <player id>. Press Tab to find IDs.");
                                    break;
                                }
                                if (!target) {
                                    player.send("w", "That player ID is not online. Press Tab to find IDs.");
                                    break;
                                }
                                if (target === player ||
                                    (player.accountId && target.accountId === player.accountId)) {
                                    player.send("w", "That is your own player ID. Use the target player's ID from the Tab menu.");
                                    break;
                                }

                                if (command === "mute" && roles.administrator && !roles.owner && target.accountId) {
                                    const targetRoles = await checkDiscordStaffRoles(target);
                                    updateStaffRoles(target, targetRoles);
                                    if (targetRoles.owner) {
                                        player.send("w", "Administrators cannot moderate the owner's chat.");
                                        break;
                                    }
                                }

                                if (command === "mute") {
                                    const duration = parseMuteDuration(args[1] || "");
                                    if (!duration || !Number.isSafeInteger(Date.now() + duration)) {
                                        player.send("w", "Use /mute <player ID> <duration> [reason], such as /mute <player ID> 10m spam.");
                                        break;
                                    }
                                    const reason = args.slice(2).join(" ").replace(/\s+/g, " ").trim().slice(0, 500) ||
                                        "no reason given";
                                    const now = Date.now();
                                    target.muteUntil = now + duration;
                                    target.muteReason = reason;
                                    if (target.accountId) {
                                        const punishment = accountStore.getPunishment(target.accountId);
                                        accountStore.savePunishment(
                                            target.accountId,
                                            punishment.offense_count,
                                            punishment.last_offense_at,
                                            target.muteUntil,
                                            reason
                                        );
                                    }
                                    persistChatMuteState(target, target.remoteAddress);
                                    target.send("m", {
                                        muted: true,
                                        until: target.muteUntil,
                                        timeLeft: formatMuteDuration(target.muteUntil - now),
                                        reason
                                    });
                                    player.send("w", `Muted ${target.name} for ${formatMuteDuration(duration)}. Reason: ${reason}.`);
                                    queueModerationLog(logModerationAction, {
                                        action: "manual_mute",
                                        actor: formatServerIdentity(player),
                                        actorHasAccount: Boolean(player.accountId),
                                        target: formatServerIdentity(target),
                                        targetHasAccount: Boolean(target.accountId),
                                        details: `Duration: ${formatMuteDuration(duration)}\nReason: ${reason}`
                                    });
                                } else {
                                    target.muteUntil = 0;
                                    target.muteReason = "no reason given";
                                    if (target.accountId) {
                                        const punishment = accountStore.getPunishment(target.accountId);
                                        accountStore.savePunishment(
                                            target.accountId,
                                            punishment.offense_count,
                                            punishment.last_offense_at,
                                            0,
                                            "no reason given"
                                        );
                                    }
                                    persistChatMuteState(target, target.remoteAddress);
                                    target.send("m", { muted: false, until: 0, timeLeft: "0m", reason: "" });
                                    player.send("w", `Unmuted ${target.name}. Only you can see this confirmation.`);
                                    queueModerationLog(logModerationAction, {
                                        action: "manual_unmute",
                                        actor: formatServerIdentity(player),
                                        actorHasAccount: Boolean(player.accountId),
                                        target: formatServerIdentity(target),
                                        targetHasAccount: Boolean(target.accountId)
                                    });
                                }
                            }
                        } catch (error) {
                            console.error("[discord] Staff role check failed:", error.message);
                            player.send("w", "Could not verify your Discord role. Try again later.");
                        }
                        break;
                    }

                    if (!player.alive) {
                        break;
                    }

                    if (player.isMuted()) {
                        player.send("m", {
                            muted: true,
                            until: player.muteUntil || 0,
                            timeLeft: formatMuteDuration(Math.max(0, (player.muteUntil || 0) - Date.now())),
                            reason: player.muteReason || "no reason given"
                        });
                        break;
                    }

                    if (config.chatCooldownEnabled !== false &&
                        !player.chatCooldownDisabled &&
                        player.chat_cooldown > 0) {
                        break;
                    }

                    if (rawText.length > 30) {
                        break;
                    }

                    if (typeof rawText === "string" && rawText.startsWith("!")) {
                        if (process.env.NODE_ENV !== "production" && localConnection && handleDevCommand(player, rawText)) {
                            persistChatMuteState(player, addr);
                            player.send("m", {
                                muted: player.isMuted(),
                                until: player.muteUntil || 0,
                                timeLeft: formatMuteDuration(Math.max(0, (player.muteUntil || 0) - Date.now())),
                                reason: player.muteReason || "no reason given"
                            });
                            break;
                        }
                    }

                    const now = Date.now();
                    player.chat_cooldown = config.chatCooldownEnabled !== false && !player.chatCooldownDisabled ?
                        (config.chatCooldown || 1300) : 0;
                    const filterOptions = {
                        enabled: config.chatFilterEnabled !== false,
                        antiBypass: config.chatFilterAntiBypass !== false
                    };
                    const violation = getChatViolation(rawText, filterOptions);
                    const recentMessages = (player.recentChatMessages || []).filter(message =>
                        now - message.time < (Number(config.chatCrossMessageWindow) || 3000)
                    );
                    const crossMessages = recentMessages.slice(-(Number(config.chatCrossMessageCount) || 3) + 1)
                        .map(message => message.text)
                        .concat(rawText);
                    const severeViolation = (violation && violation.severity === "severe") ||
                        isSevereAcrossMessages(crossMessages, filterOptions);

                    if (severeViolation) {
                        const record = getChatMuteState(player, addr);
                        record.offenseCount = Math.min(Number.MAX_SAFE_INTEGER, (Number(record.offenseCount) || 0) + 1);
                        record.lastOffenseAt = now;
                        player.offenseCount = record.offenseCount;
                        player.lastOffenseAt = record.lastOffenseAt;
                        player.muteUntil = Math.min(Number.MAX_SAFE_INTEGER, now + getMuteDuration(record.offenseCount));
                        player.muteReason = "automatic chat filter violation";
                        record.muteUntil = player.muteUntil;
                        record.muteReason = player.muteReason;
                        CHAT_MUTE_STORE.set(getChatMuteKey(player, addr), record);
                        if (player.accountId) {
                            accountStore.savePunishment(
                                player.accountId,
                                record.offenseCount,
                                record.lastOffenseAt,
                                record.muteUntil,
                                player.muteReason
                            );
                        }
                        queueModerationLog(logModerationAction, {
                            action: "automatic_chat_mute",
                            actor: "server",
                            actorHasAccount: false,
                            target: formatServerIdentity(player),
                            targetHasAccount: Boolean(player.accountId),
                            details: `Severe chat violation ${record.offenseCount}; muted for ${formatMuteDuration(player.muteUntil - now)}.`
                        });
                        player.send("m", {
                            muted: true,
                            until: player.muteUntil,
                            timeLeft: formatMuteDuration(player.muteUntil - now),
                            reason: player.muteReason
                        });
                        break;
                    }

                    const normalized = normalizeMessage(rawText);
                    const duplicateWindow = Number(config.chatDuplicateWindow) || 10000;
                    if (normalized && normalized === player.lastChatMessage &&
                        now - (player.lastChatMessageAt || 0) < duplicateWindow) {
                        recordLowSeverityChat(player, now);
                        persistChatMuteState(player, addr);
                        break;
                    }

                    const burstWindow = Number(config.chatBurstWindow) || 10000;
                    player.chatAttemptTimes = (player.chatAttemptTimes || []).filter(time => now - time < burstWindow);
                    if (player.chatAttemptTimes.length >= (Number(config.chatBurstCount) || 5)) {
                        recordLowSeverityChat(player, now);
                        persistChatMuteState(player, addr);
                        break;
                    }

                    player.chatAttemptTimes.push(now);

                    if (violation && violation.severity === "blocked") {
                        recordLowSeverityChat(player, now);
                        persistChatMuteState(player, addr);
                        break;
                    }

                    const chat = filter_chat(rawText, filterOptions);
                    if (!chat) break;

                    if (violation && violation.severity === "mild") {
                        recordLowSeverityChat(player, now);
                        persistChatMuteState(player, addr);
                        player.send("w", "Some words were removed from your message.");
                    }

                    recentMessages.push({ text: rawText, time: now });
                    player.recentChatMessages = recentMessages.slice(-(Number(config.chatCrossMessageCount) || 3));
                    player.lastChatMessage = normalized;
                    player.lastChatMessageAt = now;

                    if (player.shadowMuteUntil > now) {
                        player.send("6", player.sid, chat);
                    } else {
                        game.server.broadcast("6", player.sid, chat);
                    }

                    break;
                }
                case "0": {
                    emit("0");
                    if (data[0] !== "roster" || !player.accountId ||
                        (player.playerRosterCooldownUntil || 0) > Date.now()) {
                        break;
                    }
                    player.playerRosterCooldownUntil = Date.now() + 1000;
                    try {
                        const roles = await checkDiscordStaffRoles(player);
                        updateStaffRoles(player, roles);
                        if (!roles.owner && !roles.administrator) break;

                        const roster = game.players
                            .filter(target => target.joinTokenVerified &&
                                target.hasJoinedGame &&
                                target !== player &&
                                target.socket?.readyState === 1)
                            .map(target => [
                                target.sid,
                                target.name || "unknown",
                                Boolean(target.accountId),
                                target.gameId,
                                Boolean(target.proxyVpnRisk)
                            ]);
                        player.send("pl", roster);
                    } catch (error) {
                        console.error("[staff] Player roster request failed:", error.message);
                        player.send("w", "Unable to load the player list right now.");
                    }
                    break;
                }
                case "p": {

                    if (!player.alive) {
                        break;
                    }

                    const rawCps = data[0];
                    const rawPing = data[1];

                    if (Number.isFinite(rawCps)) {
                        player.clientCps = Math.max(0, Math.min(50, Math.round(Number(rawCps))));
                    }
                    if (Number.isFinite(rawPing)) {
                        player.clientPing = Math.max(-1, Math.min(9999, Math.round(Number(rawPing))));
                    }

                    break;
                }
                case "L": {

                    if (!player.alive) break;

                    if (player.team) break;

                    if (typeof data[0] !== "string") break;

                    if (data[0].length < 1 || data[0].length > 7) break;

                    const cooldownLeft = player.clan_create_cooldown_until - Date.now();
                    if (cooldownLeft > 0) {
                        player.send("cl", cooldownLeft);
                        break;
                    }

                    if (player.clan_cooldown > 0) break;

                    const created = game.clan_manager.create(data[0], player);
                    if (created === true) {
                        player.clan_create_cooldown_until = Date.now() + CLAN_CREATE_COOLDOWN;
                    } else if (created === "active_ip_limit") {
                        player.send("w", "Someone using your IP already owns a custom team. They must leave it before another can be created.");
                    } else if (created === "rate_limit") {
                        player.send("cl", player.clanCreateRetryAfter);
                    }

                    break;
                }
                case "N": {

                    if (!player.alive) break;

                    if (!player.team) break;

                    if (player.clan_cooldown > 0) break;

                    player.clan_cooldown = 200;

                    if (player.is_owner) {
                        game.clan_manager.remove(player.team);
                        break;
                    }
                    
                    game.clan_manager.kick(player.team, player.sid);
                    break;

                }
                case "b": {

                    if (!player.alive) break;

                    if (player.team) break;

                    if (player.clan_cooldown > 0) break;

                    player.clan_cooldown = 200;

                    game.clan_manager.add_notify(data[0], player.sid);
                    break;

                }
                case "P": {

                    if (!player.alive) break;

                    if (!player.team) break;

                    if (player.clan_cooldown > 0) break;

                    const [targetSid, joinDecision] = data ?? [];

                    if (typeof targetSid === "undefined") break;

                    if (typeof joinDecision !== "undefined") {

                        if (!player.is_owner || !Number.isSafeInteger(targetSid) || typeof joinDecision !== "boolean") {
                            break;
                        }
                        player.clan_cooldown = 200;

                        game.clan_manager.confirm_join(player.team, targetSid, joinDecision);
                        player.notify.delete(targetSid);
                        break;
                    }

                    if (!player.is_owner) break;

                    player.clan_cooldown = 200;

                    if (!Number.isSafeInteger(targetSid)) break;
                    game.clan_manager.kick(player.team, targetSid);
                    break;

                }
                case "S": {

                    if (!player.alive) break;

                    if (player.ping_cooldown > 0) break;

                    player.ping_cooldown = config.mapPingTime;

                    game.server.broadcast("9", player.x, player.y);

                    break;
                }
                case "e": {

                    if (!player.alive) break;

                    player.resetMoveDir();

                    break;
                }
                default:
                    handleInvalidPacket(`unknown packet type "${t}"`);
                    return;
            }

        } catch(e) {
            console.error("Error processing message from player:", e);
            handleInvalidPacket("exception during packet processing");

            
        }

    });

    socket.on("close", reason => {

        clearTimeout(handshakeTimer);
        colimit.down(addr);
        recordAccountMatch(player, false);
        if (player.builderMode) player.setBuilderMode(false);
        player.chatCooldownDisabled = false;
        player.chat_cooldown = 0;
        if (player.ownerShown) {
            game.server.broadcast("os", player.sid, false);
            player.ownerShown = false;
        }
        if (player.shielded) {
            player.shielded = false;
            game.server.broadcast("sh", player.sid, false);
        }

        if (player.team) {

            if (player.is_owner) {
                game.clan_manager.remove(player.team);
            } else {
                game.clan_manager.kick(player.team, player.sid);
            }

        }

        if (player.joinTokenVerified) game.removePlayer(player.id);

    });

    socket.on("error", error => {
        console.error(`[server] WebSocket error for ${addr}:`, error);
    });

});

server.listen(PORT, HOST, (error) => {

    if (error) {
        throw error;
    }

    const address = server.address();
    const listenHost = typeof address === "string" ? address : address?.address ?? HOST;
    const listenPort = typeof address === "string" ? PORT : address?.port ?? PORT;
    console.log(`Server listening at http://${listenHost}:${listenPort}`);
    if (process.send) process.send({ type: "server-ready" });

});
