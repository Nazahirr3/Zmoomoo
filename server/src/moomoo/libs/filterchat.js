import { config } from "../config.js";
import normalizer from "../../../../shared/normalize-text.js";

var DAY_MS = 24 * 60 * 60 * 1000;
var normalizeVariants = normalizer.normalizeVariants;
var SEVERE_WORDS = buildWordList((config.chatSevereWords || [
    "nigger", "nigga", "nig", "niga", "ngga", "ngger", "nggr", "ngr", "nga", "faggot"
]).concat(config.nameBadWords || []));
var MILD_WORDS = buildWordList(config.chatMildWords || [
    "hoe", "slut", "pussy", "dick", "whore", "bitch", "cunt"
]);
var SAFE_WORDS = (config.chatSafeWords || [
    "class", "assassin", "grape", "cocktail", "manga", "angry", "nigeria"
]).map(function(word) {
    return normalizeVariants(word);
});

function buildWordList(words) {
    return words.map(function(word) {
        return normalizeVariants(word);
    }).filter(function(word) {
        return word.compactOne;
    });
}

export function normalizeMessage(message) {
    return normalizeVariants(message).compactOne;
}

export function filter_chat(chat, options) {
    if (!chat || typeof chat !== "string") return "";

    var match = classifyChat(chat, options);
    if (!match) return chat.trim();
    if (match.severity === "severe") return "";
    return maskMildWords(chat, options);
}

export function classifyChat(raw, options) {
    if (!raw || typeof raw !== "string") return null;

    var enabled = options && typeof options.enabled === "boolean" ? options.enabled : config.chatFilterEnabled !== false;
    if (!enabled) return null;

    var antiBypass = options && typeof options.antiBypass === "boolean" ? options.antiBypass : config.chatFilterAntiBypass !== false;
    var variants = antiBypass ?
        normalizeVariants(raw) :
        normalizeVariants(raw.toLowerCase().replace(/[^a-z\s]/g, ""));
    var tokens = variants.two.split(/\s+/).filter(Boolean);

    if (matchesSevere(variants, tokens)) return { severity: "severe" };
    if (matchesMild(tokens)) return { severity: "mild" };
    return null;
}

export function isBadChat(raw, options) {
    return Boolean(classifyChat(raw, options));
}

export function isSevereChat(raw, options) {
    var match = classifyChat(raw, options);
    return Boolean(match && match.severity === "severe");
}

export function isSevereAcrossMessages(messages, options) {
    var enabled = options && typeof options.enabled === "boolean" ? options.enabled : config.chatFilterEnabled !== false;
    if (!enabled) return false;

    var text = messages.join("");
    var variants = normalizeVariants(text);
    return matchesSevere(variants, variants.two.split(/\s+/).filter(Boolean), true);
}

export function isChatAdvertisement(raw) {
    return /(?:https?:\/\/|www\.|discord\.gg\/|discord(?:app)?\.com\/invite\/|(?:^|\s)join\s+(?:my|our)\s+(?:server|discord|game)\b)/i.test(raw);
}

export function getChatViolation(raw, options) {
    if (options && options.disableAll === true) return null;
    var match = classifyChat(raw, options);
    if (match) return match;
    return isChatAdvertisement(raw) ? { severity: "blocked" } : null;
}

function matchesSevere(variants, tokens, allowCompact) {
    var compactOne = allowCompact ? removeSafeWords(variants.compactOne) : "";
    var compactTwo = allowCompact ? removeSafeWords(variants.compactTwo) : "";

    for (var i = 0; i < SEVERE_WORDS.length; i++) {
        var term = SEVERE_WORDS[i];
        if (allowCompact && term.compactOne.length > 4 &&
            (compactOne.indexOf(term.compactOne) !== -1 ||
                compactTwo.indexOf(term.compactTwo) !== -1)) return true;

        for (var j = 0; j < tokens.length; j++) {
            if (!isSafeWord(tokens[j]) &&
                matchesWord(tokens[j], term, false)) return true;
        }

        if (matchesSeparatedLetters(tokens, term)) return true;
    }

    return false;
}

function removeSafeWords(text) {
    for (var i = 0; i < SAFE_WORDS.length; i++) {
        var safe = SAFE_WORDS[i];
        var words = [safe.compactOne, safe.compactTwo];
        for (var j = 0; j < words.length; j++) {
            if (!words[j]) continue;
            var escaped = words[j].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            text = text.replace(new RegExp(escaped, "g"), " ");
        }
    }
    return text;
}

function matchesMild(tokens) {
    for (var i = 0; i < tokens.length; i++) {
        if (isSafeWord(tokens[i])) continue;

        for (var j = 0; j < MILD_WORDS.length; j++) {
            if (matchesWord(tokens[i], MILD_WORDS[j], false)) return true;
        }
    }

    return false;
}

function isSafeWord(token) {
    for (var i = 0; i < SAFE_WORDS.length; i++) {
        if (matchesWord(token, SAFE_WORDS[i], false)) return true;
    }
    return false;
}

function matchesWord(token, word, partial) {
    var variants = normalizeVariants(token);
    if (partial) {
        return variants.compactOne.indexOf(word.compactOne) !== -1 ||
            variants.compactTwo.indexOf(word.compactTwo) !== -1;
    }
    return matchesExact(variants.compactOne, word, true) ||
        matchesExact(variants.compactTwo, word, false);
}

function matchesExact(value, word, oneRepeat) {
    if (oneRepeat && word.compactOne.length > 1 && value === word.compactOne) return true;
    return value === word.compactTwo;
}

function matchesSeparatedLetters(tokens, word) {
    var maxLength = Math.max(word.compactOne.length, word.compactTwo.length);
    for (var i = 0; i < tokens.length; i++) {
        if (tokens[i].length !== 1) continue;

        var runStart = i;
        var runEnd = i;
        while (runStart > 0 && tokens[runStart - 1].length === 1) runStart--;
        while (runEnd + 1 < tokens.length && tokens[runEnd + 1].length === 1) runEnd++;
        if (isSafeWord(tokens.slice(runStart, runEnd + 1).join(""))) {
            i = runEnd;
            continue;
        }

        var combined = "";
        for (var j = i; j < tokens.length && j < i + maxLength; j++) {
            if (tokens[j].length !== 1) break;
            combined += tokens[j];
            if ((matchesExact(combined, word, true) || matchesExact(combined, word, false)) &&
                (i === 0 || tokens[i - 1].length !== 1) &&
                (j === tokens.length - 1 || tokens[j + 1].length !== 1)) return true;
        }
    }
    return false;
}

function maskMildWords(raw, options) {
    var antiBypass = options && typeof options.antiBypass === "boolean" ? options.antiBypass : config.chatFilterAntiBypass !== false;
    return raw.replace(/\S+/g, function(token) {
        var normalized = antiBypass ? normalizeVariants(token) :
            normalizeVariants(token.toLowerCase().replace(/[^a-z]/g, ""));
        for (var i = 0; i < SAFE_WORDS.length; i++) {
            if (normalized.compactOne === SAFE_WORDS[i].compactOne ||
                normalized.compactTwo === SAFE_WORDS[i].compactTwo) return token;
        }
        for (var j = 0; j < MILD_WORDS.length; j++) {
            if (matchesWord(token, MILD_WORDS[j], false)) return "****";
        }
        return token;
    }).trim();
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

export function parseMuteDuration(value) {
    if (typeof value !== "string") return null;
    var match = /^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|mo|mos|months?|y|yrs?|years?)$/i.exec(value.trim());
    if (!match) return null;

    var amount = Number(match[1]);
    var unit = match[2].toLowerCase();
    var multiplier;
    if (/^(s|sec|secs|second|seconds)$/.test(unit)) multiplier = 1000;
    else if (/^(m|min|mins|minute|minutes)$/.test(unit)) multiplier = 60 * 1000;
    else if (/^(h|hr|hrs|hour|hours)$/.test(unit)) multiplier = 60 * 60 * 1000;
    else if (/^(d|day|days)$/.test(unit)) multiplier = DAY_MS;
    else if (/^(mo|mos|month|months)$/.test(unit)) multiplier = 30 * DAY_MS;
    else multiplier = 365 * DAY_MS;

    var duration = amount * multiplier;
    return Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(duration)
        ? duration
        : null;
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
