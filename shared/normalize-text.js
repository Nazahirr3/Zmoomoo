"use strict";

var CONFUSABLES = {
    "а": "a", "е": "e", "і": "i", "о": "o", "с": "c", "х": "x", "у": "y",
    "р": "p", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h", "ѕ": "s",
    "α": "a", "ε": "e", "ι": "i", "ο": "o", "ρ": "p", "χ": "x", "κ": "k",
    "μ": "m", "τ": "t", "υ": "y", "ϲ": "c"
};
var LEET_MAP = {
    "0": "o", "1": "i", "2": "z", "3": "e", "4": "a", "5": "s",
    "6": "g", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s",
    "!": "i", "|": "i", "+": "t", "(": "c", ")": "c", "[": "c",
    "]": "c", "{": "c", "}": "c"
};
var MARKS = /\p{M}/gu;

function normalizeText(value, repeatLimit) {
    if (value === null || value === undefined) return "";

    var text = String(value).normalize("NFKC").normalize("NFKD").replace(MARKS, "").toLowerCase();
    var chars = Array.from(text);
    var out = "";
    var last = "";
    var repeats = 0;
    var limit = repeatLimit === 1 ? 1 : 2;

    for (var i = 0; i < chars.length; i++) {
        var ch = chars[i];
        var mapped = CONFUSABLES[ch] || LEET_MAP[ch] || ch;

        if (mapped >= "0" && mapped <= "9") {
            mapped = LEET_MAP[mapped] || "";
        }

        if (mapped >= "a" && mapped <= "z") {
            if (mapped === last) {
                repeats++;
                if (repeats >= limit) continue;
            } else {
                last = mapped;
                repeats = 0;
            }
            out += mapped;
        } else if (/\s/.test(mapped)) {
            if (out && out.charAt(out.length - 1) !== " ") {
                out += " ";
            }
            last = "";
            repeats = 0;
        }
    }

    return out.trim();
}

function normalizeVariants(value) {
    var one = normalizeText(value, 1);
    var two = normalizeText(value, 2);
    return {
        one: one,
        two: two,
        compactOne: one.replace(/ /g, ""),
        compactTwo: two.replace(/ /g, "")
    };
}

module.exports = {
    normalizeText: normalizeText,
    normalizeVariants: normalizeVariants
};
