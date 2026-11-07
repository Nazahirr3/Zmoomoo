export function createModerationLogger(webhookUrl) {
    if (!webhookUrl) return null;

    let url;
    try {
        url = new URL(webhookUrl);
    } catch {
        throw new TypeError("MODERATION_LOG_WEBHOOK_URL must be a valid Discord webhook URL.");
    }
    if (url.protocol !== "https:" || url.hostname !== "discord.com" ||
        !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname) ||
        url.username || url.password || url.search || url.hash) {
        throw new TypeError("MODERATION_LOG_WEBHOOK_URL must be a valid Discord webhook URL.");
    }

    return async function logModerationAction(event) {
        const fields = [
            { name: "Action", value: String(event.action || "unknown").slice(0, 100), inline: true },
            { name: "Actor", value: String(event.actor || "server").slice(0, 100), inline: true }
        ];
        if (event.target) {
            fields.push({ name: "Target", value: String(event.target).slice(0, 100), inline: true });
        }
        if (typeof event.actorHasAccount === "boolean") {
            fields.push({
                name: "Actor account",
                value: event.actorHasAccount ? "YES" : "NO",
                inline: true
            });
        }
        if (typeof event.targetHasAccount === "boolean") {
            fields.push({
                name: "Target account",
                value: event.targetHasAccount ? "YES" : "NO",
                inline: true
            });
        }
        if (event.details) {
            fields.push({ name: "Details", value: String(event.details).slice(0, 1000), inline: false });
        }

        const response = await fetch(url.toString(), {
            method: "POST",
            headers: { "content-type": "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(5000),
            body: JSON.stringify({
                allowed_mentions: { parse: [] },
                embeds: [{
                    title: "Server activity log",
                    color: 15158332,
                    timestamp: new Date().toISOString(),
                    fields
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`Moderation log webhook returned HTTP ${response.status}.`);
        }
    };
}

export function queueModerationLog(logger, event) {
    if (!logger) return;
    Promise.resolve()
        .then(() => logger(event))
        .catch(error => console.error("[moderation] Could not send log:", error.message));
}
