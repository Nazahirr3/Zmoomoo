const DEFAULT_GUILD_ID = "1566721142251589772";
const DEFAULT_OWNER_ROLE_ID = "1566721142251589781";

export async function hasDiscordRole(discordId, options = {}) {
    const token = options.token || process.env.DISCORD_BOT_TOKEN;
    const guildId = options.guildId || process.env.DISCORD_GUILD_ID || DEFAULT_GUILD_ID;
    const roleId = options.roleId || process.env.DISCORD_OWNER_ROLE_ID || DEFAULT_OWNER_ROLE_ID;
    const request = options.fetch || globalThis.fetch;

    if (!token) throw new Error("DISCORD_BOT_TOKEN is not configured.");
    if (![discordId, guildId, roleId].every(value => typeof value === "string" && /^\d{15,22}$/.test(value))) {
        throw new Error("Discord role-check IDs are invalid.");
    }

    const response = await request(
        `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
        {
            headers: { Authorization: `Bot ${token}` },
            signal: AbortSignal.timeout(5000)
        }
    );
    if (response.status === 404) {
        const error = await response.json();
        if (error.code === 10007) return false;
        throw new Error(`Discord member lookup failed (404, code ${error.code || "unknown"}).`);
    }
    if (!response.ok) {
        throw new Error(`Discord member lookup failed (${response.status}).`);
    }

    const member = await response.json();
    return Array.isArray(member.roles) && member.roles.includes(roleId);
}
