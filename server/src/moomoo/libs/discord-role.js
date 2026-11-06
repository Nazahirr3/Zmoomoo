const DEFAULT_GUILD_ID = "1566721142251589772";
const DEFAULT_OWNER_ROLE_ID = "1566721142251589781";
const DEFAULT_ADMINISTRATOR_ROLE_ID = "1566721142251589778";

export async function getDiscordMemberRoles(discordId, options = {}) {
    const token = options.token || process.env.DISCORD_BOT_TOKEN;
    const guildId = options.guildId || process.env.DISCORD_GUILD_ID || DEFAULT_GUILD_ID;
    const request = options.fetch || globalThis.fetch;

    if (!token) throw new Error("DISCORD_BOT_TOKEN is not configured.");
    if (![discordId, guildId].every(value => typeof value === "string" && /^\d{15,22}$/.test(value))) {
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
        if (error.code === 10007) return [];
        throw new Error(`Discord member lookup failed (404, code ${error.code || "unknown"}).`);
    }
    if (!response.ok) {
        throw new Error(`Discord member lookup failed (${response.status}).`);
    }

    const member = await response.json();
    return Array.isArray(member.roles) ? member.roles : [];
}

export async function hasDiscordRole(discordId, options = {}) {
    const roleId = options.roleId || process.env.DISCORD_OWNER_ROLE_ID || DEFAULT_OWNER_ROLE_ID;
    if (typeof roleId !== "string" || !/^\d{15,22}$/.test(roleId)) {
        throw new Error("Discord role-check IDs are invalid.");
    }
    const roles = await getDiscordMemberRoles(discordId, options);
    return roles.includes(roleId);
}

export async function getDiscordStaffRoles(discordId, options = {}) {
    const roles = await getDiscordMemberRoles(discordId, options);
    const ownerRoleId = options.ownerRoleId || process.env.DISCORD_OWNER_ROLE_ID || DEFAULT_OWNER_ROLE_ID;
    const administratorRoleId = options.administratorRoleId ||
        process.env.DISCORD_ADMINISTRATOR_ROLE_ID || DEFAULT_ADMINISTRATOR_ROLE_ID;
    if (![ownerRoleId, administratorRoleId].every(value =>
        typeof value === "string" && /^\d{15,22}$/.test(value))) {
        throw new Error("Discord role-check IDs are invalid.");
    }
    return {
        owner: roles.includes(ownerRoleId),
        administrator: roles.includes(administratorRoleId)
    };
}
