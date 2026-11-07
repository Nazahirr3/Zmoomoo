import WebSocket from "ws";
import { createHmac } from "node:crypto";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const MIN_HEARTBEAT_INTERVAL_MS = 1000;
const MAX_HEARTBEAT_INTERVAL_MS = 120000;
const COMMANDS = [
    {
        name: "ping",
        description: "Check if the bot is responding",
        type: 1
    },
    {
        name: "send",
        description: "Send a message to a server channel",
        type: 1,
        default_member_permissions: "32",
        options: [
            {
                name: "message",
                description: "The message to send",
                type: 3,
                required: true,
                max_length: 2000
            },
            {
                name: "channel",
                description: "Where to send the message",
                type: 7,
                required: true,
                channel_types: [0, 5]
            }
        ]
    },
    {
        name: "sendglobalmessage",
        description: "Show a message to players in the game",
        type: 1,
        options: [
            {
                name: "message",
                description: "The message to show",
                type: 3,
                required: true,
                max_length: 250
            },
            {
                name: "allservers",
                description: "Send to all players on the game server",
                type: 5,
                required: true
            }
        ]
    },
    {
        name: "restart",
        description: "Restart this game server or all game servers",
        type: 1,
        options: [
            {
                name: "server",
                description: "Which game servers to restart",
                type: 3,
                required: true,
                choices: [
                    { name: "This game server", value: "current" },
                    { name: "All servers", value: "allservers" }
                ]
            }
        ]
    },
    {
        name: "update",
        description: "Pull the latest GitHub changes and restart the game server"
    },
    {
        name: "ban",
        description: "Ban a Zmoomoo account by Discord ID",
        type: 1,
        options: [
            {
                name: "discord_id",
                description: "The account's Discord user ID",
                type: 3,
                required: true,
                min_length: 15,
                max_length: 22
            },
            {
                name: "minutes",
                description: "Ban duration in minutes (0 means permanent)",
                type: 4,
                required: true,
                min_value: 0,
                max_value: 525600
            },
            {
                name: "reason",
                description: "Reason for the ban",
                type: 3,
                required: false,
                max_length: 500
            }
        ]
    },
    {
        name: "banip",
        description: "Ban an IP address",
        type: 1,
        options: [
            { name: "ip", description: "The IP address", type: 3, required: true },
            { name: "minutes", description: "Duration in minutes (0 means permanent)", type: 4, required: true, min_value: 0, max_value: 525600 },
            { name: "reason", description: "Reason for the ban", type: 3, required: false, max_length: 500 }
        ]
    },
    {
        name: "unbanip",
        description: "Remove an IP address ban",
        type: 1,
        options: [{ name: "ip", description: "The IP address", type: 3, required: true }]
    },
    {
        name: "unban",
        description: "Remove a Zmoomoo account ban",
        type: 1,
        options: [{
            name: "discord_id",
            description: "The account's Discord user ID",
            type: 3,
            required: true,
            min_length: 15,
            max_length: 22
        }]
    },
    {
        name: "lookup",
        description: "Look up Zmoomoo accounts by Discord ID or username",
        type: 1,
        options: [{
            name: "query",
            description: "Discord user ID or username",
            type: 3,
            required: true,
            min_length: 1,
            max_length: 64
        }]
    }
];

async function registerCommands(token, guildId) {
    const headers = {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json"
    };
    const applicationResponse = await fetch("https://discord.com/api/v10/oauth2/applications/@me", { headers });
    if (!applicationResponse.ok) {
        throw new Error(`Discord application lookup failed (${applicationResponse.status})`);
    }
    const application = await applicationResponse.json();
    const ownerId = process.env.DISCORD_BOT_OWNER_ID ||
        application.owner?.id || application.team?.owner_user_id;
    if (!ownerId) throw new Error("Could not determine the Discord application owner");
    const applicationId = application.id;
    const base = `https://discord.com/api/v10/applications/${applicationId}`;
    const route = guildId ? `${base}/guilds/${guildId}/commands` : `${base}/commands`;
    const response = await fetch(route, { headers });
    if (!response.ok) throw new Error(`Discord command lookup failed (${response.status})`);
    const commands = await response.json();
    for (const command of COMMANDS) {
        const existing = commands.find(item => item.name === command.name);
        const saved = await fetch(existing ? `${route}/${existing.id}` : route, {
            method: existing ? "PATCH" : "POST",
            headers,
            body: JSON.stringify(command)
        });
        if (!saved.ok) {
            throw new Error(`Discord /${command.name} registration failed (${saved.status})`);
        }
    }
    return ownerId;
}

async function replyToInteraction(interaction, content) {
    const interactionId = String(interaction?.id ?? "");
    const interactionToken = String(interaction?.token ?? "");

    const isValidInteractionId = /^[0-9]{5,30}$/.test(interactionId);
    const isValidInteractionToken = /^[A-Za-z0-9._-]{10,200}$/.test(interactionToken);

    if (!isValidInteractionId || !isValidInteractionToken) {
        console.error("[discord] Refusing to reply: invalid interaction id/token.");
        return;
    }

    const response = await fetch(
        `https://discord.com/api/v10/interactions/${encodeURIComponent(interactionId)}/${encodeURIComponent(interactionToken)}/callback`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: 4, data: { content, flags: 64 } })
        }
    );
    if (!response.ok) {
        console.error(`[discord] Interaction reply failed (${response.status}).`);
    }
}

async function editInteractionReply(interaction, content) {
    const { id, token } = getValidatedInteractionRouteParams(interaction);
    const webhookUrl = new URL(
        `/api/v10/webhooks/${encodeURIComponent(id)}/${encodeURIComponent(token)}/messages/@original`,
        "https://discord.com"
    );

    const response = await fetch(
        webhookUrl.toString(),
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content })
        }
    );
    if (!response.ok) {
        console.error(`[discord] Interaction follow-up failed (${response.status}).`);
    }
}

function getValidatedInteractionRouteParams(interaction) {
    const id = String(interaction?.id ?? "");
    const token = String(interaction?.token ?? "");

    if (!/^\d+$/.test(id)) {
        throw new Error("Invalid interaction id.");
    }

    // Discord interaction tokens are opaque, but should be limited to safe URL token chars.
    if (!/^[A-Za-z0-9._-]+$/.test(token)) {
        throw new Error("Invalid interaction token.");
    }

    return { id, token };
}

async function deferInteraction(interaction) {
    const { id, token } = getValidatedInteractionRouteParams(interaction);
    const callbackUrl = new URL(
        `/api/v10/interactions/${encodeURIComponent(id)}/${encodeURIComponent(token)}/callback`,
        "https://discord.com"
    );

    const response = await fetch(
        callbackUrl.toString(),
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: 5, data: { flags: 64 } })
        }
    );
    if (!response.ok) {
        throw new Error(`Interaction defer failed (${response.status})`);
    }
}

async function sendChannelMessage(interaction, token) {
    const options = interaction.data.options || [];
    const message = options.find(option => option.name === "message")?.value;
    const channelId = options.find(option => option.name === "channel")?.value;
    const isValidChannelId = typeof channelId === "string" && /^\d{17,20}$/.test(channelId);
    if (typeof message !== "string" || !message.trim() || !isValidChannelId) {
        return replyToInteraction(interaction, "Add a message and choose a channel.");
    }

    const permissions = BigInt(interaction.member?.permissions || "0");
    if ((permissions & 32n) === 0n && (permissions & 8n) === 0n) {
        return replyToInteraction(interaction, "You need Manage Server permission to use this command.");
    }
    if (!interaction.guild_id) {
        return replyToInteraction(interaction, "This command only works in a server.");
    }

    const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
    try {
        await replyToInteraction(interaction, "Sending...");
        const channelResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}`, { headers });
        if (!channelResponse.ok) {
            return editInteractionReply(interaction, "I couldn't access that channel.");
        }
        const channel = await channelResponse.json();
        if (channel.guild_id !== interaction.guild_id || ![0, 5].includes(channel.type)) {
            return editInteractionReply(interaction, "Choose a text channel from this server.");
        }

        const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ content: message.trim(), allowed_mentions: { parse: [] } })
        });
        if (!response.ok) {
            return editInteractionReply(interaction, "I couldn't send a message there. Check my channel permissions.");
        }
        await editInteractionReply(interaction, `Message sent to <#${channelId}>.`);
    } catch (error) {
        console.error("[discord] /send failed:", error);
        await editInteractionReply(interaction, "Something went wrong while sending the message.");
    }
}

function announceGlobalMessage(interaction, ownerId, announce) {
    const userId = interaction.member?.user?.id || interaction.user?.id;
    if (!ownerId || userId !== ownerId) {
        return replyToInteraction(interaction, "Only the bot owner can send global game messages.");
    }

    const options = interaction.data.options || [];
    const message = options.find(option => option.name === "message")?.value;
    const allServers = options.find(option => option.name === "allservers")?.value;
    if (typeof message !== "string" || !message.trim() || message.length > 250) {
        return replyToInteraction(interaction, "Enter a message between 1 and 250 characters.");
    }
    if (allServers !== true) {
        return replyToInteraction(interaction, "Set allservers to true to send a global game message.");
    }
    if (typeof announce !== "function") {
        return replyToInteraction(interaction, "The game server is not available to receive announcements.");
    }

    const sender = interaction.member?.nick ||
        interaction.member?.user?.global_name ||
        interaction.user?.global_name ||
        interaction.member?.user?.username ||
        interaction.user?.username ||
        "Server owner";
    announce({
        message: message.trim(),
        sender,
        role: "owner"
    });
    return replyToInteraction(interaction, "Global game message sent.");
}

function restartGameServer(interaction, ownerId, restart) {
    const userId = interaction.member?.user?.id || interaction.user?.id;
    if (!ownerId || userId !== ownerId) {
        return replyToInteraction(interaction, "Only the bot owner can restart the game server.");
    }

    const server = interaction.data.options?.find(option => option.name === "server")?.value;
    if (!["current", "allservers"].includes(server)) {
        return replyToInteraction(interaction, "Choose this game server or all servers.");
    }
    if (typeof restart !== "function") {
        return replyToInteraction(interaction, "The game server restart is not available.");
    }

    if (!restart()) {
        return replyToInteraction(interaction, "A server update or restart is already in progress.");
    }
    const target = server === "allservers" ? "all servers managed here" : "this game server";
    return replyToInteraction(interaction, `Restarting ${target} in 5 seconds.`);
}

async function updateGameServer(interaction, ownerId, update) {
    const userId = interaction.member?.user?.id || interaction.user?.id;
    if (!ownerId || userId !== ownerId) {
        return replyToInteraction(interaction, "Only the bot owner can update the game server.");
    }
    if (typeof update !== "function") {
        return replyToInteraction(interaction, "The game server update is not available.");
    }

    let deferred = false;
    try {
        await deferInteraction(interaction);
        deferred = true;
        const commit = await update();
        await editInteractionReply(
            interaction,
            `Update ready (${commit}). The server will restart in 20 seconds.`
        );
    } catch (error) {
        console.error("[discord] /update failed:", error);
        if (deferred) {
            await editInteractionReply(interaction, error.message || "The game server update failed.");
        } else {
            await replyToInteraction(interaction, "The game server update could not be started.");
        }
    }
}

function moderatorRoleIds() {
    return String(process.env.DISCORD_MODERATOR_ROLE_IDS || "")
        .split(",")
        .map(roleId => roleId.trim())
        .filter(roleId => /^\d{15,22}$/.test(roleId));
}

const PERMISSION_MATRIX = Object.freeze({
    moderation: "moderation"
});

function isModerator(interaction) {
    const roles = Array.isArray(interaction.member?.roles) ? interaction.member.roles : [];
    const configuredRoles = moderatorRoleIds();
    const permissions = BigInt(interaction.member?.permissions || "0");
    const isDiscordAdministrator = (permissions & 8n) !== 0n;
    return Boolean(interaction.guild_id && (isDiscordAdministrator ||
        configuredRoles.some(roleId => roles.includes(roleId))));
}

function getOption(interaction, name) {
    return interaction.data?.options?.find(option => option.name === name)?.value;
}

function summarizeCommandOptions(options) {
    if (!Array.isArray(options)) return "";
    return options.map(option => {
        if (Array.isArray(option.options)) {
            const nested = summarizeCommandOptions(option.options);
            return nested ? `${option.name} ${nested}` : option.name;
        }
        return option.name;
    }).join(", ").slice(0, 850);
}

function createPrivateAdminClient(options = {}) {
    const baseUrl = options.baseUrl || `http://127.0.0.1:${process.env.PORT || 3000}`;
    const apiKey = options.apiKey || process.env.ADMIN_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length < 32) return null;

    return async function request(path, body, executorId) {
        // sign the exact request so the api can verify who ran it
        const timestamp = String(Date.now());
        const payload = `${timestamp}.${executorId}.${path}.${JSON.stringify(body || {})}`;
        const signature = createHmac("sha256", apiKey).update(payload).digest("base64url");
        const response = await fetch(new URL(path, baseUrl), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "zmoomoo-api-key": apiKey,
                "x-zmoomoo-executor": executorId,
                "x-zmoomoo-timestamp": timestamp,
                "x-zmoomoo-signature": signature
            },
            body: JSON.stringify(body || {})
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Private admin API failed (${response.status})`);
        return result;
    };
}

function validateDiscordId(value) {
    return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function requireModerator(interaction) {
    if (!isAllowed(interaction, PERMISSION_MATRIX.moderation)) {
        return replyToInteraction(interaction, "You need a configured moderator role to use this command.");
    }

    function isAllowed(interaction, permission) {
        if (permission !== PERMISSION_MATRIX.moderation) return false;
        return isModerator(interaction);
    }
    return null;
}

async function banAccount(interaction, moderation) {
    const denied = requireModerator(interaction);
    if (denied) return denied;
    const discordId = getOption(interaction, "discord_id");
    const minutes = getOption(interaction, "minutes");
    const reason = getOption(interaction, "reason") || "No reason provided";
    if (!validateDiscordId(discordId) || !Number.isInteger(minutes) ||
        minutes < 0 || minutes > 525600) {
        return replyToInteraction(interaction, "Provide a valid Discord ID and duration.");
    }
    if (!moderation?.ban) {
        return replyToInteraction(interaction, "Moderation is not available on this server.");
    }
    const executorId = interaction.member?.user?.id || interaction.user?.id;
    const until = minutes === 0 ? Number.MAX_SAFE_INTEGER : Date.now() + minutes * 60 * 1000;
    const result = await moderation.ban(discordId, until, reason, executorId);
    if (result?.disconnected) {
        return replyToInteraction(interaction, `Account ${discordId} banned and disconnected.`);
    }
    return replyToInteraction(interaction, `Account ${discordId} banned.`);
}

async function unbanAccount(interaction, moderation) {
    const denied = requireModerator(interaction);
    if (denied) return denied;
    const discordId = getOption(interaction, "discord_id");
    if (!validateDiscordId(discordId)) {
        return replyToInteraction(interaction, "Provide a valid Discord ID.");
    }

    if (!moderation?.unban) {
        return replyToInteraction(interaction, "Moderation is not available on this server.");
    }
    const executorId = interaction.member?.user?.id || interaction.user?.id;
    await moderation.unban(discordId, executorId);
    return replyToInteraction(interaction, `Account ${discordId} unbanned.`);
}

function validIp(value) {
    return typeof value === "string" && value.length >= 3 && value.length <= 45 &&
        /^[0-9a-fA-F:.]+$/.test(value);
}

async function banIp(interaction, moderation) {
    const denied = requireModerator(interaction);
    if (denied) return denied;
    const ip = getOption(interaction, "ip");
    const minutes = getOption(interaction, "minutes");
    const reason = getOption(interaction, "reason") || "No reason provided";
    if (!validIp(ip) || !Number.isInteger(minutes) || minutes < 0 || minutes > 525600) {
        return replyToInteraction(interaction, "Provide a valid IP and duration.");
    }
    if (typeof moderation?.banIp !== "function") {
        return replyToInteraction(interaction, "IP moderation is not available on this server.");
    }
    const until = minutes === 0 ? Number.MAX_SAFE_INTEGER : Date.now() + minutes * 60 * 1000;
    await moderation.banIp(ip, until, reason, interaction.member?.user?.id || interaction.user?.id);
    return replyToInteraction(interaction, `IP ${ip} banned.`);
}

async function unbanIp(interaction, moderation) {
    const denied = requireModerator(interaction);
    if (denied) return denied;
    const ip = getOption(interaction, "ip");
    if (!validIp(ip) || typeof moderation?.unbanIp !== "function") {
        return replyToInteraction(interaction, "Provide a valid IP.");
    }
    await moderation.unbanIp(ip, interaction.member?.user?.id || interaction.user?.id);
    return replyToInteraction(interaction, `IP ${ip} unbanned.`);
}

async function lookupAccounts(interaction, moderation) {
    const denied = requireModerator(interaction);
    if (denied) return denied;
    const query = getOption(interaction, "query");
    if (typeof query !== "string" || !query.trim() || query.length > 64) {
        return replyToInteraction(interaction, "Provide a Discord ID or username.");
    }
    if (!moderation?.lookup) {
        return replyToInteraction(interaction, "Moderation is not available on this server.");
    }
    const executorId = interaction.member?.user?.id || interaction.user?.id;
    const users = await moderation.lookup(query, executorId);
    if (!users.length) return replyToInteraction(interaction, "No matching accounts found.");
    const lines = users.map(user => {
        const status = user.banned_until > Date.now()
            ? "banned" : "active";
        return `${user.username} — account ${user.id}, Discord ${user.discord_id} (${status})`;
    });
    return replyToInteraction(interaction, lines.join("\n"));
}

export function startDiscordBot(options = {}) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.info("[discord] Bot is disabled. Set DISCORD_BOT_TOKEN to start it.");
        return null;
    }

    let sequence = null;
    let heartbeat;
    let reconnect;
    let socket;
    let stopped = false;
    let ownerId = process.env.DISCORD_BOT_OWNER_ID || "";
    const guildId = process.env.DISCORD_GUILD_ID;
    const announce = options.announce;
    const restart = options.restart;
    const update = options.update;
    const privateRequest = createPrivateAdminClient(options.adminApi);
    const moderation = privateRequest ? {
        ban: (discordId, bannedUntil, reason, executorId) =>
            privateRequest("/api/private/account/ban", { discordId, bannedUntil, reason }, executorId),
        unban: (discordId, executorId) =>
            privateRequest("/api/private/account/unban", { discordId }, executorId),
        lookup: async (query, executorId) => {
            const result = await privateRequest("/api/private/account/lookup", { query }, executorId);
            return result.users;
        },
        banIp: (address, bannedUntil, reason, executorId) =>
            privateRequest("/api/private/ip/ban", { address, bannedUntil, reason }, executorId),
        unbanIp: (address, executorId) =>
            privateRequest("/api/private/ip/unban", { address }, executorId)
    } : null;
    if (!privateRequest) {
        console.error("[discord] Moderation commands disabled: ADMIN_API_KEY is not configured.");
    }

    function connect() {
        socket = new WebSocket(GATEWAY_URL);
        let heartbeatAcknowledged = true;

        socket.on("message", data => {
            let packet;
            try {
                packet = JSON.parse(data.toString());
            } catch (error) {
                console.error("[discord] Received an invalid gateway packet:", error);
                socket.close();
                return;
            }

            if (packet.s !== null && packet.s !== undefined) sequence = packet.s;

            if (packet.op === 10) {
                const heartbeatInterval = Number(packet?.d?.heartbeat_interval);
                if (!Number.isFinite(heartbeatInterval) || heartbeatInterval <= 0) {
                    console.error("[discord] Invalid heartbeat interval received:", packet?.d?.heartbeat_interval);
                    socket.close();
                    return;
                }
                const safeHeartbeatInterval = MIN_HEARTBEAT_INTERVAL_MS;

                if (heartbeat) {
                    clearInterval(heartbeat);
                }

                heartbeat = setInterval(() => {
                    if (!heartbeatAcknowledged) {
                        socket.close();
                        return;
                    }
                    heartbeatAcknowledged = false;
                    socket.send(JSON.stringify({ op: 1, d: sequence }));
                }, safeHeartbeatInterval);
                socket.send(JSON.stringify({
                    op: 2,
                    d: {
                        token,
                        intents: 1,
                        properties: { os: process.platform, browser: "zmoomoo", device: "zmoomoo" }
                    }
                }));
                return;
            }

            if (packet.op === 11) {
                heartbeatAcknowledged = true;
                return;
            }

            if (packet.op === 1) {
                socket.send(JSON.stringify({ op: 1, d: sequence }));
                return;
            }

            if (packet.op !== 0) return;
            if (packet.t === "READY") {
                console.log(`[discord] Bot is online as ${packet.d.user.username}.`);
                registerCommands(token, guildId)
                    .then(applicationOwnerId => {
                        ownerId = ownerId || applicationOwnerId;
                        console.log("[discord] Bot commands are ready.");
                    })
                    .catch(error => console.error("[discord] Could not register commands:", error));
            } else if (packet.t === "INTERACTION_CREATE" &&
                packet.d.type === 2) {
                const commandName = packet.d.data?.name;
                if (typeof commandName === "string" && /^[a-z0-9_-]{1,32}$/.test(commandName)) {
                    const user = packet.d.member?.user || packet.d.user || {};
                    const actorName = packet.d.member?.nick ||
                        user.global_name || user.username || "unknown";
                    const actorId = typeof user.id === "string" ? user.id : "unknown";
                    const argumentsSummary = summarizeCommandOptions(packet.d.data.options);
                    try {
                        options.logCommand?.({
                            action: `discord_command_${commandName}`,
                            actor: `${actorName} (${actorId})`,
                            details: `/${commandName}${argumentsSummary ? ` ${argumentsSummary}` : ""}`
                        });
                    } catch (error) {
                        console.error("[discord] Could not queue command audit log:", error.message);
                    }
                }
                if (packet.d.data?.name === "ping") {
                    replyToInteraction(packet.d, "Pong!")
                        .catch(error => console.error("[discord] Could not reply to /ping:", error));
                } else if (packet.d.data?.name === "send") {
                    sendChannelMessage(packet.d, token)
                        .catch(error => console.error("[discord] Could not run /send:", error));
                } else if (packet.d.data?.name === "sendglobalmessage") {
                    announceGlobalMessage(packet.d, ownerId, announce)
                        .catch(error => console.error("[discord] Could not run /sendglobalmessage:", error));
                } else if (packet.d.data?.name === "restart") {
                    restartGameServer(packet.d, ownerId, restart)
                        .catch(error => console.error("[discord] Could not run /restart:", error));
                } else if (packet.d.data?.name === "update") {
                    updateGameServer(packet.d, ownerId, update)
                        .catch(error => console.error("[discord] Could not run /update:", error));
                } else if (packet.d.data?.name === "ban") {
                    banAccount(packet.d, moderation)
                        .catch(error => console.error("[discord] Could not run /ban:", error));
                } else if (packet.d.data?.name === "unban") {
                    unbanAccount(packet.d, moderation)
                        .catch(error => console.error("[discord] Could not run /unban:", error));
                } else if (packet.d.data?.name === "lookup") {
                    lookupAccounts(packet.d, moderation)
                        .catch(error => console.error("[discord] Could not run /lookup:", error));
                } else if (packet.d.data?.name === "banip") {
                    banIp(packet.d, moderation)
                        .catch(error => console.error("[discord] Could not run /banip:", error));
                } else if (packet.d.data?.name === "unbanip") {
                    unbanIp(packet.d, moderation)
                        .catch(error => console.error("[discord] Could not run /unbanip:", error));
                }
            }
        });

        socket.on("error", error => {
            console.error("[discord] Gateway connection error:", error.message);
        });

        socket.on("close", (code, reason) => {
            clearInterval(heartbeat);
            if (stopped) return;
            if (code === 4004 || code === 4014) {
                stopped = true;
                console.error(`[discord] Bot stopped (${code}). Check its token and app settings.`);
                return;
            }
            if (reason.length) console.warn("[discord] Gateway closed:", reason.toString());
            reconnect = setTimeout(connect, 5000);
        });
    }

    connect();
    return { stop: () => {
        stopped = true;
        clearInterval(heartbeat);
        clearTimeout(reconnect);
        if (socket) socket.close();
    } };
}
