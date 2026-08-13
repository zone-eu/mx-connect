'use strict';

const resolveIp = require('../lib/resolve-ip');
const { createMockDnsResolver, createDnsError } = require('./test-utils');

module.exports.dnsError = async test => {
    const mockResolver = createMockDnsResolver({
        'mail.fail.example.com:A': { error: createDnsError('SERVFAIL') },
        'mail.fail.example.com:AAAA': { error: createDnsError('SERVFAIL') }
    });

    try {
        await resolveIp({
            domain: 'fail.example.com',
            mx: [{ exchange: 'mail.fail.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver }
        });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.equal(err.category, 'dns');
        test.equal(err.temporary, true);
    }
    test.done();
};

module.exports.partialSuccess = async test => {
    const mockResolver = createMockDnsResolver({
        'primary.example.com:A': { error: createDnsError('SERVFAIL') },
        'primary.example.com:AAAA': { error: createDnsError('SERVFAIL') },
        'backup.example.com:A': { data: ['192.0.2.1'] },
        'backup.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    try {
        const delivery = await resolveIp({
            domain: 'example.com',
            mx: [
                { exchange: 'primary.example.com', priority: 10, A: [], AAAA: [] },
                { exchange: 'backup.example.com', priority: 20, A: [], AAAA: [] }
            ],
            dnsOptions: { resolve: mockResolver }
        });
        // Primary MX failed but backup succeeded
        test.equal(delivery.mx[0].A.length, 0);
        test.equal(delivery.mx[1].A.length, 1);
        test.equal(delivery.mx[1].A[0], '192.0.2.1');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.noAddressFound = async test => {
    const mockResolver = createMockDnsResolver({
        'mail.empty.example.com:A': { error: createDnsError('ENOTFOUND') },
        'mail.empty.example.com:AAAA': { error: createDnsError('ENOTFOUND') }
    });

    try {
        await resolveIp({
            domain: 'empty.example.com',
            mx: [{ exchange: 'mail.empty.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver }
        });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.equal(err.code, 'ENOTFOUND');
        test.equal(err.category, 'dns');
    }
    test.done();
};

module.exports.ipv4Only = async test => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1', '192.0.2.2'] },
        'mail.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    try {
        const delivery = await resolveIp({
            domain: 'example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver }
        });
        test.equal(delivery.mx[0].A.length, 2);
        test.equal(delivery.mx[0].A[0], '192.0.2.1');
        test.equal(delivery.mx[0].A[1], '192.0.2.2');
        test.equal(delivery.mx[0].AAAA.length, 0);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.ignoreIPv6 = async test => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1'] }
    });

    try {
        const delivery = await resolveIp({
            domain: 'example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver, ignoreIPv6: true }
        });
        test.equal(delivery.mx[0].A.length, 1);
        test.equal(delivery.mx[0].A[0], '192.0.2.1');
        // AAAA should not be resolved when ignoreIPv6 is true
        test.equal(delivery.mx[0].AAAA.length, 0);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.customResolverCalledWithCorrectArgs = async test => {
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

    try {
        const delivery = await resolveIp({
            domain: 'example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: customResolver }
        });
        // Should have called resolver for both A and AAAA
        test.equal(calls.length, 2);
        test.ok(calls.some(c => c.domain === 'mail.example.com' && c.type === 'A'));
        test.ok(calls.some(c => c.domain === 'mail.example.com' && c.type === 'AAAA'));
        test.deepEqual(delivery.mx[0].A, ['192.0.2.1']);
        test.deepEqual(delivery.mx[0].AAAA, ['2001:db8::1']);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.dualStack = async test => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { data: ['2001:db8::1'] }
    });

    try {
        const delivery = await resolveIp({
            domain: 'example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver }
        });
        test.equal(delivery.mx[0].A.length, 1);
        test.equal(delivery.mx[0].A[0], '192.0.2.1');
        test.equal(delivery.mx[0].AAAA.length, 1);
        test.equal(delivery.mx[0].AAAA[0], '2001:db8::1');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.ipExchangeSkipsDnsLookup = async test => {
    // An exchange that is already an IP address must not trigger DNS lookups
    const calls = [];
    const customResolver = (domain, typeOrCallback, maybeCallback) => {
        const callback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback;
        calls.push(domain);
        return setImmediate(() => callback(null, []));
    };

    try {
        const delivery = await resolveIp({
            domain: 'example.com',
            mx: [
                { exchange: '192.0.2.1', priority: 10, A: [], AAAA: [] },
                { exchange: '2001:db8::1', priority: 20, A: [], AAAA: [] }
            ],
            dnsOptions: { resolve: customResolver }
        });
        test.equal(calls.length, 0, 'No DNS lookups expected for IP address exchanges');
        test.deepEqual(delivery.mx[0].A, ['192.0.2.1']);
        test.deepEqual(delivery.mx[1].AAAA, ['2001:db8::1']);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.blockedLocalAddressRejected = async test => {
    // An MX host resolving only to a blocked local address must be rejected
    const mockResolver = createMockDnsResolver({
        'mail.local.example.com:A': { data: ['127.0.0.1'] },
        'mail.local.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    try {
        await resolveIp({
            domain: 'local.example.com',
            mx: [{ exchange: 'mail.local.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: mockResolver, blockLocalAddresses: true }
        });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.equal(err.code, 'InvalidIpAddress');
        test.equal(err.category, 'dns');
        test.ok(err.message.includes('127.0.0.1'));
    }
    test.done();
};

module.exports.blockedLocalAddressFilteredWhenOthersRemain = async test => {
    // Blocked addresses are filtered out but delivery proceeds via valid hosts
    const mockResolver = createMockDnsResolver({
        'bad.example.com:A': { data: ['127.0.0.1'] },
        'bad.example.com:AAAA': { error: createDnsError('ENODATA') },
        'good.example.com:A': { data: ['192.0.2.9'] },
        'good.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    try {
        const delivery = await resolveIp({
            domain: 'mixed.example.com',
            mx: [
                { exchange: 'bad.example.com', priority: 10, A: [], AAAA: [] },
                { exchange: 'good.example.com', priority: 20, A: [], AAAA: [] }
            ],
            dnsOptions: { resolve: mockResolver, blockLocalAddresses: true }
        });
        test.deepEqual(delivery.mx[0].A, [], 'Blocked address must be filtered out');
        test.deepEqual(delivery.mx[1].A, ['192.0.2.9']);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.entryWithoutExchangeIsSkipped = async test => {
    // An MX entry without an exchange must be skipped without DNS lookups and
    // without breaking resolution for the remaining entries
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    try {
        const delivery = await resolveIp({
            domain: 'example.com',
            mx: [
                { exchange: '', priority: 5, A: [], AAAA: [] },
                { exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }
            ],
            dnsOptions: { resolve: mockResolver }
        });
        test.deepEqual(delivery.mx[0].A, []);
        test.deepEqual(delivery.mx[1].A, ['192.0.2.1']);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.resolverReturningUndefinedTreatedAsEmpty = async test => {
    // A custom resolver that calls back without a result list must be treated
    // as an empty answer, not crash
    const customResolver = (domain, typeOrCallback, maybeCallback) => {
        const callback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback;
        return setImmediate(() => callback(null, undefined));
    };

    try {
        await resolveIp({
            domain: 'undef.example.com',
            mx: [{ exchange: 'mail.undef.example.com', priority: 10, A: [], AAAA: [] }],
            dnsOptions: { resolve: customResolver }
        });
        test.ok(false, 'Should have rejected with no addresses found');
    } catch (err) {
        test.equal(err.code, 'ENOTFOUND');
        test.equal(err.category, 'dns');
    }
    test.done();
};
