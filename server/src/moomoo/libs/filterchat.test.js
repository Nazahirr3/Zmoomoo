import test from "node:test";
import assert from "node:assert/strict";
import {
    classifyChat,
    filter_chat,
    getChatViolation,
    getMuteDuration,
    isChatAdvertisement,
    isSevereAcrossMessages,
    isSevereChat,
    parseMuteDuration
} from "./filterchat.js";
import nameFilter from "../../../../shared/namefilter.js";
import config from "../../../../shared/config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("severe chat variants are caught after normalization", () => {
    for (const message of [
        "n.i.g.g.e.r",
        "n_i_g_g_e_r",
        "n1gg3r",
        "nnniiiggger",
        "n i g g e r",
        "ｎ\u0301ｉｇｇｅｒ",
        "n\u200Bigger"
    ]) {
        assert.equal(isSevereChat(message), true, message);
    }
});

test("name-filter words are also blocked in chat", () => {
    for (const word of config.nameBadWords) {
        assert.equal(isSevereChat(word), true, word);
    }
    assert.equal(isSevereChat("cock"), true);
    assert.equal(isSevereChat("cocktail"), false);
});

test("mild words are masked without blocking the message", () => {
    assert.deepEqual(classifyChat("that is a dick"), { severity: "mild" });
    assert.equal(filter_chat("that is a d.i.c.k."), "that is a ****");
    assert.equal(classifyChat("class assassin grape cocktail nigeria"), null);
});

test("spaced severe words are caught without compacting mild words", () => {
    assert.equal(isSevereChat("n i g g e r"), true);
    assert.equal(isSevereChat("nigeria"), false);
    assert.equal(classifyChat("c l a s s"), null);
    assert.equal(isSevereAcrossMessages(["hello nig", "ger"]), true);
    assert.equal(isSevereAcrossMessages(["hello", "nigeria"]), false);
});

test("advertising links are recognized", () => {
    assert.equal(isChatAdvertisement("join my server"), true);
    assert.equal(isChatAdvertisement("discord.gg/example"), true);
    assert.equal(isChatAdvertisement("hello there"), false);
});

test("staff-disabled chat filtering skips profanity and advertising checks", () => {
    const options = { enabled: false, disableAll: true };
    assert.equal(getChatViolation("discord.gg/example", options), null);
    assert.equal(getChatViolation("n i g g e r", options), null);
    assert.equal(filter_chat("discord.gg/example", options), "discord.gg/example");
});

test("name filter shares normalization and preserves safe names", () => {
    assert.equal(nameFilter.isBadName("ａ\u0301u.s.t.r.i.a.p.a.i.n.t.e.r"), true);
    assert.equal(nameFilter.isBadName("n\u0430zі"), true);
    assert.equal(nameFilter.isBadName("austriapainter"), true);
    assert.equal(nameFilter.isBadName("austrian"), false);
});

test("mute duration doubles up to the configured cap", () => {
    assert.equal(getMuteDuration(1), 5 * 60 * 1000);
    assert.equal(getMuteDuration(2), 10 * 60 * 1000);
    assert.equal(getMuteDuration(100), 24 * 60 * 60 * 1000);
});

test("manual mute durations accept explicit seconds through years", () => {
    assert.equal(parseMuteDuration("10s"), 10 * 1000);
    assert.equal(parseMuteDuration("10m"), 10 * 60 * 1000);
    assert.equal(parseMuteDuration("10h"), 10 * 60 * 60 * 1000);
    assert.equal(parseMuteDuration("10d"), 10 * DAY_MS);
    assert.equal(parseMuteDuration("10mo"), 10 * 30 * DAY_MS);
    assert.equal(parseMuteDuration("10y"), 10 * 365 * DAY_MS);
    assert.equal(parseMuteDuration("10 hours"), 10 * 60 * 60 * 1000);
    assert.equal(parseMuteDuration("10"), null);
    assert.equal(parseMuteDuration("0d"), null);
    assert.equal(parseMuteDuration("999999999999999999y"), null);
});
