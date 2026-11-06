import { randomBytes, createHash, createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
const DEFAULT_DB_PATH = path.join(DATA_DIR, "accounts.sqlite");
const SESSION_LENGTH = 30 * 24 * 60 * 60 * 1000;
const USERNAME_COOLDOWN = 14 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_WINDOW = 15 * 24 * 60 * 60 * 1000;

function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

export function createAccountStore(dbPath = process.env.ACCOUNT_DB_PATH || DEFAULT_DB_PATH) {
    if (process.env.NODE_ENV === "production" && !process.env.IP_BAN_SECRET && !process.env.JOIN_SECRET) {
        throw new Error("IP_BAN_SECRET or JOIN_SECRET must be configured in production.");
    }
    const ipHashSecret = process.env.IP_BAN_SECRET || process.env.JOIN_SECRET || "development-only-ip-secret";
    if (dbPath !== ":memory:") {
        mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }

    const db = new DatabaseSync(dbPath);
    db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            discord_id TEXT NOT NULL UNIQUE,
            email TEXT,
            email_verified INTEGER NOT NULL DEFAULT 0,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            username_changed_at INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_login_at INTEGER NOT NULL,
            banned_until INTEGER,
            ban_reason TEXT
        );
        CREATE TABLE IF NOT EXISTS provider_identities (
            provider TEXT NOT NULL,
            provider_account_id TEXT NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            last_login_at INTEGER NOT NULL,
            PRIMARY KEY (provider, provider_account_id),
            UNIQUE (provider, user_id)
        );
        CREATE INDEX IF NOT EXISTS provider_identities_user_idx
            ON provider_identities(user_id);
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS stats (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            kills INTEGER NOT NULL DEFAULT 0,
            deaths INTEGER NOT NULL DEFAULT 0,
            best_score INTEGER NOT NULL DEFAULT 0,
            play_seconds INTEGER NOT NULL DEFAULT 0,
            damage INTEGER NOT NULL DEFAULT 0,
            healing INTEGER NOT NULL DEFAULT 0,
            wood INTEGER NOT NULL DEFAULT 0,
            food INTEGER NOT NULL DEFAULT 0,
            stone INTEGER NOT NULL DEFAULT 0,
            gold INTEGER NOT NULL DEFAULT 0,
            animal_kills INTEGER NOT NULL DEFAULT 0,
            boss_kills INTEGER NOT NULL DEFAULT 0,
            animal_damage INTEGER NOT NULL DEFAULT 0,
            best_kills INTEGER NOT NULL DEFAULT 0,
            lives INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS chat_punishments (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            offense_count INTEGER NOT NULL DEFAULT 0,
            last_offense_at INTEGER NOT NULL DEFAULT 0,
            muted_until INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS bans (
            discord_id TEXT PRIMARY KEY,
            banned_until INTEGER NOT NULL,
            reason TEXT
        );
        CREATE TABLE IF NOT EXISTS moderation_audit (
            id INTEGER PRIMARY KEY,
            executor_discord_id TEXT NOT NULL,
            action TEXT NOT NULL,
            target_discord_id TEXT NOT NULL,
            target_type TEXT NOT NULL DEFAULT "discord",
            target_value TEXT NOT NULL DEFAULT "",
            details TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS banned_ips (
            ip_hash TEXT PRIMARY KEY,
            banned_until INTEGER NOT NULL,
            reason TEXT NOT NULL DEFAULT "",
            banned_by TEXT NOT NULL DEFAULT "",
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS moderation_audit_target_idx
            ON moderation_audit(target_discord_id, created_at);
    `);
    const auditColumns = new Set(db.prepare("PRAGMA table_info(moderation_audit)").all().map(column => column.name));
    if (!auditColumns.has("target_type")) {
        db.exec("ALTER TABLE moderation_audit ADD COLUMN target_type TEXT NOT NULL DEFAULT 'discord'");
    }
    if (!auditColumns.has("target_value")) {
        db.exec("ALTER TABLE moderation_audit ADD COLUMN target_value TEXT NOT NULL DEFAULT ''");
    }
    const userColumns = db.prepare("PRAGMA table_info(users)").all();
    if (!userColumns.some(column => column.name === "username_changed_at")) {
        db.exec("ALTER TABLE users ADD COLUMN username_changed_at INTEGER NOT NULL DEFAULT 0");
    }
    if (!userColumns.some(column => column.name === "email")) {
        db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    }
    if (!userColumns.some(column => column.name === "email_verified")) {
        db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    }
    const statColumns = db.prepare("PRAGMA table_info(stats)").all();
    const existingStatColumns = new Set(statColumns.map(column => column.name));
    for (const column of [
        "damage", "healing", "wood", "food", "stone", "gold", "animal_kills",
        "boss_kills", "animal_damage", "best_kills", "lives"
    ]) {
        if (!existingStatColumns.has(column)) {
            db.exec(`ALTER TABLE stats ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
        }
    }

    const findUserByDiscordId = db.prepare("SELECT * FROM users WHERE discord_id = ?");
    const findUserByProvider = db.prepare(`
        SELECT users.* FROM provider_identities
        JOIN users ON users.id = provider_identities.user_id
        WHERE provider_identities.provider = ? AND provider_identities.provider_account_id = ?
    `);
    const findUserById = db.prepare("SELECT * FROM users WHERE id = ?");
    const findUserBySession = db.prepare(`
        SELECT users.* FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `);
    const findStats = db.prepare("SELECT * FROM stats WHERE user_id = ?");
    const findPunishment = db.prepare("SELECT offense_count, last_offense_at, muted_until FROM chat_punishments WHERE user_id = ?");
    const findBan = db.prepare("SELECT discord_id, banned_until, reason FROM bans WHERE discord_id = ?");
    const findUsersByQuery = db.prepare(`
        SELECT id, discord_id, username, created_at, last_login_at, banned_until, ban_reason
        FROM users
        WHERE discord_id = ? OR username LIKE ? COLLATE NOCASE
        ORDER BY last_login_at DESC
        LIMIT 10
    `);

    function findOrCreateDiscordUser(discordId) {
        const now = Date.now();
        let user = findUserByProvider.get("discord", discordId) || findUserByDiscordId.get(discordId);
        if (user) {
            db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, user.id);
            db.prepare(`
                INSERT INTO provider_identities (
                    provider, provider_account_id, user_id, created_at, last_login_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(provider, provider_account_id) DO UPDATE SET last_login_at = excluded.last_login_at
            `).run("discord", discordId, user.id, now, now);
            return findUserById.get(user.id);
        }

        for (let attempt = 0; attempt < 5; attempt++) {
            const username = "Player" + randomBytes(3).toString("hex").slice(0, 6);
            try {
                const result = db.prepare(`
                    INSERT INTO users (discord_id, username, created_at, last_login_at)
                    VALUES (?, ?, ?, ?)
                `).run(discordId, username, now, now);
                const userId = Number(result.lastInsertRowid);
                db.prepare("INSERT INTO stats (user_id) VALUES (?)").run(userId);
                db.prepare("INSERT INTO chat_punishments (user_id) VALUES (?)").run(userId);
                db.prepare(`
                    INSERT INTO provider_identities (
                        provider, provider_account_id, user_id, created_at, last_login_at
                    ) VALUES (?, ?, ?, ?, ?)
                `).run("discord", discordId, userId, now, now);
                return findUserById.get(userId);
            } catch (error) {
                if (!String(error.message).includes("users.username")) throw error;
            }
        }

        throw new Error("Could not create a unique account name");
    }

    function createSession(userId) {
        const token = randomBytes(32).toString("base64url");
        const now = Date.now();
        db.prepare(`
            INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(hashToken(token), userId, now, now + SESSION_LENGTH);
        db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
        return { token, expiresAt: now + SESSION_LENGTH };
    }

    function getSession(token) {
        if (!token) return null;
        const now = Date.now();
        const session = findUserBySession.get(hashToken(token), now);
        if (!session) return null;
        // keep active sessions rolling without storing the raw token
        const sessionRow = db.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(hashToken(token));
        if (sessionRow && Number(sessionRow.expires_at) - now <= SESSION_REFRESH_WINDOW) {
            db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
                .run(now + SESSION_LENGTH, hashToken(token));
        }
        return session;
    }

    function deleteSession(token) {
        if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    }

    function deleteUser(userId) {
        db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    }

    function invalidateAllSessions(userId) {
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    }

    function updateDiscordProfile(userId, email, emailVerified) {
        db.prepare("UPDATE users SET email = ?, email_verified = ? WHERE id = ?")
            .run(typeof email === "string" ? email.slice(0, 320) : null, emailVerified ? 1 : 0, userId);
    }

    function updateUsername(userId, username) {
        const now = Date.now();
        return db.prepare(`
            UPDATE users SET username = ?, username_changed_at = ?
            WHERE id = ? AND (username_changed_at = 0 OR username_changed_at <= ?)
        `).run(username, now, userId, now - USERNAME_COOLDOWN).changes > 0;
    }

    function getProfile(userId) {
        const user = findUserById.get(userId);
        if (!user) return null;
        const stats = findStats.get(userId);
        return {
            id: Number(user.id),
            username: user.username,
            usernameChangedAt: Number(user.username_changed_at) || 0,
            usernameChangeAvailableAt: (Number(user.username_changed_at) || 0) + USERNAME_COOLDOWN,
            createdAt: Number(user.created_at),
            stats: stats ? Object.fromEntries(
                Object.entries(stats).filter(([key]) => key !== "user_id")
            ) : {
                kills: 0, deaths: 0, best_score: 0, play_seconds: 0, damage: 0,
                healing: 0, wood: 0, food: 0, stone: 0, gold: 0, animal_kills: 0,
                boss_kills: 0, animal_damage: 0, best_kills: 0, lives: 0
            }
        };
    }

    function getUserById(userId) {
        return findUserById.get(userId) || null;
    }

    function getBan(discordId) {
        if (typeof discordId !== "string") return null;
        const ban = findBan.get(discordId);
        return ban && Number(ban.banned_until) > Date.now() ? { ...ban } : null;
    }

    function hashIp(address) {
        // keep raw player ips out of the database
        return createHmac("sha256", ipHashSecret).update(String(address)).digest("hex");
    }

    function banIp(address, bannedUntil, reason = "", executorDiscordId = "") {
        const until = Math.max(0, Math.floor(Number(bannedUntil) || 0));
        db.prepare(`
            INSERT INTO banned_ips (ip_hash, banned_until, reason, banned_by, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(ip_hash) DO UPDATE SET
                banned_until = excluded.banned_until,
                reason = excluded.reason,
                banned_by = excluded.banned_by
        `).run(hashIp(address), until, String(reason).slice(0, 500), String(executorDiscordId), Date.now());
    }

    function isIpBanned(address) {
        const row = db.prepare("SELECT banned_until, reason FROM banned_ips WHERE ip_hash = ?").get(hashIp(address));
        if (!row) return null;
        if (Number(row.banned_until) > Date.now()) return { ...row };
        db.prepare("DELETE FROM banned_ips WHERE ip_hash = ?").run(hashIp(address));
        return null;
    }

    function unbanIp(address) {
        db.prepare("DELETE FROM banned_ips WHERE ip_hash = ?").run(hashIp(address));
    }

    function saveBan(discordId, bannedUntil, reason = "") {
        if (typeof discordId !== "string" || !/^\d{15,22}$/.test(discordId)) {
            throw new TypeError("Invalid Discord id");
        }
        db.prepare(`
            INSERT INTO bans (discord_id, banned_until, reason)
            VALUES (?, ?, ?)
            ON CONFLICT(discord_id) DO UPDATE SET
                banned_until = excluded.banned_until,
                reason = excluded.reason
        `).run(discordId, Math.max(0, Math.floor(Number(bannedUntil) || 0)), String(reason));
    }

    function findModerationUsers(query) {
        const value = typeof query === "string" ? query.trim().slice(0, 64) : "";
        if (!value) return [];
        return findUsersByQuery.all(value, `%${value}%`).map(user => ({ ...user }));
    }

    function banUser(discordId, bannedUntil, reason = "") {
        if (typeof discordId !== "string" || !/^\d{15,22}$/.test(discordId)) {
            throw new TypeError("Invalid Discord id");
        }
        const until = Math.max(0, Math.floor(Number(bannedUntil) || 0));
        const normalizedReason = String(reason).trim().slice(0, 500);
        saveBan(discordId, until, normalizedReason);
        const user = findUserByDiscordId.get(discordId);
        if (user) {
            db.prepare(`
                UPDATE users SET banned_until = ?, ban_reason = ?
                WHERE discord_id = ?
            `).run(until, normalizedReason, discordId);
            db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
        }
        return user ? { ...findUserByDiscordId.get(discordId) } : null;
    }

    function unbanUser(discordId) {
        if (typeof discordId !== "string" || !/^\d{15,22}$/.test(discordId)) {
            throw new TypeError("Invalid Discord id");
        }
        saveBan(discordId, 0, "");
        db.prepare(`
            UPDATE users SET banned_until = NULL, ban_reason = NULL
            WHERE discord_id = ?
        `).run(discordId);
        return findUserByDiscordId.get(discordId) || null;
    }

    function writeModerationAudit(executorDiscordId, action, targetDiscordId, details = {}, targetType = "discord", targetValue = targetDiscordId) {
        if (![executorDiscordId, targetDiscordId].every(value =>
            typeof value === "string" && /^\d{15,22}$/.test(value))) {
            throw new TypeError("Invalid Discord id");
        }
        if (!["discord", "ip"].includes(targetType) || typeof targetValue !== "string" || targetValue.length > 128) {
            throw new TypeError("Invalid moderation target");
        }
        db.prepare(`
            INSERT INTO moderation_audit (
                executor_discord_id, action, target_discord_id, target_type, target_value, details, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            executorDiscordId,
            String(action).slice(0, 64),
            targetDiscordId,
            targetType,
            targetValue,
            JSON.stringify(details).slice(0, 2000),
            Date.now()
        );
    }

    function recordMatch(userId, matchStats, seconds, died) {
        if (!userId) return;
        const stats = matchStats || {};
        const value = key => Math.max(0, Math.floor(Number(stats[key]) || 0));
        db.prepare(`
            INSERT INTO stats (
                user_id, kills, deaths, best_score, play_seconds, damage, healing,
                wood, food, stone, gold, animal_kills, boss_kills, animal_damage,
                best_kills, lives
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                kills = kills + excluded.kills,
                deaths = deaths + excluded.deaths,
                best_score = MAX(best_score, excluded.best_score),
                play_seconds = play_seconds + excluded.play_seconds,
                damage = damage + excluded.damage,
                healing = healing + excluded.healing,
                wood = wood + excluded.wood,
                food = food + excluded.food,
                stone = stone + excluded.stone,
                gold = gold + excluded.gold,
                animal_kills = animal_kills + excluded.animal_kills,
                boss_kills = boss_kills + excluded.boss_kills,
                animal_damage = animal_damage + excluded.animal_damage,
                best_kills = MAX(best_kills, excluded.best_kills),
                lives = lives + excluded.lives
        `).run(
            userId,
            value("kills"),
            died ? 1 : 0,
            value("score"),
            Math.max(0, Math.floor(Number(seconds) || 0)),
            value("damage"),
            value("healing"),
            value("wood"),
            value("food"),
            value("stone"),
            value("gold"),
            value("animal_kills"),
            value("boss_kills"),
            value("animal_damage"),
            value("kills"),
            value("lives")
        );
    }

    function getPunishment(userId) {
        const punishment = findPunishment.get(userId);
        return punishment ? { ...punishment } : { offense_count: 0, last_offense_at: 0, muted_until: 0 };
    }

    function savePunishment(userId, offenseCount, lastOffenseAt, mutedUntil) {
        db.prepare(`
            INSERT INTO chat_punishments (user_id, offense_count, last_offense_at, muted_until)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                offense_count = excluded.offense_count,
                last_offense_at = excluded.last_offense_at,
                muted_until = excluded.muted_until
        `).run(userId, offenseCount, lastOffenseAt, mutedUntil);
    }

    return {
        close: () => db.close(),
        createSession,
        deleteSession,
        deleteUser,
        invalidateAllSessions,
        updateDiscordProfile,
        findOrCreateDiscordUser,
        getProfile,
        getBan,
        banIp,
        isIpBanned,
        hashIpForAudit: hashIp,
        unbanIp,
        findModerationUsers,
        getPunishment,
        getSession,
        getUserById,
        recordMatch,
        saveBan,
        banUser,
        unbanUser,
        writeModerationAudit,
        savePunishment,
        updateUsername
    };
}

export { SESSION_LENGTH, USERNAME_COOLDOWN };
