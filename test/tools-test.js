/* eslint no-console: 0*/

'use strict';

const tools = require('../lib/tools');

module.exports.getDnsResolverWithCustomResolver = test => {
    const calls = [];
    const customResolver = (domain, typeOrCallback, maybeCallback) => {
        const callback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback;
        const type = typeof typeOrCallback === 'string' ? typeOrCallback : 'A';
        calls.push({ domain, type });
        setImmediate(() => callback(null, ['192.0.2.1']));
    };

    const resolver = tools.getDnsResolver(customResolver);

    // Test with type argument
    resolver('example.com', 'MX')
        .then(result => {
            test.deepEqual(result, ['192.0.2.1']);
            test.equal(calls.length, 1);
            test.equal(calls[0].domain, 'example.com');
            test.equal(calls[0].type, 'MX');

            // Test without type argument (should resolve A records)
            return resolver('example2.com');
        })
        .then(result => {
            test.deepEqual(result, ['192.0.2.1']);
            test.equal(calls.length, 2);
            test.equal(calls[1].domain, 'example2.com');
            test.equal(calls[1].type, 'A');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.getDnsResolverWithCustomResolverError = test => {
    const customResolver = (domain, typeOrCallback, maybeCallback) => {
        const callback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback;
        const err = new Error('SERVFAIL');
        err.code = 'SERVFAIL';
        setImmediate(() => callback(err));
    };

    const resolver = tools.getDnsResolver(customResolver);

    resolver('fail.example.com', 'MX')
        .then(() => {
            test.ok(false, 'Should have rejected');
            test.done();
        })
        .catch(err => {
            test.equal(err.code, 'SERVFAIL');
            test.done();
        });
};

module.exports.getDnsResolverWithoutCustomResolver = test => {
    // When no custom resolver provided, should use native dns.promises
    const resolver = tools.getDnsResolver(null);

    // Just verify it returns a function
    test.equal(typeof resolver, 'function');
    test.done();
};

module.exports.isNotFoundError = test => {
    test.equal(tools.isNotFoundError({ code: 'ENODATA' }), true);
    test.equal(tools.isNotFoundError({ code: 'ENOTFOUND' }), true);
    test.equal(tools.isNotFoundError({ code: 'SERVFAIL' }), false);
    test.ok(!tools.isNotFoundError(null), 'null should be falsy');
    test.ok(!tools.isNotFoundError(undefined), 'undefined should be falsy');
    test.done();
};

module.exports.isInvalid = test => {
    test.equal(
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '127.0.0.1'
        ),
        false
    );

    test.equal(
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

    test.ok(
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

    test.ok(
        // IP address in disallowed unspecified range
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '0.0.0.0'
        )
    );

    test.ok(
        // IP address in disallowed broadcast range
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '255.255.255.255'
        )
    );

    // multicast is never a valid unicast destination - blocked regardless of options
    test.ok(tools.isInvalid({ dnsOptions: {} }, '224.0.0.1'));
    test.ok(tools.isInvalid({ dnsOptions: {} }, 'ff02::1'));

    // reserved (future-use / documentation) is blocked only when blockReservedNetworks=true
    test.equal(tools.isInvalid({ dnsOptions: {} }, '240.0.0.1'), false);
    test.ok(tools.isInvalid({ dnsOptions: { blockReservedNetworks: true } }, '240.0.0.1'));
    // documentation ranges (RFC 5737 / 3849) are 'reserved' too - allowed by default
    test.equal(tools.isInvalid({ dnsOptions: {} }, '192.0.2.1'), false);
    test.ok(tools.isInvalid({ dnsOptions: { blockReservedNetworks: true } }, '192.0.2.1'));

    // link-local, CGNAT and IPv6 unique-local are local-scope: only blocked when blockLocalAddresses=true
    for (const ip of ['169.254.1.1', '100.64.0.1', 'fe80::1', 'fc00::1']) {
        test.equal(tools.isInvalid({ dnsOptions: {} }, ip), false);
        test.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, ip));
    }

    // IPv6 loopback is blocked with blockLocalAddresses, allowed without
    test.equal(tools.isInvalid({ dnsOptions: {} }, '::1'), false);
    test.ok(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '::1'));

    // public unicast addresses remain valid in both modes
    test.equal(tools.isInvalid({ dnsOptions: { blockLocalAddresses: true } }, '2606:4700:4700::1111'), false);

    test.done();
};
