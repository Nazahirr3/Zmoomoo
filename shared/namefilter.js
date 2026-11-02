"use strict";

var config = require("./config.js");
var ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/;
var CONFUSABLES = {
    "а": "a", "е": "e", "і": "i", "ο": "o", "ѕ": "s",
    "Α": "a", "Ε": "e", "Ι": "i", "Ο": "o", "Σ": "s",
    "α": "a", "ε": "e", "ι": "i", "σ": "s", "ς": "s", "τ": "t",
    "ａ": "a", "ｅ": "e", "ｉ": "i", "ｏ": "o", "ｓ": "s", "ｔ": "t"
};
var LEET_MAP = {
    "0": "o", "1": "i", "2": "z", "3": "e", "4": "a",
    "5": "s", "6": "g", "7": "t", "8": "b", "9": "g",
    "@": "a", "$": "s", "!": "i", "|": "i", "+": "t",
    "(": "c", ")": "c", "[": "c", "]": "c", "{": "c", "}": "c"
};
var BAD_NAME_WORDS = (config.nameBadWords || [
    "nigger", "nigga", "niga", "ngga", "ngger", "nggr", "ngr", "nga", "nig",
    "adolf", "hitler", "hilter", "adolfhitler", "hitleradolf", "hilteradolf",
    "osama", "binladen", "osamabinladen", "saddam", "hussein", "husseim",
    "saddamhussein", "saddamhusseim", "germanpainter", "austrianpainter", "austriapainter",
    "nazi", "nazis", "ss", "bbc", "bigblackcock", "bigblackcok", "bigblackc0ck", "cock"
]).map(normalizeName);
var SAFE_NAME_WORDS = (config.nameSafeWords || [
    "class", "assassin", "grape", "cocktail", "manga", "angry", "nigeria", "german", "austrian"
]).map(normalizeName);

function normalizeName(value) {
    if (value === null || value === undefined) return "";

    var text = String(value).toLowerCase();
    var out = "";
    var last = "";

    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var mapped = CONFUSABLES[ch] || LEET_MAP[ch] || ch;

        if (ZERO_WIDTH_REGEX.test(mapped)) continue;
        if (mapped >= "0" && mapped <= "9") {
            mapped = LEET_MAP[mapped] || "";
        }
        if (mapped < "a" || mapped > "z") continue;
        if (mapped === last) continue;

        out += mapped;
        last = mapped;
    }

    return out;
}

function isBadName(name) {
    if (!name || typeof name !== "string") return false;

    var checked = normalizeName(name);
    if (!checked) return false;

    for (var i = 0; i < SAFE_NAME_WORDS.length; i++) {
        if (SAFE_NAME_WORDS[i] && checked === SAFE_NAME_WORDS[i]) return false;
    }

    for (var j = 0; j < BAD_NAME_WORDS.length; j++) {
        var badWord = BAD_NAME_WORDS[j];
        if (!badWord) continue;
        if (badWord.length <= 4 && checked === badWord) return true;
        if (badWord.length > 4 && checked.indexOf(badWord) !== -1) return true;
    }

    return false;
}

module.exports = { isBadName: isBadName };
