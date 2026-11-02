import WebSocket from "ws";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
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
    const response = await fetch(
        `https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`,
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
    const response = await fetch(
        `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
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

async function deferInteraction(interaction) {
    const response = await fetch(
        `https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`,
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
    if (typeof message !== "string" || !message.trim() || typeof channelId !== "string") {
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
                heartbeat = setInterval(() => {
                    if (!heartbeatAcknowledged) {
                        socket.close();
                        return;
                    }
                    heartbeatAcknowledged = false;
                    socket.send(JSON.stringify({ op: 1, d: sequence }));
                }, packet.d.heartbeat_interval);
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
