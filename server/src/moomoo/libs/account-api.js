import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createAccountStore, SESSION_LENGTH } from "./account-store.js";
import sharedConfig from "../../../../shared/config.js";
import nameFilter from "../../../../shared/namefilter.js";

const JOIN_TOKEN_MS = 60 * 1000;
const STATE_COOKIE = "discord_oauth_state";
const PKCE_COOKIE = "discord_oauth_pkce";
const SESSION_COOKIE = "zmoomoo_session";
const DAY_MS = 24 * 60 * 60 * 1000;

function readCookie(request, name) {
    const cookieHeader = request.headers.cookie || "";
    const entry = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(name + "="));
    if (!entry) return "";
    try {
        return decodeURIComponent(entry.slice(name.length + 1));
    } catch (error) {
        return "";
    }
}

function cookieOptions(request, maxAge) {
    return {
        httpOnly: true,
        secure: request.secure || (process.env.TRUST_PROXY === "true" && request.get("x-forwarded-proto") === "https"),
        sameSite: "lax",
        path: "/",
        maxAge
    };
}

function sameOrigin(request) {
    const origin = request.get("origin");
    if (!origin) return true;
    try {
        return new URL(origin).host === request.get("host");
    } catch (error) {
        return false;
    }
}

function accountError(response, status, message) {
    response.status(status).type("html").send(
        "<!doctype html><meta charset=\"utf-8\"><title>Account sign-in</title>" +
        "<main style=\"font:16px sans-serif;max-width:520px;margin:12vh auto;padding:24px;text-align:center\">" +
        "<h1>Account sign-in</h1><p>" + message + "</p><a href=\"/\">Return to the game</a></main>"
    );
}

function createPkcePair() {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}

export function createJoinTokenService(store, secret = process.env.JOIN_SECRET) {
    if (secret && Buffer.byteLength(secret) < 32) {
        throw new Error("JOIN_SECRET must be at least 32 characters");
    }

    const signingKey = secret || randomBytes(32);
    const usedNonces = new Map();

    function create(userId) {
        const payload = {
            userId: userId || null,
            expiresAt: Date.now() + JOIN_TOKEN_MS,
            nonce: randomBytes(16).toString("hex")
        };
        const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
        const signature = createHmac("sha256", signingKey).update(body).digest("base64url");
        return body + "." + signature;
    }

    function verify(token) {
        if (typeof token !== "string") return null;
        const parts = token.split(".");
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

        const expected = createHmac("sha256", signingKey).update(parts[0]).digest();
        let provided;
        try {
            provided = Buffer.from(parts[1], "base64url");
        } catch (error) {
            return null;
        }
        if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

        let payload;
        try {
            payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
        } catch (error) {
            return null;
        }
        const now = Date.now();
        if (!payload || !Number.isSafeInteger(payload.expiresAt) ||
            payload.expiresAt <= now || payload.expiresAt > now + JOIN_TOKEN_MS ||
            typeof payload.nonce !== "string" ||
            !(payload.userId === null || Number.isSafeInteger(payload.userId))) return null;

        for (const [nonce, expiresAt] of usedNonces) {
            if (expiresAt <= now) usedNonces.delete(nonce);
        }
        if (usedNonces.has(payload.nonce)) return null;
        usedNonces.set(payload.nonce, payload.expiresAt);

        if (payload.userId !== null) {
            const user = store.getUserById(payload.userId);
            if (!user || (user.banned_until && user.banned_until > now) || store.getBan(user.discord_id)) return null;
        }
        return payload;
    }

    return { create, verify };
}

export function registerAccountApi(app, options = {}) {
    const store = options.store || createAccountStore();
    const joinTokens = options.joinTokens || createJoinTokenService(store);
    const authLimit = options.authLimit;
    const joinLimit = options.joinLimit || ((_request, _response, next) => next());
    const usernameLimit = options.usernameLimit || ((_request, _response, next) => next());

    if (authLimit) app.use("/api/auth", authLimit);

    function currentUser(request) {
        const token = readCookie(request, SESSION_COOKIE);
        return token ? store.getSession(token) : null;
    }

    function isBanned(user) {
        return Boolean(user && (
            (user.banned_until && user.banned_until > Date.now()) ||
            store.getBan(user.discord_id)
        ));
    }

    app.get("/api/auth/discord", (request, response) => {
        const clientId = process.env.DISCORD_CLIENT_ID;
        const redirectUri = process.env.DISCORD_REDIRECT_URI;
        if (!clientId || !process.env.DISCORD_CLIENT_SECRET || !redirectUri) {
            return accountError(response, 503, "Discord sign-in is not configured on this server yet.");
        }

        const state = randomBytes(24).toString("base64url");
        const pkce = createPkcePair();
        response.cookie(STATE_COOKIE, state, {
            ...cookieOptions(request, 10 * 60 * 1000),
            secure: true,
            httpOnly: true,
            path: "/api/auth/discord/callback"
        });
        response.cookie(PKCE_COOKIE, pkce.verifier, {
            ...cookieOptions(request, 10 * 60 * 1000),
            secure: true,
            httpOnly: true,
            path: "/api/auth/discord/callback"
        });
        const authorization = new URL("https://discord.com/oauth2/authorize");
        // email is only used to require a verified Discord account
        authorization.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "identify email",
            state,
            code_challenge: pkce.challenge,
            code_challenge_method: "S256"
        }).toString();
        response.redirect(authorization.toString());
    });

    app.get("/api/auth/discord/callback", async (request, response) => {
        const state = readCookie(request, STATE_COOKIE);
        const verifier = readCookie(request, PKCE_COOKIE);
        const receivedState = typeof request.query.state === "string" ? request.query.state : "";
        response.clearCookie(STATE_COOKIE, { ...cookieOptions(request), path: "/api/auth/discord/callback" });
        response.clearCookie(PKCE_COOKIE, { ...cookieOptions(request), path: "/api/auth/discord/callback" });
        const stateBytes = Buffer.from(state);
        const receivedStateBytes = Buffer.from(receivedState);

        if (!state || !verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
            !receivedState || stateBytes.length !== receivedStateBytes.length ||
            !timingSafeEqual(stateBytes, receivedStateBytes)) {
            return accountError(response, 400, "The sign-in request expired or could not be verified. Please try again.");
        }
        if (typeof request.query.code !== "string") {
            return accountError(response, 400, "Discord sign-in was cancelled or failed. Please try again.");
        }

        try {
            const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: process.env.DISCORD_CLIENT_ID,
                    client_secret: process.env.DISCORD_CLIENT_SECRET,
                    grant_type: "authorization_code",
                    code: request.query.code,
                    redirect_uri: process.env.DISCORD_REDIRECT_URI,
                    code_verifier: verifier
                })
            });
            if (!tokenResponse.ok) {
                return accountError(response, 502, "Discord could not complete sign-in. Please try again.");
            }

            const tokenData = await tokenResponse.json();
            if (typeof tokenData.access_token !== "string") {
                return accountError(response, 502, "Discord could not complete sign-in. Please try again.");
            }

            const profileResponse = await fetch("https://discord.com/api/users/@me", {
                headers: { Authorization: "Bearer " + tokenData.access_token }
            });
            if (!profileResponse.ok) {
                return accountError(response, 502, "Discord could not verify your account. Please try again.");
            }

            const discordProfile = await profileResponse.json();
            if (typeof discordProfile.id !== "string" || !/^\d{15,22}$/.test(discordProfile.id)) {
                return accountError(response, 502, "Discord returned an invalid account profile.");
            }
            if (discordProfile.verified !== true) {
                return accountError(response, 403, "Your Discord email must be verified before signing in.");
            }

            if (store.getBan(discordProfile.id)) {
                return accountError(response, 403, "This account cannot sign in right now.");
            }
            const user = store.findOrCreateDiscordUser(discordProfile.id);
            store.updateDiscordProfile(user.id, discordProfile.email, discordProfile.verified);
            if (isBanned(user)) {
                return accountError(response, 403, "This account cannot sign in right now.");
            }
            const session = store.createSession(user.id);
            response.cookie(SESSION_COOKIE, session.token, cookieOptions(request, SESSION_LENGTH));
            response.redirect("/");
        } catch (error) {
            console.error("[accounts] Discord sign-in failed:", error);
            accountError(response, 502, "Discord sign-in could not be completed. Please try again.");
        }
    });

    app.get("/api/me", (request, response) => {
        const user = currentUser(request);
        if (!user) {
            return response.json({ loggedIn: false });
        }
        if (isBanned(user)) {
            return response.status(403).json({ error: "account_unavailable" });
        }
        response.json({ loggedIn: true, profile: store.getProfile(user.id) });
    });

    app.post("/api/auth/logout", (request, response) => {
        if (!sameOrigin(request)) return response.status(403).json({ error: "invalid_origin" });
        store.deleteSession(readCookie(request, SESSION_COOKIE));
        response.clearCookie(SESSION_COOKIE, cookieOptions(request));
        response.json({ success: true });
    });

    const deleteAccount = (request, response) => {
        if (!sameOrigin(request)) return response.status(403).json({ error: "invalid_origin" });
        const user = currentUser(request);
        if (!user) return response.status(401).json({ error: "login_required" });
        // foreign keys remove the linked account data and sessions
        store.deleteUser(user.id);
        response.clearCookie(SESSION_COOKIE, cookieOptions(request));
        response.json({ success: true });
    };
    app.delete("/api/account", deleteAccount);
    app.post("/api/account/delete", deleteAccount);

    app.post("/api/join-token", joinLimit, (request, response) => {
        if (!sameOrigin(request)) return response.status(403).json({ error: "invalid_origin" });
        const user = currentUser(request);
        if (isBanned(user)) {
            return response.status(403).json({ error: "account_unavailable" });
        }
        response.json({ token: joinTokens.create(user ? Number(user.id) : null) });
    });

    app.post("/api/account/username", usernameLimit, (request, response) => {
        if (!sameOrigin(request)) return response.status(403).json({ error: "invalid_origin" });
        const user = currentUser(request);
        if (!user) return response.status(401).json({ error: "login_required" });

        const rawName = typeof request.body?.username === "string" ? request.body.username : "";
        const username = rawName.replace(/\s+/g, " ").trim();
        const cleanName = username.replace(/[^\w:()/? -]/g, " ").replace(/\s+/g, " ").trim();
        const maxLength = Number(sharedConfig.maxNameLength) || 15;
        if (username !== cleanName || !username || username.length > maxLength || nameFilter.isBadName(username)) {
            return response.status(400).json({ error: "invalid_username" });
        }

        try {
            const current = store.getUserById(user.id);
            if (!current) {
                return response.status(401).json({ error: "login_required" });
            }
            if (current.username.toLowerCase() === username.toLowerCase()) {
                return response.json({
                    success: true,
                    unchanged: true,
                    username: current.username
                });
            }
            if (!store.updateUsername(user.id, username)) {
                return response.status(429).json({ error: "username_cooldown" });
            }
            response.json({ success: true, username });
        } catch (error) {
            if (String(error.message).includes("users.username")) {
                return response.status(409).json({ error: "username_taken" });
            }
            throw error;
        }
    });

    app.delete("/api/account", (request, response) => {
        if (!sameOrigin(request)) return response.status(403).json({ error: "invalid_origin" });
        const user = currentUser(request);
        if (!user) return response.status(401).json({ error: "login_required" });
        if (isBanned(user)) {
            return response.status(403).json({ error: "account_unavailable" });
        }
        store.deleteUser(user.id);
        response.clearCookie(SESSION_COOKIE, cookieOptions(request));
        response.json({ success: true });
    });

    return {
        joinTokens,
        store,
        sessionCookie: SESSION_COOKIE,
        getCurrentUser: currentUser
    };
}

export { DAY_MS };
