'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const resolveMx = require('../lib/resolve-mx');
const { createMockDnsResolver, createDnsError } = require('./test-utils');

test('dnsServfail', async () => {
    const mockResolver = createMockDnsResolver({
        'servfail.example.com:MX': { error: createDnsError('SERVFAIL') }
    });

    try {
        await resolveMx({
            domain: 'servfail.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'servfail.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.strictEqual(err.temporary, true);
    }
});

test('fallbackToA', async () => {
    const mockResolver = createMockDnsResolver({
        'noMx.example.com:MX': { error: createDnsError('ENODATA') },
        'noMx.example.com:A': { data: ['192.0.2.1'] }
    });

    try {
        const delivery = await resolveMx({
            domain: 'noMx.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'noMx.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(delivery.mx.length === 1);
        assert.strictEqual(delivery.mx[0].exchange, 'noMx.example.com');
        assert.strictEqual(delivery.mx[0].mx, false);
        assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.1']);
    } catch (err) {
        assert.ifError(err);
    }
});

test('blockedLocalAddress', async () => {
    const mockResolver = createMockDnsResolver({
        'local.example.com:MX': { error: createDnsError('ENODATA') },
        'local.example.com:A': { data: ['127.0.0.1'] }
    });

    try {
        await resolveMx({
            domain: 'local.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'local.example.com',
            dnsOptions: {
                resolve: mockResolver,
                blockLocalAddresses: true
            }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.ok(err.message.includes('127.0.0.1'));
    }
});

test('nullMxRejected', async () => {
    const mockResolver = createMockDnsResolver({
        'nomail.example.com:MX': { data: [{ exchange: '.', priority: 0 }] }
    });

    try {
        await resolveMx({
            domain: 'nomail.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'nomail.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(false, 'Should have rejected null MX');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.strictEqual(err.code, 'ENULLMX');
        // Null MX is a permanent refusal - must not be marked temporary
        assert.ok(!err.temporary);
    }
});

test('nullMxEmptyExchangeRejected', async () => {
    // Some resolvers surface the root exchange as an empty string rather than "."
    const mockResolver = createMockDnsResolver({
        'nomail2.example.com:MX': { data: [{ exchange: '', priority: 0 }] }
    });

    try {
        await resolveMx({
            domain: 'nomail2.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'nomail2.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(false, 'Should have rejected null MX');
    } catch (err) {
        assert.strictEqual(err.code, 'ENULLMX');
    }
});

test('nullMxDoesNotFallBackToA', async () => {
    // Even if an A record exists, a null MX must prevent delivery (no A/AAAA fallback)
    const mockResolver = createMockDnsResolver({
        'nomail3.example.com:MX': { data: [{ exchange: '.', priority: 0 }] },
        'nomail3.example.com:A': { data: ['192.0.2.1'] }
    });

    try {
        await resolveMx({
            domain: 'nomail3.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'nomail3.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(false, 'Should have rejected null MX without falling back to A');
    } catch (err) {
        assert.strictEqual(err.code, 'ENULLMX');
    }
});

test('nullMxAlongsideRealMxIsIgnored', async () => {
    // RFC 7505 Section 4.1 forbids mixing a null MX with real ones, so this is a
    // misconfiguration, not a refusal. Deliver via the usable records rather than bounce.
    const mockResolver = createMockDnsResolver({
        'mixed.example.com:MX': {
            data: [
                { exchange: '.', priority: 0 },
                { exchange: 'mail.example.com', priority: 10 }
            ]
        }
    });

    try {
        const delivery = await resolveMx({
            domain: 'mixed.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'mixed.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.strictEqual(delivery.mx.length, 1);
        assert.strictEqual(delivery.mx[0].exchange, 'mail.example.com');
    } catch (err) {
        assert.ok(false, `Should not have rejected a misconfigured MX set: ${err.message}`);
    }
});

test('emptyExchangeAlongsideRealMxIsIgnored', async () => {
    // A single malformed entry (empty exchange from a custom resolver) must not take down
    // an otherwise valid MX set
    const mockResolver = createMockDnsResolver({
        'malformed.example.com:MX': {
            data: [
                { exchange: '', priority: 5 },
                { exchange: 'mail.example.com', priority: 10 }
            ]
        }
    });

    try {
        const delivery = await resolveMx({
            domain: 'malformed.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'malformed.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.strictEqual(delivery.mx.length, 1);
        assert.strictEqual(delivery.mx[0].exchange, 'mail.example.com');
    } catch (err) {
        assert.ok(false, `Should not have rejected a malformed MX set: ${err.message}`);
    }
});

test('allNullMxRejected', async () => {
    // Multiple null MX entries are still an authoritative "no mail here"
    const mockResolver = createMockDnsResolver({
        'nomail4.example.com:MX': {
            data: [
                { exchange: '.', priority: 0 },
                { exchange: '', priority: 0 }
            ]
        }
    });

    try {
        await resolveMx({
            domain: 'nomail4.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'nomail4.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(false, 'Should have rejected null MX');
    } catch (err) {
        assert.strictEqual(err.code, 'ENULLMX');
    }
});

test('mxRecordsSorted', async () => {
    const mockResolver = createMockDnsResolver({
        'multi.example.com:MX': {
            data: [
                { exchange: 'backup.example.com', priority: 20 },
                { exchange: 'primary.example.com', priority: 10 },
                { exchange: 'tertiary.example.com', priority: 30 }
            ]
        }
    });

    try {
        const delivery = await resolveMx({
            domain: 'multi.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'multi.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.strictEqual(delivery.mx.length, 3);
        assert.strictEqual(delivery.mx[0].exchange, 'primary.example.com');
        assert.strictEqual(delivery.mx[0].priority, 10);
        assert.strictEqual(delivery.mx[1].exchange, 'backup.example.com');
        assert.strictEqual(delivery.mx[1].priority, 20);
        assert.strictEqual(delivery.mx[2].exchange, 'tertiary.example.com');
        assert.strictEqual(delivery.mx[2].priority, 30);
    } catch (err) {
        assert.ifError(err);
    }
});

test('ipLiteral', async () => {
    try {
        const delivery = await resolveMx({
            domain: '192.0.2.1',
            isIp: true,
            isPunycode: false,
            decodedDomain: '192.0.2.1'
        });
        assert.strictEqual(delivery.mx.length, 1);
        assert.strictEqual(delivery.mx[0].exchange, '192.0.2.1');
        assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.1']);
    } catch (err) {
        assert.ifError(err);
    }
});

test('fallbackToAAAA', async () => {
    const mockResolver = createMockDnsResolver({
        'noMxNoA.example.com:MX': { error: createDnsError('ENODATA') },
        'noMxNoA.example.com:A': { error: createDnsError('ENODATA') },
        'noMxNoA.example.com:AAAA': { data: ['2001:db8::1'] }
    });

    try {
        const delivery = await resolveMx({
            domain: 'noMxNoA.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'noMxNoA.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(delivery.mx.length === 1);
        assert.strictEqual(delivery.mx[0].exchange, 'noMxNoA.example.com');
        assert.strictEqual(delivery.mx[0].mx, false);
        assert.deepStrictEqual(delivery.mx[0].AAAA, ['2001:db8::1']);
    } catch (err) {
        assert.ifError(err);
    }
});

test('customResolverCalledWithCorrectArgs', async () => {
    const calls = [];
    const customResolver = (domain, typeOrCallback, maybeCallback) => {
        const callback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback;
        const type = typeof typeOrCallback === 'string' ? typeOrCallback : 'A';
        calls.push({ domain, type });

        if (type === 'MX') {
            return setImmediate(() => callback(null, [{ exchange: 'mail.example.com', priority: 10 }]));
        }
        const err = new Error('ENODATA');
        err.code = 'ENODATA';
        return setImmediate(() => callback(err));
    };

    try {
        const delivery = await resolveMx({
            domain: 'test.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'test.example.com',
            dnsOptions: { resolve: customResolver }
        });
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].domain, 'test.example.com');
        assert.strictEqual(calls[0].type, 'MX');
        assert.strictEqual(delivery.mx[0].exchange, 'mail.example.com');
    } catch (err) {
        assert.ifError(err);
    }
});

test('ipTargetBlockedLocalAddress', async () => {
    // An IP target in a blocked range must be rejected before any connection
    const delivery = {
        domain: '127.0.0.1',
        isIp: true,
        isPunycode: false,
        decodedDomain: '127.0.0.1',
        dnsOptions: { blockLocalAddresses: true }
    };

    try {
        await resolveMx(delivery);
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.ok(err.message.includes('127.0.0.1'));
        // Callers need to tell this apart from a resolution failure, and the address
        // was given to us rather than resolved, so the error must not blame an MX lookup
        assert.strictEqual(err.code, 'InvalidIpAddress');
        assert.ok(err.message.includes('given as the delivery target'));
        assert.ok(!err.message.includes('resolved for the Mail Exchange'), 'A literal target must not be reported as an MX lookup result');
        assert.deepStrictEqual(
            delivery.blockedAddresses.map(entry => entry.ip),
            ['127.0.0.1']
        );
    }
});

test('aaaaFallbackBlockedLocalAddress', async () => {
    // AAAA fallback addresses go through the same local-address filtering
    const mockResolver = createMockDnsResolver({
        'v6local.example.com:MX': { error: createDnsError('ENODATA') },
        'v6local.example.com:A': { error: createDnsError('ENODATA') },
        'v6local.example.com:AAAA': { data: ['fe80::1'] }
    });

    try {
        await resolveMx({
            domain: 'v6local.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'v6local.example.com',
            dnsOptions: { resolve: mockResolver, blockLocalAddresses: true }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.ok(err.message.includes('fe80::1'));
    }
});

test('aaaaFallbackServfail', async () => {
    // A SERVFAIL on the AAAA fallback must be a temporary DNS error, not
    // masked as "no records"
    const mockResolver = createMockDnsResolver({
        'v6fail.example.com:MX': { error: createDnsError('ENODATA') },
        'v6fail.example.com:A': { error: createDnsError('ENODATA') },
        'v6fail.example.com:AAAA': { error: createDnsError('SERVFAIL') }
    });

    try {
        await resolveMx({
            domain: 'v6fail.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'v6fail.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.strictEqual(err.temporary, true);
    }
});

test('ignoreIPv6ReportsIpv6OnlyDomain', async () => {
    // A domain with neither MX nor A records, reachable only over IPv6, used to be
    // indistinguishable under ignoreIPv6 from one with no mail service at all, because the
    // AAAA fallback was skipped: it bounced as "no MX server found" for what is really a
    // local setting. The lookup now happens and the address is refused instead, which is
    // both accurate and retryable.
    const mockResolver = createMockDnsResolver({
        'v6only.example.com:MX': { error: createDnsError('ENODATA') },
        'v6only.example.com:A': { error: createDnsError('ENODATA') },
        'v6only.example.com:AAAA': { data: ['2606:4700:4700::1111'] }
    });

    const delivery = {
        domain: 'v6only.example.com',
        isIp: false,
        isPunycode: false,
        decodedDomain: 'v6only.example.com',
        dnsOptions: { resolve: mockResolver, ignoreIPv6: true }
    };

    try {
        await resolveMx(delivery);
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.strictEqual(err.code, 'InvalidIpAddress');
        assert.strictEqual(err.temporary, true, 'A local setting must hold the message rather than bounce it');
        assert.ok(err.message.includes('2606:4700:4700::1111'), 'The error should name the address that was refused');
        assert.deepStrictEqual(
            delivery.blockedAddresses.map(entry => entry.ip),
            ['2606:4700:4700::1111'],
            'The refused address should be recorded'
        );
    }
});

test('ignoreIPv6DomainWithNoRecordsAtAll', async () => {
    // A domain with genuinely nothing published must still be a plain "no MX server found",
    // not be misreported as an IPv6 problem
    const mockResolver = createMockDnsResolver({});

    try {
        await resolveMx({
            domain: 'nothing.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'nothing.example.com',
            dnsOptions: { resolve: mockResolver, ignoreIPv6: true }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.strictEqual(err.code, 'ENOTFOUND');
        assert.ok(!err.temporary);
    }
});

test('nullEntriesInMxResponseIgnored', async () => {
    // Falsy entries from a broken custom resolver must be dropped, not crash
    // the priority sort
    const mockResolver = createMockDnsResolver({
        'nullentry.example.com:MX': {
            data: [null, { exchange: 'mail.example.com', priority: 10 }]
        }
    });

    try {
        const delivery = await resolveMx({
            domain: 'nullentry.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'nullentry.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.strictEqual(delivery.mx.length, 1);
        assert.strictEqual(delivery.mx[0].exchange, 'mail.example.com');
    } catch (err) {
        assert.ifError(err);
    }
});

test('allFalsyMxResponseFallsBackToA', async () => {
    // An MX answer containing only falsy garbage is treated like no answer at
    // all and falls back to A records
    const mockResolver = createMockDnsResolver({
        'garbage.example.com:MX': { data: [null] },
        'garbage.example.com:A': { data: ['192.0.2.7'] }
    });

    try {
        const delivery = await resolveMx({
            domain: 'garbage.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'garbage.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.strictEqual(delivery.mx.length, 1);
        assert.strictEqual(delivery.mx[0].mx, false);
        assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.7']);
    } catch (err) {
        assert.ifError(err);
    }
});

test('aFallbackServfail', async () => {
    // A SERVFAIL on the A fallback must be a temporary DNS error, not masked
    // as "no records"
    const mockResolver = createMockDnsResolver({
        'afail.example.com:MX': { error: createDnsError('ENODATA') },
        'afail.example.com:A': { error: createDnsError('SERVFAIL') }
    });

    try {
        await resolveMx({
            domain: 'afail.example.com',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'afail.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.strictEqual(err.temporary, true);
    }
});

test('aFallbackKeepsOneEntryAndRecordsBlockedOnce', async () => {
    // RFC 5321 Section 5.1: the domain is one implicit mail exchanger, so all its addresses
    // belong to a single entry. Splitting them left a rejected address behind as an empty
    // entry, which resolveIP then resolved again and rejected a second time.
    const mockResolver = createMockDnsResolver({
        'nomx.example.com:MX': { error: createDnsError('ENODATA') },
        'nomx.example.com:A': { data: ['127.0.0.1', '192.0.2.9'] }
    });

    const delivery = {
        domain: 'nomx.example.com',
        isIp: false,
        isPunycode: false,
        decodedDomain: 'nomx.example.com',
        dnsOptions: { resolve: mockResolver, blockLocalAddresses: true }
    };

    try {
        await resolveMx(delivery);
        assert.strictEqual(delivery.mx.length, 1, 'the implicit MX must be a single entry');
        assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.9']);
        assert.deepStrictEqual(
            delivery.blockedAddresses.map(entry => entry.ip),
            ['127.0.0.1'],
            'the rejected address must be recorded exactly once'
        );
    } catch (err) {
        assert.ifError(err);
    }
});
