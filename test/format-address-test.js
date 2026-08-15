'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const formatAddress = require('../lib/format-address');

test('basic', async () => {
    try {
        const delivery = await formatAddress({ domain: 'kreata.ee' });
        assert.strictEqual(delivery.isIp, false);
        assert.strictEqual(delivery.isPunycode, false);
        assert.strictEqual(delivery.decodedDomain, 'kreata.ee');
    } catch (err) {
        assert.ifError(err);
    }
});

test('unicode', async () => {
    try {
        const delivery = await formatAddress({ domain: 'jõgeva.ee' });
        assert.strictEqual(delivery.isIp, false);
        assert.strictEqual(delivery.isPunycode, true);
        assert.strictEqual(delivery.decodedDomain, 'xn--jgeva-dua.ee');
    } catch (err) {
        assert.ifError(err);
    }
});

test('ipv4', async () => {
    try {
        const delivery = await formatAddress({ domain: '127.0.0.1' });
        assert.strictEqual(delivery.isIp, true);
        assert.strictEqual(delivery.isPunycode, false);
        assert.strictEqual(delivery.decodedDomain, '127.0.0.1');
    } catch (err) {
        assert.ifError(err);
    }
});

test('ipv6', async () => {
    try {
        const delivery = await formatAddress({ domain: '2001:db8:1ff::a0b:dbd0' });
        assert.strictEqual(delivery.isIp, true);
        assert.strictEqual(delivery.isPunycode, false);
        assert.strictEqual(delivery.decodedDomain, '2001:db8:1ff::a0b:dbd0');
    } catch (err) {
        assert.ifError(err);
    }
});

test('ipv6Literal', async () => {
    try {
        const delivery = await formatAddress({ domain: '[IPv6:2001:db8:1ff::a0b:dbd0]' });
        assert.strictEqual(delivery.isIp, true);
        assert.strictEqual(delivery.isPunycode, false);
        assert.strictEqual(delivery.decodedDomain, '2001:db8:1ff::a0b:dbd0');
    } catch (err) {
        assert.ifError(err);
    }
});

test('ipv6LiteralParsedRegardlessOfIgnoreIPv6', async () => {
    // Parsing the target and deciding whether its address may be used are separate jobs.
    // Refusing here too rejected deliveries whose target was never going to be the
    // destination, such as an IPv6 target with the mx option supplying the real host, so
    // ignoreIPv6 is left to tools.isInvalid, which every address reaches.
    try {
        const delivery = await formatAddress({
            domain: '[IPv6:2001:db8:1ff::a0b:dbd0]',
            dnsOptions: {
                ignoreIPv6: true
            }
        });
        assert.strictEqual(delivery.isIp, true);
        assert.strictEqual(delivery.decodedDomain, '2001:db8:1ff::a0b:dbd0');
    } catch (err) {
        assert.ifError(err);
    }
});

test('invalidIpLiteral', async () => {
    try {
        await formatAddress({ domain: '[not-an-ip]' });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.ok(err.message.includes('properly formatted IP address'));
    }
});
