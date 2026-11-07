import { createHmac, timingSafeEqual } from "node:crypto";
import { rateLimit } from "express-rate-limit";

const EXECUTOR_ID = "x-zmoomoo-executor";
const TIMESTAMP = "x-zmoomoo-timestamp";
const SIGNATURE = "x-zmoomoo-signature";
const MAX_CLOCK_SKEW = 60 * 1000;

function validApiKey(value) {
    return typeof value === "string" && value.length >= 32;
}

function isLoopback(request) {
    // keep the admin api on this server
    const address = String(request.socket.remoteAddress || "").toLowerCase();
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function validDiscordId(value) {
    return typeof value === "string" && /^\d{15,22}$/.test(value);
}

function logAction(options, event) {
    if (typeof options.logAction !== "function") return;
    try {
        Promise.resolve(options.logAction(event))
            .catch(error => console.error("[moderation] Could not queue action log:", error.message));
    } catch (error) {
        console.error("[moderation] Could not queue action log:", error.message);
    }
}

function authenticateRequest(request, response, next) {
    const key = process.env.ADMIN_API_KEY;
    const providedKey = request.get("zmoomoo-api-key") || "";
    const executorId = request.get(EXECUTOR_ID) || "";
    const timestamp = request.get(TIMESTAMP) || "";
    const signature = request.get(SIGNATURE) || "";
    const requestTime = Number(timestamp);
    const requestPath = String(request.originalUrl || request.path).split("?")[0];
    const payload = `${timestamp}.${executorId}.${requestPath}.${JSON.stringify(request.body || {})}`;
    const expected = validApiKey(key) ? createHmac("sha256", key).update(payload).digest("base64url") : "";
    const matches = expected.length === signature.length &&
        expected.length > 0 &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

    // stop old requests and dont trust ids sent in the body
    if (!isLoopback(request) || !validApiKey(key) ||
        providedKey.length !== key.length ||
        !timingSafeEqual(Buffer.from(providedKey), Buffer.from(key)) ||
        !validDiscordId(executorId) ||
        !Number.isSafeInteger(requestTime) ||
        Math.abs(Date.now() - requestTime) > MAX_CLOCK_SKEW ||
        !matches) {
        return response.status(403).json({ error: "forbidden" });
    }
    request.adminExecutorId = executorId;
    next();
}

export function registerPrivateAdminApi(app, options = {}) {
    const store = options.store;
    if (!store) throw new TypeError("Private admin API requires an account store.");

    app.use("/api/private", authenticateRequest);
    app.use("/api/private", rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: "draft-8",
        legacyHeaders: false
    }));

    app.post("/api/private/account/ban", (request, response) => {
        const { discordId, bannedUntil, reason } = request.body || {};
        if (!validDiscordId(discordId) || !Number.isSafeInteger(bannedUntil) || bannedUntil < 0) {
            return response.status(400).json({ error: "invalid_parameters" });
        }
        const user = store.banUser(discordId, bannedUntil, reason);
        if (typeof options.disconnectAccount === "function") {
            options.disconnectAccount(discordId);
        }
        store.writeModerationAudit(request.adminExecutorId, "ban", discordId, {
            bannedUntil, reason: String(reason || "").slice(0, 500), accountId: user?.id || null
        });
        logAction(options, {
            action: "account_ban",
            actor: request.adminExecutorId,
            target: discordId,
            details: `Until ${new Date(bannedUntil).toISOString()}. ${String(reason || "").slice(0, 300)}`
        });
        return response.json({ user, banned: true });
    });

    app.post("/api/private/account/unban", (request, response) => {
        const { discordId } = request.body || {};
        if (!validDiscordId(discordId)) return response.status(400).json({ error: "invalid_parameters" });
        const user = store.unbanUser(discordId);
        store.writeModerationAudit(request.adminExecutorId, "unban", discordId, { accountId: user?.id || null });
        logAction(options, { action: "account_unban", actor: request.adminExecutorId, target: discordId });
        return response.json({ user, banned: false });
    });

    app.post("/api/private/account/lookup", (request, response) => {
        const query = typeof request.body?.query === "string" ? request.body.query.trim().slice(0, 64) : "";
        if (!query) return response.status(400).json({ error: "invalid_parameters" });
        return response.json({ users: store.findModerationUsers(query) });
    });

    app.post("/api/private/account/delete", (request, response) => {
        const userId = request.body?.userId;
        if (!Number.isSafeInteger(userId)) return response.status(400).json({ error: "invalid_parameters" });
        const user = store.getUserById(userId);
        if (!user) return response.status(404).json({ error: "not_found" });
        store.deleteUser(userId);
        store.writeModerationAudit(request.adminExecutorId, "delete_account", user.discord_id, { accountId: userId });
        logAction(options, {
            action: "account_delete",
            actor: request.adminExecutorId,
            target: user.discord_id,
            details: `Account ID ${userId}.`
        });
        return response.json({ deleted: true });
    });

    app.post("/api/private/ip/ban", (request, response) => {
        const { address, bannedUntil, reason } = request.body || {};
        if (typeof address !== "string" || address.length < 3 || address.length > 45 ||
            !Number.isSafeInteger(bannedUntil) || bannedUntil < 0) {
            return response.status(400).json({ error: "invalid_parameters" });
        }
        store.banIp(address, bannedUntil, reason, request.adminExecutorId);
        store.writeModerationAudit(request.adminExecutorId, "ban_ip", request.adminExecutorId, {
            bannedUntil, reason: String(reason || "").slice(0, 500)
        }, "ip", store.hashIpForAudit(address));
        logAction(options, {
            action: "ip_ban",
            actor: request.adminExecutorId,
            target: store.hashIpForAudit(address),
            details: `Until ${new Date(bannedUntil).toISOString()}. ${String(reason || "").slice(0, 300)}`
        });
        return response.json({ banned: true });
    });

    app.post("/api/private/ip/unban", (request, response) => {
        const { address } = request.body || {};
        if (typeof address !== "string" || address.length < 3 || address.length > 45) {
            return response.status(400).json({ error: "invalid_parameters" });
        }
        store.unbanIp(address);
        const addressHash = store.hashIpForAudit(address);
        store.writeModerationAudit(request.adminExecutorId, "unban_ip", request.adminExecutorId, {}, "ip", addressHash);
        logAction(options, { action: "ip_unban", actor: request.adminExecutorId, target: addressHash });
        return response.json({ banned: false });
    });
}
