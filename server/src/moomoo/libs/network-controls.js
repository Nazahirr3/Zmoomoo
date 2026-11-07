import { BlockList, isIP } from "node:net";

export function normalizeIpAddress(address) {
    const value = String(address || "").trim().toLowerCase();
    const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
    return mappedIpv4 && isIP(mappedIpv4[1]) === 4 ? mappedIpv4[1] : value;
}

export function getClientAddress(request, trustProxy = false) {
    const socketAddress = normalizeIpAddress(request.socket?.remoteAddress);
    if (!trustProxy || typeof request.headers?.["x-forwarded-for"] !== "string") {
        return socketAddress;
    }

    // Forwarded addresses are trusted only when the server owner enabled proxy trust.
    const forwardedAddresses = request.headers["x-forwarded-for"]
        .split(",")
        .map(address => normalizeIpAddress(address))
        .filter(address => isIP(address));
    return forwardedAddresses.at(-1) || socketAddress;
}

export function createIpBlockList(value = "") {
    const blockList = new BlockList();
    const entries = String(value).split(",").map(entry => entry.trim()).filter(Boolean);

    for (const entry of entries) {
        const parts = entry.split("/");
        if (parts.length > 2) throw new TypeError(`Invalid proxy/VPN CIDR entry: ${entry}`);
        const [rawAddress, rawPrefix] = parts;
        const address = normalizeIpAddress(rawAddress);
        const family = isIP(address);
        const maxPrefix = family === 4 ? 32 : 128;
        const prefix = rawPrefix === undefined ? maxPrefix : Number(rawPrefix);
        if (!family || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
            throw new TypeError(`Invalid proxy/VPN CIDR entry: ${entry}`);
        }
        blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    }

    return blockList;
}

export function isAddressInBlockList(address, blockList) {
    const normalized = normalizeIpAddress(address);
    const family = isIP(normalized);
    return Boolean(family && blockList.check(normalized, family === 4 ? "ipv4" : "ipv6"));
}

export class RollingWindowLimiter {
    constructor(limit, windowMs, maxKeys = 10000) {
        if (!Number.isSafeInteger(limit) || limit < 1 ||
            !Number.isSafeInteger(windowMs) || windowMs < 1 ||
            !Number.isSafeInteger(maxKeys) || maxKeys < 1) {
            throw new TypeError("Rate-limit settings must be positive safe integers.");
        }
        this.limit = limit;
        this.windowMs = windowMs;
        this.maxKeys = maxKeys;
        this.entries = new Map();
    }

    allow(key, now = Date.now()) {
        const normalizedKey = String(key || "");
        if (!normalizedKey || !Number.isFinite(now)) return false;

        if (!this.entries.has(normalizedKey) && this.entries.size >= this.maxKeys) {
            this.prune(now);
            if (this.entries.size >= this.maxKeys) return false;
        }
        const recent = (this.entries.get(normalizedKey) || [])
            .filter(timestamp => now - timestamp < this.windowMs);
        if (recent.length >= this.limit) {
            this.entries.set(normalizedKey, recent);
            return false;
        }

        recent.push(now);
        this.entries.set(normalizedKey, recent);
        return true;
    }

    retryAfter(key, now = Date.now()) {
        const recent = (this.entries.get(String(key || "")) || [])
            .filter(timestamp => now - timestamp < this.windowMs);
        if (recent.length < this.limit) return 0;
        return Math.max(0, recent[0] + this.windowMs - now);
    }

    prune(now = Date.now()) {
        for (const [key, timestamps] of this.entries) {
            const recent = timestamps.filter(timestamp => now - timestamp < this.windowMs);
            if (recent.length) this.entries.set(key, recent);
            else this.entries.delete(key);
        }
    }
}
