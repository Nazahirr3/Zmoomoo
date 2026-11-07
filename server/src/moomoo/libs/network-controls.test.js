import test from "node:test";
import assert from "node:assert/strict";
import {
    createIpBlockList,
    getClientAddress,
    isAddressInBlockList,
    normalizeIpAddress,
    RollingWindowLimiter
} from "./network-controls.js";

test("normalizes IPv4-mapped addresses and trusts forwarded IPs only when enabled", () => {
    assert.equal(normalizeIpAddress("::ffff:192.0.2.10"), "192.0.2.10");

    const request = {
        socket: { remoteAddress: "::ffff:192.0.2.1" },
        headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.8" }
    };
    assert.equal(getClientAddress(request), "192.0.2.1");
    assert.equal(getClientAddress(request, true), "203.0.113.8");
});

test("matches configured IPv4 and IPv6 risk ranges without rejecting invalid ranges", () => {
    const ranges = createIpBlockList("192.0.2.0/24, 2001:db8::/32");
    assert.equal(isAddressInBlockList("192.0.2.45", ranges), true);
    assert.equal(isAddressInBlockList("::ffff:192.0.2.45", ranges), true);
    assert.equal(isAddressInBlockList("198.51.100.4", ranges), false);
    assert.equal(isAddressInBlockList("2001:db8::8", ranges), true);
    assert.throws(() => createIpBlockList("192.0.2.0/64"), /Invalid proxy\/VPN CIDR entry/);
});

test("rolling window limiter expires attempts and bounds stored keys", () => {
    const limiter = new RollingWindowLimiter(2, 1000, 2);
    assert.equal(limiter.allow("one", 0), true);
    assert.equal(limiter.allow("one", 100), true);
    assert.equal(limiter.allow("one", 200), false);
    assert.equal(limiter.retryAfter("one", 200), 800);
    assert.equal(limiter.allow("one", 1000), true);
    limiter.allow("two", 1000);
    limiter.allow("three", 1000);
    assert.equal(limiter.entries.size, 2);
});
