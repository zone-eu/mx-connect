/* eslint no-console: 0*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const tools = require('../lib/tools');
const { createTrackingDnsResolver, createDnsError } = require('./test-utils');

test('getDnsResolverWithCustomResolver', async () => {
    const { resolver: customResolver, calls } = createTrackingDnsResolver({
        'example.com': { data: ['192.0.2.1'] },
        'example2.com': { data: ['192.0.2.1'] }
    });

    const resolver = tools.getDnsResolver({ resolve: customResolver });

    // Test with type argument
    let result = await resolver('example.com', 'MX');
    assert.deepStrictEqual(result, ['192.0.2.1']);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].domain, 'example.com');
    assert.strictEqual(calls[0].type, 'MX');

    // Test without type argument (should resolve A records)
    result = await resolver('example2.com');
    assert.deepStrictEqual(result, ['192.0.2.1']);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].domain, 'example2.com');
    assert.strictEqual(calls[1].type, 'A');
});

test('getDnsResolverWithCustomResolverError', async () => {
    const { resolver: customResolver } = createTrackingDnsResolver({
        'fail.example.com': { error: createDnsError('SERVFAIL') }
    });

    const resolver = tools.getDnsResolver({ resolve: customResolver });

    await assert.rejects(resolver('fail.example.com', 'MX'), err => {
        assert.strictEqual(err.code, 'SERVFAIL');
        return true;
    });
});

test('getDnsResolverWithoutCustomResolver', async () => {
    // When no custom resolver provided, should use native dns.promises
    const resolver = tools.getDnsResolver();

    // Just verify it returns a function
    assert.strictEqual(typeof resolver, 'function');
});

test('isNotFoundError', async () => {
    assert.strictEqual(tools.isNotFoundError({ code: 'ENODATA' }), true);
    assert.strictEqual(tools.isNotFoundError({ code: 'ENOTFOUND' }), true);
    assert.strictEqual(tools.isNotFoundError({ code: 'SERVFAIL' }), false);
    assert.ok(!tools.isNotFoundError(null), 'null should be falsy');
    assert.ok(!tools.isNotFoundError(undefined), 'undefined should be falsy');
});

test('isInvalid', async () => {
    assert.strictEqual(
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '127.0.0.1'
        ),
        false
    );

    assert.strictEqual(
        tools.isInvalid(
            {
                dnsOptions: {
                    blockLocalAddresses: true
                }
            },
            '64.233.161.27'
        ),
        false
    );

    assert.ok(
        // IP address in disallowed loopback range
        tools.isInvalid(
            {
                dnsOptions: {
                    blockLocalAddresses: true
                }
            },
            '127.0.0.1'
        )
    );

    assert.ok(
        // IP address in disallowed unspecified range
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '0.0.0.0'
        )
    );

    assert.ok(
        // IP address in disallowed broadcast range
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '255.255.255.255'
        )
    );

    // multicast is never a valid unicast destination - blocked regardless of options
    assert.ok(tools.isInvalid({ dnsOptions: {} }, '224.0.0.1'));
    assert.ok(tools.isInvalid({ dnsOptions: {} }, 'ff02::1'));

    // reserved is blocked only when blockReservedNetworks=true: future-use, the RFC 5737 /
    // RFC 3849 documentation ranges and IPv4 benchmarking. These assertions are also what
    // pins the ipaddr.js range names the policy is written in, so a dependency bump that
    // renames or reorders a range fails here rather than quietly allowing the address.
    for (const ip of ['240.0.0.1', '192.0.2.1', '198.18.0.1', '2001:db8::1']) {
        assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, ip), false, `${ip} should be allowed by default`);
        assert.ok(tools.isInvalid({ dnsOptions: { blockReservedNetworks: true } }, ip), `${ip} should be blocked with blockReservedNetworks`);
    }

    // link-local, CGNAT, IPv6 unique-local and deprecated site-local are local-scope:
    // only blocked when blockLocalAddresses=true
    for (const ip of ['169.254.1.1', '100.64.0.1', 'fe80::1', 'fc00::1', 'fec0::1']) {
        assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, ip), false, `${ip} should be allowed by default`);
        assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip), `${ip} should be blocked with blockLocalAddresses`);
    }

    // never a mail host, whatever the options: RFC 6666 discard and RFC 9602 segment routing
    for (const ip of ['100::1', '5f00::1']) {
        assert.ok(tools.isInvalid({ dnsOptions: {} }, ip), `${ip} should always be blocked`);
    }

    // IPv6 benchmarking and AMT follow blockReservedNetworks, like the IPv4 ranges do
    for (const ip of ['2001:2::1', '2001:3::1']) {
        assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, ip), false, `${ip} should be allowed by default`);
        assert.ok(tools.isInvalid({ dnsOptions: { blockReservedNetworks: true } }, ip), `${ip} should be blocked with blockReservedNetworks`);
    }

    // IPv6 loopback is blocked with blockLocalAddresses, allowed without
    assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, '::1'), false);
    assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '::1'));

    // public unicast addresses remain valid in both modes
    assert.strictEqual(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '2606:4700:4700::1111'), false);

    // IPv4-mapped IPv6 addresses connect to the embedded IPv4 host, so they must be judged as
    // that IPv4 address rather than slipping through on their own "ipv4Mapped" range
    for (const ip of ['::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:100.64.0.1']) {
        assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip), `${ip} should be blocked with blockLocalAddresses`);
    }

    // mapped forms of the always-invalid ranges are blocked with no options set
    assert.ok(tools.isInvalid({ dnsOptions: {} }, '::ffff:0.0.0.0'));
    assert.ok(tools.isInvalid({ dnsOptions: {} }, '::ffff:255.255.255.255'));
    assert.ok(tools.isInvalid({ dnsOptions: {} }, '::ffff:224.0.0.1'));

    // mapped documentation ranges follow blockReservedNetworks like their bare IPv4 form
    assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, '::ffff:192.0.2.1'), false);
    assert.ok(tools.isInvalid({ dnsOptions: { blockReservedNetworks: true } }, '::ffff:192.0.2.1'));

    // a mapped public address is still deliverable - unwrapping must not over-block
    assert.strictEqual(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '::ffff:8.8.8.8'), false);

    // alternate notations of the same mapped address are handled identically
    assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '::FFFF:127.0.0.1'));
    assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '0:0:0:0:0:ffff:7f00:1'));
});

test('isInvalidEmbeddedIPv4', async () => {
    // IPv6 transition mechanisms carry an IPv4 address that the connection actually
    // reaches (via NAT64/CLAT, 6to4 relay or Teredo tunnel), so each is judged as the
    // IPv4 address it carries rather than on its own IPv6 range. Every address below
    // carries 127.0.0.1: NAT64 well-known prefix, RFC 6145 translated, 6to4, Teredo
    // (client address, stored with every bit flipped), Teredo (server address) and both
    // spellings of the deprecated IPv4-compatible form.
    const loopbackCarriers = [
        '64:ff9b::7f00:1',
        '::ffff:0:7f00:1',
        '2002:7f00:1::',
        '2001:0:4136:e378:8000:63bf:80ff:fffe',
        '2001:0:7f00:1:8000:63bf:f7f7:f7f7',
        '::7f00:1',
        '::127.0.0.1'
    ];
    for (const ip of loopbackCarriers) {
        assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, ip), false, `${ip} should be allowed by default`);
        const result = tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip);
        assert.ok(result, `${ip} carries 127.0.0.1 and should be blocked with blockLocalAddresses`);
        assert.ok(result.includes('127.0.0.1'), `${ip} should name the carried IPv4 address in the error`);
    }

    // The same mechanisms carrying a public IPv4 address stay deliverable. This matters
    // most for the NAT64 well-known prefix: on an IPv6-only network DNS64 synthesizes
    // exactly these records for every IPv4-only mail host, so blocking the prefix
    // wholesale would break delivery to those domains entirely.
    const publicCarriers = ['64:ff9b::8.8.8.8', '::ffff:0:8.8.8.8', '2002:808:808::', '2001:0:4136:e378:8000:63bf:f7f7:f7f7', '::8.8.8.8'];
    for (const ip of publicCarriers) {
        assert.strictEqual(
            tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip),
            false,
            `${ip} carries a public address and should be deliverable`
        );
    }

    // Addresses that can never be a mail host are rejected whatever the options, and a
    // transition envelope must not be a way around that
    assert.ok(tools.isInvalid({ dnsOptions: {} }, '64:ff9b::ffff:ffff'), 'NAT64 carrying the broadcast address should always be blocked');
    assert.ok(tools.isInvalid({ dnsOptions: {} }, '64:ff9b::'), 'NAT64 carrying the unspecified address should always be blocked');
    assert.ok(tools.isInvalid({ dnsOptions: {} }, '2002:e000:1::'), '6to4 carrying a multicast address should always be blocked');

    // RFC 8215 reserves 64:ff9b:1::/48 for locally chosen NAT64 prefixes. The embedded
    // address offset depends on that local prefix length, so it cannot be read from the
    // address and the whole prefix stays a blanket block under blockLocalAddresses.
    assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, '64:ff9b:1::7f00:1'), false);
    const localUse = tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '64:ff9b:1::7f00:1');
    assert.ok(localUse);
    assert.ok(localUse.includes('64:ff9b:1::/48'), 'the local-use NAT64 rejection should name the prefix');
});

test('isInvalidRejectsNonCanonicalNotations', async () => {
    // Only a canonical literal can be validated safely. ipaddr.js reads a leading zero as
    // octal while the platform resolver reads it as decimal, so 0127.0.0.1 looks like the
    // public 87.0.0.1 to the check and resolves to 127.0.0.1 for the connection. Anything
    // net.isIP does not recognise is also a string net.connect would hand to dns.lookup,
    // so the address checked would not be the address reached.
    const bypassAttempts = [
        '0127.0.0.1', // octal to ipaddr (87.0.0.1), decimal to getaddrinfo (127.0.0.1)
        '00127.0.0.1',
        '010.000.000.001', // reaches 10.0.0.1
        '0172.16.0.1', // reaches 172.16.0.1
        '172.016.000.001',
        '0169.254.169.254', // reaches the cloud metadata address
        '2130706433', // decimal form of 127.0.0.1
        '0x7f000001',
        '127.1',
        '127.0.0.1.', // trailing dot
        ' 127.0.0.1',
        '127.0.0.1 ',
        '[127.0.0.1]',
        '127.0.0.1:25'
    ];

    for (const ip of bypassAttempts) {
        // Refused whatever the options, since the address cannot be judged at all
        assert.ok(tools.isInvalid({ dnsOptions: {} }, ip), `${ip} should be refused by default`);
        assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip), `${ip} should be refused with blockLocalAddresses`);
    }

    // Canonical spellings that net.isIP does recognise must still be accepted, including
    // zone identifiers and the alternate IPv6 notations
    for (const ip of ['8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8', '0:0:0:0:0:ffff:808:808']) {
        assert.strictEqual(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip), false, `${ip} should still be accepted`);
    }
    assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, 'fe80::1%eth0'), 'a zone identifier must be parsed, not waved through');
});

test('getDnsResolverExplicitATypeUsesLegacyForm', async () => {
    // An explicit 'A' type must be equivalent to an omitted type and use the
    // two-argument custom resolver form
    const arities = [];
    const customResolver = (...args) => {
        arities.push(args.length);
        const callback = args[args.length - 1];
        setImmediate(() => callback(null, ['192.0.2.1']));
    };

    const resolver = tools.getDnsResolver({ resolve: customResolver });

    const aRecords = await resolver('example.com', 'A');
    const mxRecords = await resolver('example.com', 'MX');
    assert.deepStrictEqual(aRecords, ['192.0.2.1']);
    assert.deepStrictEqual(mxRecords, ['192.0.2.1']);
    assert.deepStrictEqual(arities, [2, 3], "Explicit 'A' must use the two-argument resolver form");
});

test('isInvalidUnparseableAddress', async () => {
    // Garbage input must be reported invalid, not throw
    const result = tools.isInvalid({ dnsOptions: {} }, 'not-an-ip');
    assert.ok(result);
    assert.ok(result.includes('not in a recognised notation'));
});

test('isInvalidLocalInterfaceAddress', async () => {
    // 0.0.0.0 is collected as a local interface address; with
    // blockLocalAddresses it must be reported as such (the interface check
    // runs before the always-invalid range check)
    const result = tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '0.0.0.0');
    assert.ok(result);
    assert.ok(result.includes('local interface'));
});

test('isInvalidIgnoreIPv6', async () => {
    // ignoreIPv6 is about which addresses may be used, not only which lookups are worth
    // making, so it has to be decided here as well. Skipping AAAA queries alone leaves an
    // address handed over through the mx option unfiltered, since no lookup produced it.
    for (const ip of ['2606:4700:4700::1111', '::1', 'fe80::1', '64:ff9b::8.8.8.8', '::ffff:8.8.8.8']) {
        assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, ip), false, `${ip} should be allowed without ignoreIPv6`);
        const result = tools.isInvalid({ dnsOptions: { ignoreIPv6: true } }, ip);
        assert.ok(result, `${ip} should be refused with ignoreIPv6`);
        assert.ok(result.includes('ignoreIPv6'), `${ip} should be refused by name so the cause is obvious`);
    }

    // IPv4 is unaffected
    for (const ip of ['8.8.8.8', '192.0.2.1']) {
        assert.strictEqual(tools.isInvalid({ dnsOptions: { ignoreIPv6: true } }, ip), false, `${ip} should be unaffected by ignoreIPv6`);
    }
});

test('isInvalidLocalNat64Prefixes', async () => {
    // RFC 6052 also allows a NAT64 prefix taken from a network's own address space, which
    // nothing in the address marks as one. Only the operator knows, so they can declare it
    // and have the carried address checked like any other.
    //
    // The addresses below are written out rather than generated. Building them with the same
    // loop the implementation uses would move a wrong offset into the expected value too,
    // and the test would pass either way. Each one follows the worked example in RFC 6052
    // section 2.4, which embeds 192.0.2.33 as 2001:db8:122:344::192.0.2.33 at /96 and as
    // 2001:db8:122:344:c0:2:2100:: at /64, rebased onto a public prefix and carrying
    // 127.0.0.1 (0x7f 0x00 0x00 0x01) so that blockLocalAddresses is what refuses it.
    const vectors = [
        { cidr: '2a01:4f8::/32', loopback: '2a01:4f8:7f00:1::', publicHost: '2a01:4f8:808:808::' },
        { cidr: '2a01:4f8:c1::/40', loopback: '2a01:4f8:7f:0:1::', publicHost: '2a01:4f8:8:808:8::' },
        { cidr: '2a01:4f8:c17::/48', loopback: '2a01:4f8:c17:7f00:0:100::', publicHost: '2a01:4f8:c17:808:8:800::' },
        { cidr: '2a01:4f8:c17:b8f::/56', loopback: '2a01:4f8:c17:b7f:0:1::', publicHost: '2a01:4f8:c17:b08:8:808::' },
        { cidr: '2a01:4f8:c17:b8f::/64', loopback: '2a01:4f8:c17:b8f:7f:0:100:0', publicHost: '2a01:4f8:c17:b8f:8:808:800:0' },
        { cidr: '2a01:4f8:c17:b8f::/96', loopback: '2a01:4f8:c17:b8f::7f00:1', publicHost: '2a01:4f8:c17:b8f::808:808' }
    ];

    for (const { cidr, loopback, publicHost } of vectors) {
        const options = { blockLocalAddresses: true, nat64Prefixes: [cidr] };

        const result = tools.isInvalid({ dnsOptions: options }, loopback);
        assert.ok(result, `${cidr} carrying 127.0.0.1 should be refused`);
        assert.ok(result.includes('127.0.0.1'), `${cidr} should name the carried address`);

        // Undeclared, the same address is indistinguishable from an ordinary IPv6 host
        assert.strictEqual(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, loopback), false, `${cidr} cannot be detected unless declared`);

        // A public address behind the same prefix stays deliverable
        assert.strictEqual(tools.isInvalid({ dnsOptions: options }, publicHost), false, `${cidr} carrying a public address should be deliverable`);
    }

    // Addresses outside the declared prefix are untouched
    assert.strictEqual(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true, nat64Prefixes: ['2a01:4f8::/96'] } }, '2606:4700:4700::1111'), false);

    // A prefix that cannot be parsed must be ignored rather than throw on every address
    assert.strictEqual(tools.isInvalid({ dnsOptions: { nat64Prefixes: ['not-a-cidr', '198.51.100.0/24'] } }, '8.8.8.8'), false);
});

test('isInvalidLocalNat64PrefixesCannotWeakenChecks', async () => {
    // A declared prefix must not become a way to stop the address being judged as itself.
    // Unlike the well-known prefix, a locally run one sits in the network's own range, so
    // the outer address is meaningful: replacing it with the address it carries let a
    // unique-local host through, because the recovered IPv4 fell in a range that
    // blockLocalAddresses does not cover.
    for (const [ip, prefix] of [
        ['fc00::1', '::/0'],
        ['fc00::1', 'fc00::/32'],
        ['fe80::1', 'fe80::/32'],
        ['fec0::1', 'fec0::/32'],
        ['::1', '::/0']
    ]) {
        assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip), `${ip} should be refused without any prefix declared`);
        assert.ok(
            tools.isInvalid({ dnsOptions: { blockLocalAddresses: true, nat64Prefixes: [prefix] } }, ip),
            `${ip} must stay refused when ${prefix} is declared`
        );
    }

    // A prefix length RFC 6052 does not define has no embedding to read, so it is ignored
    // rather than producing a wrong address or throwing out of the one check every address
    // depends on. /33 used to throw from inside ipaddr.js.
    for (const prefix of ['2a01:4f8::/97', '2a01:4f8::/33', '2a01:4f8::/128', '2a01:4f8::/0', '10.0.0.0/8', 'not-a-cidr']) {
        const options = { dnsOptions: { blockLocalAddresses: true, nat64Prefixes: [prefix] } };
        assert.strictEqual(tools.isInvalid(options, '2a01:4f8:c17:b8f::7f00:1'), false, `${prefix} should be ignored, not throw`);
        assert.ok(tools.isInvalid(options, '127.0.0.1'), `${prefix} must not disturb ordinary validation`);
    }
});

test('isInvalidLocalNat64PrefixesUnderRfc8215', async () => {
    // RFC 8215 set 64:ff9b:1::/48 aside for exactly the locally chosen prefixes this option
    // describes, so refusing the whole range even after the operator has declared one would
    // contradict the advice to declare it. Undeclared it stays a blanket refusal, because
    // what is missing there is knowing where in the address the IPv4 sits.
    const declared = { blockLocalAddresses: true, nat64Prefixes: ['64:ff9b:1:abcd::/96'] };

    assert.ok(tools.isInvalid({ dnsOptions: declared }, '64:ff9b:1:abcd::7f00:1'), 'a declared prefix carrying loopback is still refused');
    assert.strictEqual(tools.isInvalid({ dnsOptions: declared }, '64:ff9b:1:abcd::808:808'), false, 'a declared prefix carrying a public host should deliver');
    assert.ok(tools.isInvalid({ dnsOptions: declared }, '64:ff9b:1:9999::808:808'), 'a different prefix in the range stays blanket refused');

    for (const ip of ['64:ff9b:1::7f00:1', '64:ff9b:1:abcd::808:808']) {
        assert.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip), `${ip} should be refused when nothing is declared`);
        assert.strictEqual(tools.isInvalid({ dnsOptions: {} }, ip), false, `${ip} should be unaffected without blockLocalAddresses`);
    }
});

test('isInvalidNat64PrefixesNotAnArray', async () => {
    // isInvalid is the one check every address depends on, so a configuration mistake must
    // not throw its way out of it. An array-like used to reach the loop and fail there.
    for (const value of [{ length: 3 }, 'a-string', 42, null, {}, new Set(['64:ff9b:1::/96'])]) {
        const options = { dnsOptions: { blockLocalAddresses: true, nat64Prefixes: value } };
        assert.strictEqual(tools.isInvalid(options, '2606:4700:4700::1111'), false, 'a public address should still be judged normally');
        assert.ok(tools.isInvalid(options, '127.0.0.1'), 'ordinary validation must be undisturbed');
    }
});

test('getDnsResolverResolveRecordsReturningPromise', async () => {
    // The newer option returns the records rather than taking a callback
    const calls = [];
    const resolver = tools.getDnsResolver({
        async resolveRecords(domain, type) {
            calls.push({ domain, type });
            return ['192.0.2.1'];
        }
    });

    assert.deepStrictEqual(await resolver('example.com', 'MX'), ['192.0.2.1']);
    assert.deepStrictEqual(calls, [{ domain: 'example.com', type: 'MX' }]);
});

test('getDnsResolverResolveRecordsMayBeSynchronous', async () => {
    // Returning the records directly is allowed, so a resolver backed by a cache does not
    // have to pretend to be asynchronous
    const resolver = tools.getDnsResolver({
        resolveRecords: () => ['192.0.2.2']
    });

    assert.deepStrictEqual(await resolver('example.com', 'A'), ['192.0.2.2']);
});

test('getDnsResolverResolveRecordsAlwaysReceivesAType', async () => {
    // The callback form omits the type for A lookups, which is the wart this option exists
    // to leave behind, so an A lookup arrives here named like every other
    const types = [];
    const resolver = tools.getDnsResolver({
        resolveRecords: (domain, type) => {
            types.push(type);
            return [];
        }
    });

    await resolver('example.com');
    await resolver('example.com', 'A');
    await resolver('example.com', 'AAAA');

    assert.deepStrictEqual(types, ['A', 'A', 'AAAA'], 'An omitted type must reach the resolver as A');
});

test('getDnsResolverResolveRecordsErrorsReject', async () => {
    // Both a rejected promise and a synchronous throw have to surface as a rejection, or
    // the resolution step cannot tell a failed lookup from an empty answer
    const rejecting = tools.getDnsResolver({
        async resolveRecords() {
            throw createDnsError('SERVFAIL');
        }
    });
    await assert.rejects(() => rejecting('example.com', 'MX'), { code: 'SERVFAIL' });

    const throwing = tools.getDnsResolver({
        resolveRecords() {
            throw createDnsError('SERVFAIL');
        }
    });
    await assert.rejects(() => throwing('example.com', 'MX'), { code: 'SERVFAIL' }, 'A synchronous throw must reject too');
});

test('getDnsResolverPrefersResolveRecordsOverResolve', async () => {
    // Both may be set while a caller migrates. The newer one wins, and the callback is
    // left alone rather than being called as well.
    let callbackUsed = false;
    const resolver = tools.getDnsResolver({
        resolveRecords: () => ['from-async'],
        resolve: (domain, typeOrCallback, maybeCallback) => {
            callbackUsed = true;
            const callback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback;
            return setImmediate(() => callback(null, ['from-callback']));
        }
    });

    assert.deepStrictEqual(await resolver('example.com', 'MX'), ['from-async']);
    assert.strictEqual(callbackUsed, false, 'The callback resolver must not be consulted as well');
});

test('getDnsResolverRejectsUncallableResolvers', async () => {
    // Quietly falling back to the system resolver because an option was mistyped would send
    // mail through a resolver the operator did not choose, losing whatever theirs was there
    // for, and nothing would say so. Both options are checked, so the mistake surfaces
    // whichever one carries it.
    for (const bad of ['nope', 42, {}, [], true]) {
        assert.throws(
            () => tools.getDnsResolver({ resolveRecords: bad }),
            { name: 'TypeError', message: /resolveRecords must be a function/ },
            `resolveRecords of type ${typeof bad} must be refused`
        );
        assert.throws(
            () => tools.getDnsResolver({ resolve: bad }),
            { name: 'TypeError', message: /resolve must be a function/ },
            `resolve of type ${typeof bad} must be refused`
        );
    }

    // An option left explicitly empty is not a mistake, it just means "not set"
    for (const empty of [undefined, null]) {
        const resolver = tools.getDnsResolver({
            resolveRecords: empty,
            resolve: (domain, callback) => setImmediate(() => callback(null, ['fell-through']))
        });
        assert.deepStrictEqual(await resolver('example.com'), ['fell-through'], 'An unset resolveRecords must fall through to resolve');
    }

    assert.strictEqual(typeof tools.getDnsResolver({ resolveRecords: null, resolve: null }), 'function', 'Both unset falls through to the native resolver');
});
