import { config } from "../config.js";

var DAY_MS = 24 * 60 * 60 * 1000;
var ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/;
var CONFUSABLES = {
    a: "a", e: "e", i: "i", o: "o", s: "s", t: "t",
    A: "a", E: "e", I: "i", O: "o", S: "s", T: "t",
    "а": "a", "е": "e", "і": "i", "ο": "o", "ѕ": "s",
    "Α": "a", "Ε": "e", "Ι": "i", "Ο": "o", "Σ": "s",
    "α": "a", "ε": "e", "ι": "i", "σ": "s", "ς": "s", "τ": "t",
    "ａ": "a", "ｅ": "e", "ｉ": "i", "ｏ": "o", "ｓ": "s",
    "ｔ": "t"
};
var LEET_MAP = {
    "0": "o",
    "1": "i",
    "2": "z",
    "3": "e",
    "4": "a",
    "5": "s",
    "6": "g",
    "7": "t",
    "8": "b",
    "9": "g",
    "@": "a",
    "$": "s",
    "!": "i",
    "|": "i",
    "+": "t",
    "(": "c",
    ")": "c",
    "[": "c",
    "]": "c",
    "{": "c",
    "}": "c"
};

var BAD_WORDS = (config.chatBadWords || [
    "nigger", "nigga", "nig", "niga", "ngga", "ngger", "nggr", "ngr", "nga",
    "hoe", "slut", "pussy", "dick", "faggot", "whore", "bitch", "cunt"
]).map(function(word) {
    return String(word).toLowerCase();
});

var SAFE_WORDS = (config.chatSafeWords || ["class", "assassin", "grape", "cocktail", "manga", "angry", "nigeria"]).map(function(word) {
    return normalizeInput(word);
});

var NORMALIZED_BAD_WORDS = BAD_WORDS.map(normalizeInput).filter(Boolean);

function normalizeInput(value) {
    if (value === null || value === undefined) return "";

    var text = String(value).toLowerCase();
    var out = "";
    var last = "";

    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var mapped = CONFUSABLES[ch] || LEET_MAP[ch] || ch;

        if (mapped === "" || ZERO_WIDTH_REGEX.test(mapped)) {
            continue;
        }

        if (mapped >= "0" && mapped <= "9") {
            mapped = LEET_MAP[mapped] || "";
        }

        if (mapped < "a" || mapped > "z") {
            continue;
        }

        if (mapped === last) {
            continue;
        }

        out += mapped;
        last = mapped;
    }

    return out;
}

export function normalizeMessage(message) {
    return normalizeInput(message);
}

export function filter_chat(chat, options) {
    if (!chat || typeof chat !== "string") return "";

    var enabled = options && typeof options.enabled === "boolean" ? options.enabled : config.chatFilterEnabled !== false;
    var antiBypass = options && typeof options.antiBypass === "boolean" ? options.antiBypass : config.chatFilterAntiBypass !== false;

    if (!enabled) {
        return chat.trim();
    }

    return isBadChat(chat, { enabled: enabled, antiBypass: antiBypass }) ? "" : chat.trim();
}

export function isBadChat(raw, options) {
    if (!raw || typeof raw !== "string") return false;

    var enabled = options && typeof options.enabled === "boolean" ? options.enabled : config.chatFilterEnabled !== false;
    if (!enabled) return false;

    var antiBypass = options && typeof options.antiBypass === "boolean" ? options.antiBypass : config.chatFilterAntiBypass !== false;
    var checked = antiBypass ? normalizeInput(raw) : raw.toLowerCase().replace(/[^a-z]/g, "");

    if (!checked) return false;

    for (var i = 0; i < SAFE_WORDS.length; i++) {
        if (!SAFE_WORDS[i]) continue;
        if (checked === SAFE_WORDS[i]) return false;
    }

    for (var j = 0; j < NORMALIZED_BAD_WORDS.length; j++) {
        var badWord = NORMALIZED_BAD_WORDS[j];
        if (!badWord) continue;

        if (badWord.length <= 4) {
            if (checked === badWord) return true;
            continue;
        }

        if (checked.indexOf(badWord) !== -1) return true;
    }

    return false;
}

export function getMuteDuration(offenseCount) {
    var count = Number(offenseCount) || 0;
    if (count < 1) count = 1;

    var base = Number(config.chatMuteStart) || 5 * 60 * 1000;
    var cap = Number(config.chatMuteCap) || Number.MAX_SAFE_INTEGER;
    var total = base * Math.pow(2, count - 1);

    if (!Number.isFinite(total)) return cap;
    return Math.min(Math.max(total, 0), cap);
}

export function formatMuteDuration(ms) {
    var totalMs = Number(ms) || 0;
    if (totalMs <= 0) return "0s";

    var totalSec = Math.ceil(totalMs / 1000);
    var years = Math.floor(totalSec / (52 * 7 * 24 * 60 * 60));
    totalSec -= years * 52 * 7 * 24 * 60 * 60;
    var weeks = Math.floor(totalSec / (7 * 24 * 60 * 60));
    totalSec -= weeks * 7 * 24 * 60 * 60;
    var days = Math.floor(totalSec / (24 * 60 * 60));
    totalSec -= days * 24 * 60 * 60;
    var hours = Math.floor(totalSec / (60 * 60));
    totalSec -= hours * 60 * 60;
    var minutes = Math.floor(totalSec / 60);
    totalSec -= minutes * 60;
    var seconds = totalSec;

    var parts = [];
    if (years > 0) parts.push(years + "y");
    if (weeks > 0) parts.push(weeks + "w");
    if (days > 0) parts.push(days + "d");
    if (hours > 0) parts.push(hours + "h");
    if (minutes > 0) parts.push(minutes + "m");
    if (seconds > 0 || parts.length === 0) parts.push(seconds + "s");

    return parts.join(" ");
}

export function handleDevCommand(player, text) {
    if (!player || !text || typeof text !== "string") return false;

    var value = text.trim();

    if (value === "!mute10") {
        player.muteUntil = Date.now() + 10000;
        return true;
    }

    var match = value.match(/^!resetoffense\s+(\d+(?:\.\d+)?)$/i);
    if (match) {
        var days = Number(match[1]);
        if (!Number.isFinite(days) || days < 0) days = 0;
        days = Math.min(days, Number.MAX_SAFE_INTEGER / DAY_MS);
        player.lastOffenseAt = Date.now() - (days * DAY_MS);
        player.muteUntil = 0;
        return true;
    }

    return false;
}

export function resetMuteStateIfNeeded(player) {
    if (!player) return;

    var now = Date.now();
    var resetMs = Number(config.chatMuteResetDays || 3) * DAY_MS;

    if (player.lastOffenseAt && (now - player.lastOffenseAt) >= resetMs) {
        player.offenseCount = 0;
        player.lastOffenseAt = 0;
        if (player.muteUntil && player.muteUntil <= now) {
            player.muteUntil = 0;
        }
    }
}
