import { Filter } from "bad-words";

var chatFilter = new Filter();

var LEET_EQUIVALENTS = {
    a: "4@",
    b: "8",
    c: "(",
    e: "3",
    g: "9",
    i: "1!l|",
    l: "1!i|",
    o: "0",
    s: "5$",
    t: "7+",
    z: "2"
};

var compiled = [];

// build regexes once
(function buildList() {
    for (var i = 0; i < chatFilter.list.length; i++) {
        var term = chatFilter.list[i];
        if (!term || typeof term !== "string") continue;
        var key = term.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!key) continue;
        try {
            var pattern = buildVariantPattern(key);
            compiled.push({
                rg: new RegExp(pattern, "gi"),
                repl: buildReplacement(term.length)
            });
        } catch (e) {
            // fallback to exact match if anything goes wrong
            try {
                compiled.push({
                    rg: new RegExp(escapeRegExp(term), "gi"),
                    repl: buildReplacement(term.length)
                });
            } catch (ee) { }
        }
    }
})();

export const filter_chat = function(chat) {
    if (!chat || typeof chat !== "string") return "";

    var s = sanitizeMessage(chat);

    for (var i = 0; i < compiled.length; i++) {
        s = s.replace(compiled[i].rg, compiled[i].repl);
    }

    return s;
};

function sanitizeMessage(input) {
    var truncated = (input + "").slice(0, 300);
    var out = "";
    for (var i = 0; i < truncated.length; i++) {
        var ch = truncated.charAt(i);
        var cp = truncated.charCodeAt(i);
        if (cp >= 32 && cp <= 126) out += ch;
    }
    // collapse whitespace and trim
    return out.replace(/\s+/g, " ").trim();
}

function buildReplacement(length) {
    if (!length) return "";
    return "M" + "o".repeat(Math.max(length - 1, 0));
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeForClass(s) {
    return s.replace(/[-\]^\\]/g, "\\$&");
}

function buildVariantPattern(key) {
    // For each char, include the letter + leet equivalents, allow repeats and separators
    var parts = [];
    for (var i = 0; i < key.length; i++) {
        var ch = key.charAt(i);
        var eq = LEET_EQUIVALENTS[ch] || "";
        var cls = ch + eq;
        cls = escapeForClass(cls);
        // class + one-or-more repeats, then any non-alnum separators (zero or more)
        parts.push("[" + cls + "]+[^a-z0-9]*");
    }
    return parts.join("");
}
