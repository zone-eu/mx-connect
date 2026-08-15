'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const resolveIp = require('../lib/resolve-ip');
const { createMockDnsResolver, createTrackingDnsResolver, createDnsError } = require('./test-utils');

test('dnsError', async () => {
    const mockResolver = createMockDnsResolver({
        'mail.fail.example.com:A': { error: createDnsError('SERVFAIL') },
        'mail.fail.example.com:AAAA': { error: createDnsError('SERVFAIL') }
    });

    await assert.rejects(
        resolveIp({
            domain: 'fail.example.com',
            mx: [{ exchange: 'mail.fail.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver }
        }),
        err => {
            assert.strictEqual(err.category, 'dns');
            assert.strictEqual(err.temporary, true);

            // The message carries the explanation and the response is derived from it. These
            // used to disagree: the response named the host and the domain while the message
            // was still the resolver's bare "SERVFAIL", so what a caller reported depended on
            // which property it happened to read.
            assert.ok(err.message.includes('mail.fail.example.com'), 'The message should name the host that failed to resolve');
            assert.ok(err.message.includes('fail.example.com'), 'The message should name the domain being delivered to');
            assert.strictEqual(err.response, `DNS Error: ${err.message}`, 'The response must be the message, not a second wording of it');
            return true;
        }
    );
});

test('partialSuccess', async () => {
    const mockResolver = createMockDnsResolver({
        'primary.example.com:A': { error: createDnsError('SERVFAIL') },
        'primary.example.com:AAAA': { error: createDnsError('SERVFAIL') },
        'backup.example.com:A': { data: ['192.0.2.1'] },
        'backup.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    const delivery = await resolveIp({
        domain: 'example.com',
        mx: [
            { exchange: 'primary.example.com', priority: 10, A: [], AAAA: [] },
            { exchange: 'backup.example.com', priority: 20, A: [], AAAA: [] }
        ],
        dnsOptions: { resolve: mockResolver }
    });
    // Primary MX failed but backup succeeded
    assert.strictEqual(delivery.mx[0].A.length, 0);
    assert.strictEqual(delivery.mx[1].A.length, 1);
    assert.strictEqual(delivery.mx[1].A[0], '192.0.2.1');
});

test('noAddressFound', async () => {
    const mockResolver = createMockDnsResolver({
        'mail.empty.example.com:A': { error: createDnsError('ENOTFOUND') },
        'mail.empty.example.com:AAAA': { error: createDnsError('ENOTFOUND') }
    });

    await assert.rejects(
        resolveIp({
            domain: 'empty.example.com',
            mx: [{ exchange: 'mail.empty.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver }
        }),
        err => {
            assert.strictEqual(err.code, 'ENOTFOUND');
            assert.strictEqual(err.category, 'dns');
            return true;
        }
    );
});

test('ipv4Only', async () => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1', '192.0.2.2'] },
        'mail.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    const delivery = await resolveIp({
        domain: 'example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver }
    });
    assert.strictEqual(delivery.mx[0].A.length, 2);
    assert.strictEqual(delivery.mx[0].A[0], '192.0.2.1');
    assert.strictEqual(delivery.mx[0].A[1], '192.0.2.2');
    assert.strictEqual(delivery.mx[0].AAAA.length, 0);
});

test('ignoreIPv6', async () => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1'] }
    });

    const delivery = await resolveIp({
        domain: 'example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver, ignoreIPv6: true }
    });
    assert.strictEqual(delivery.mx[0].A.length, 1);
    assert.strictEqual(delivery.mx[0].A[0], '192.0.2.1');
    // AAAA should not be resolved when ignoreIPv6 is true
    assert.strictEqual(delivery.mx[0].AAAA.length, 0);
});

test('customResolverCalledWithCorrectArgs', async () => {
    const calls = [];
    const customResolver = (domain, typeOrCallback, maybeCallback) => {
        const callback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback;
        const type = typeof typeOrCallback === 'string' ? typeOrCallback : 'A';
        calls.push({ domain, type });

        if (type === 'A') {
            return setImmediate(() => callback(null, ['192.0.2.1']));
        }
        if (type === 'AAAA') {
            return setImmediate(() => callback(null, ['2001:db8::1']));
        }
        const err = new Error('ENODATA');
        err.code = 'ENODATA';
        return setImmediate(() => callback(err));
    };

    const delivery = await resolveIp({
        domain: 'example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: customResolver }
    });
    // Should have called resolver for both A and AAAA
    assert.strictEqual(calls.length, 2);
    assert.ok(calls.some(c => c.domain === 'mail.example.com' && c.type === 'A'));
    assert.ok(calls.some(c => c.domain === 'mail.example.com' && c.type === 'AAAA'));
    assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.1']);
    assert.deepStrictEqual(delivery.mx[0].AAAA, ['2001:db8::1']);
});

test('dualStack', async () => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { data: ['2001:db8::1'] }
    });

    const delivery = await resolveIp({
        domain: 'example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver }
    });
    assert.strictEqual(delivery.mx[0].A.length, 1);
    assert.strictEqual(delivery.mx[0].A[0], '192.0.2.1');
    assert.strictEqual(delivery.mx[0].AAAA.length, 1);
    assert.strictEqual(delivery.mx[0].AAAA[0], '2001:db8::1');
});

test('ipExchangeSkipsDnsLookup', async () => {
    // An exchange that is already an IP address must not trigger DNS lookups
    const { resolver: customResolver, calls } = createTrackingDnsResolver({});

    const delivery = await resolveIp({
        domain: 'example.com',
        mx: [
            { exchange: '192.0.2.1', priority: 10, A: [], AAAA: [] },
            { exchange: '2001:db8::1', priority: 20, A: [], AAAA: [] }
        ],
        dnsOptions: { resolve: customResolver }
    });
    assert.strictEqual(calls.length, 0, 'No DNS lookups expected for IP address exchanges');
    assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.1']);
    assert.deepStrictEqual(delivery.mx[1].AAAA, ['2001:db8::1']);
});

test('blockedLocalAddressRejected', async () => {
    // An MX host resolving only to a blocked local address must be rejected
    const mockResolver = createMockDnsResolver({
        'mail.local.example.com:A': { data: ['127.0.0.1'] },
        'mail.local.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    await assert.rejects(
        resolveIp({
            domain: 'local.example.com',
            mx: [{ exchange: 'mail.local.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver, blockLocalAddresses: true }
        }),
        err => {
            assert.strictEqual(err.code, 'InvalidIpAddress');
            assert.strictEqual(err.category, 'dns');
            assert.ok(err.message.includes('127.0.0.1'));
            return true;
        }
    );
});

test('blockedLocalAddressFilteredWhenOthersRemain', async () => {
    // Blocked addresses are filtered out but delivery proceeds via valid hosts
    const mockResolver = createMockDnsResolver({
        'bad.example.com:A': { data: ['127.0.0.1'] },
        'bad.example.com:AAAA': { error: createDnsError('ENODATA') },
        'good.example.com:A': { data: ['192.0.2.9'] },
        'good.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    const delivery = await resolveIp({
        domain: 'mixed.example.com',
        mx: [
            { exchange: 'bad.example.com', priority: 10, A: [], AAAA: [] },
            { exchange: 'good.example.com', priority: 20, A: [], AAAA: [] }
        ],
        dnsOptions: { resolve: mockResolver, blockLocalAddresses: true }
    });
    assert.deepStrictEqual(delivery.mx[0].A, [], 'Blocked address must be filtered out');
    assert.deepStrictEqual(delivery.mx[1].A, ['192.0.2.9']);
});

test('entryWithoutExchangeIsSkipped', async () => {
    // An MX entry without an exchange must be skipped without DNS lookups and
    // without breaking resolution for the remaining entries
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    const delivery = await resolveIp({
        domain: 'example.com',
        mx: [
            { exchange: '', priority: 5, A: [], AAAA: [] },
            { exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }
        ],
        dnsOptions: { resolve: mockResolver }
    });
    assert.deepStrictEqual(delivery.mx[0].A, []);
    assert.deepStrictEqual(delivery.mx[1].A, ['192.0.2.1']);
});

test('providedAddressesValidatedWithoutLookup', async () => {
    // Addresses supplied through the mx option are the only ones no DNS lookup
    // produced. They must be used as they are, and still pass validation - this step
    // is the only place any address is checked.
    // An empty response map answers every lookup with ENOTFOUND, so any lookup at all
    // would fail this test rather than quietly succeeding
    const { resolver, calls } = createTrackingDnsResolver({});

    const delivery = {
        domain: 'provided.example.com',
        mx: [{ exchange: 'mail.provided.example.com', priority: 10, A: ['127.0.0.1'], AAAA: [] }],
        dnsOptions: { resolve: resolver, blockLocalAddresses: true }
    };

    await assert.rejects(resolveIp(delivery), err => {
        assert.strictEqual(err.code, 'InvalidIpAddress');
        assert.ok(err.message.includes('127.0.0.1'));
        return true;
    });
    assert.deepStrictEqual(calls, [], 'Caller-supplied addresses must not be looked up again');
});

test('providedAddressesKeptWhenValid', async () => {
    // A caller-supplied address that passes validation survives untouched, and an
    // entry that needs resolving in the same set is still resolved
    const mockResolver = createMockDnsResolver({
        'lookup.example.com:A': { data: ['192.0.2.20'] },
        'lookup.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    const delivery = await resolveIp({
        domain: 'mixed.example.com',
        mx: [
            { exchange: 'given.example.com', priority: 10, A: ['192.0.2.10'], AAAA: [] },
            { exchange: 'lookup.example.com', priority: 20, A: [], AAAA: [] }
        ],
        dnsOptions: { resolve: mockResolver }
    });
    assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.10'], 'The supplied address must not be replaced by a lookup');
    assert.deepStrictEqual(delivery.mx[1].A, ['192.0.2.20']);
});

test('blockedAddressesRecordedOnDelivery', async () => {
    // Filtering that leaves other addresses usable is otherwise invisible: the host
    // simply becomes unreachable later and looks like a network failure. Record what
    // policy removed so the two can be told apart.
    const mockResolver = createMockDnsResolver({
        'mail.mixed.example.com:A': { data: ['127.0.0.1', '192.0.2.9'] },
        'mail.mixed.example.com:AAAA': { data: ['64:ff9b::7f00:1'] }
    });

    const delivery = await resolveIp({
        domain: 'mixed.example.com',
        mx: [{ exchange: 'mail.mixed.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver, blockLocalAddresses: true }
    });
    assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.9'], 'Delivery continues over the address that passed');
    assert.deepStrictEqual(delivery.mx[0].AAAA, []);
    assert.deepStrictEqual(
        delivery.blockedAddresses.map(entry => entry.ip),
        ['127.0.0.1', '64:ff9b::7f00:1']
    );
    assert.strictEqual(delivery.blockedAddresses[0].exchange, 'mail.mixed.example.com');
    assert.ok(delivery.blockedAddresses[1].reason.includes('127.0.0.1'), 'A NAT64 address should be reported by the IPv4 address it carries');
});

test('resolverReturningUndefinedTreatedAsEmpty', async () => {
    // A custom resolver that calls back without a result list must be treated
    // as an empty answer, not crash
    const customResolver = createMockDnsResolver({
        'mail.undef.example.com': { data: undefined }
    });

    await assert.rejects(
        resolveIp({
            domain: 'undef.example.com',
            mx: [{ exchange: 'mail.undef.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: customResolver }
        }),
        err => {
            assert.strictEqual(err.code, 'ENOTFOUND');
            assert.strictEqual(err.category, 'dns');
            return true;
        }
    );
});

test('entryWithoutAddressArrays', async () => {
    // An MX entry need not arrive carrying A/AAAA arrays. mx-connect always supplies them,
    // but this step is driven directly too, and the lookups used to be what created them.
    const mockResolver = createMockDnsResolver({
        'mail.bare.example.com:A': { data: ['192.0.2.30'] },
        'mail.bare.example.com:AAAA': { data: ['2606:4700:4700::1111'] }
    });

    const delivery = await resolveIp({
        domain: 'bare.example.com',
        mx: [{ exchange: 'mail.bare.example.com', priority: 10 }],
        dnsOptions: { resolve: mockResolver }
    });
    assert.deepStrictEqual(delivery.mx[0].A, ['192.0.2.30']);
    assert.deepStrictEqual(delivery.mx[0].AAAA, ['2606:4700:4700::1111']);
});

test('ignoreIPv6ReportsIpv6OnlyHost', async () => {
    // ignoreIPv6 skips the AAAA lookups, so a host reachable only over IPv6 looked exactly
    // like one with no addresses at all and the delivery bounced as "nothing resolved". The
    // records are now asked for once the delivery has already failed, purely to report it
    // accurately and retryably.
    const mockResolver = createMockDnsResolver({
        'mail.v6only.example.com:A': { error: createDnsError('ENODATA') },
        'mail.v6only.example.com:AAAA': { data: ['2606:4700:4700::1111'] }
    });

    const delivery = {
        domain: 'v6only.example.com',
        mx: [{ exchange: 'mail.v6only.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver, ignoreIPv6: true }
    };

    await assert.rejects(resolveIp(delivery), err => {
        assert.strictEqual(err.code, 'InvalidIpAddress');
        assert.strictEqual(err.temporary, true, 'A local setting must hold the message rather than bounce it');
        assert.ok(err.message.includes('2606:4700:4700::1111'), 'The error should name the address that was passed over');
        assert.deepStrictEqual(
            delivery.blockedAddresses.map(entry => entry.ip),
            ['2606:4700:4700::1111'],
            'The address should be recorded so the cause is visible'
        );
        return true;
    });
});

test('ignoreIPv6HostWithNoAddressesAtAll', async () => {
    // A host with genuinely nothing published must stay a plain "nothing resolved" rather
    // than be misreported as an IPv6 problem
    const mockResolver = createMockDnsResolver({});

    await assert.rejects(
        resolveIp({
            domain: 'nothing.example.com',
            mx: [{ exchange: 'mail.nothing.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver, ignoreIPv6: true }
        }),
        err => {
            assert.strictEqual(err.code, 'ENOTFOUND');
            assert.ok(!err.temporary);
            return true;
        }
    );
});
