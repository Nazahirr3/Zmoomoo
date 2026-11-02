"use strict";

var config = require("./config.js");
var normalizeVariants = require("./normalize-text.js").normalizeVariants;
var BAD_NAME_WORDS = (config.nameBadWords || [
    "nigger", "nigga", "niga", "ngga", "ngger", "nggr", "ngr", "nga", "nig",
    "adolf", "hitler", "hilter", "adolfhitler", "hitleradolf", "hilteradolf",
    "osama", "binladen", "osamabinladen", "saddam", "hussein", "husseim",
    "saddamhussein", "saddamhusseim", "germanpainter", "austrianpainter", "austriapainter",
    "nazi", "nazis", "ss", "bbc", "bigblackcock", "bigblackcok", "bigblackc0ck", "cock"
]).map(function(word) {
    return normalizeVariants(word);
});
var SAFE_NAME_WORDS = (config.nameSafeWords || [
    "class", "assassin", "grape", "cocktail", "manga", "angry", "nigeria", "german", "austrian"
]).map(function(word) {
    return normalizeVariants(word);
});

function isBadName(name) {
    if (!name || typeof name !== "string") return false;

    var checked = normalizeVariants(name);
    if (!checked.compactOne) return false;

    for (var i = 0; i < SAFE_NAME_WORDS.length; i++) {
        if (checked.compactOne === SAFE_NAME_WORDS[i].compactOne ||
            checked.compactTwo === SAFE_NAME_WORDS[i].compactTwo) return false;
    }

    for (var j = 0; j < BAD_NAME_WORDS.length; j++) {
        var badWord = BAD_NAME_WORDS[j];
        if (!badWord) continue;
        if (badWord.compactOne.length <= 4 &&
            (checked.compactOne === badWord.compactOne || checked.compactTwo === badWord.compactTwo)) return true;
        if (badWord.compactOne.length > 4 &&
            (checked.compactOne.indexOf(badWord.compactOne) !== -1 ||
                checked.compactTwo.indexOf(badWord.compactTwo) !== -1)) return true;
    }

    return false;
}

module.exports = { isBadName: isBadName };
