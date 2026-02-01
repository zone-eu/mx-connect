'use strict';

const resolveIp = require('../lib/resolve-ip');
const { createMockDnsResolver, createDnsError } = require('./test-utils');

module.exports.dnsError = test => {
    const mockResolver = createMockDnsResolver({
        'mail.fail.example.com:A': { error: createDnsError('SERVFAIL') },
        'mail.fail.example.com:AAAA': { error: createDnsError('SERVFAIL') }
    });

    resolveIp({
        domain: 'fail.example.com',
        mx: [{ exchange: 'mail.fail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver }
    })
        .then(() => {
            test.ok(false, 'Should have rejected');
            test.done();
        })
        .catch(err => {
            test.equal(err.category, 'dns');
            test.equal(err.temporary, true);
            test.done();
        });
};

module.exports.partialSuccess = test => {
    const mockResolver = createMockDnsResolver({
        'primary.example.com:A': { error: createDnsError('SERVFAIL') },
        'primary.example.com:AAAA': { error: createDnsError('SERVFAIL') },
        'backup.example.com:A': { data: ['192.0.2.1'] },
        'backup.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    resolveIp({
        domain: 'example.com',
        mx: [
            { exchange: 'primary.example.com', priority: 10, A: [], AAAA: [] },
            { exchange: 'backup.example.com', priority: 20, A: [], AAAA: [] }
        ],
        dnsOptions: { resolve: mockResolver }
    })
        .then(delivery => {
            // Primary MX failed but backup succeeded
            test.equal(delivery.mx[0].A.length, 0);
            test.equal(delivery.mx[1].A.length, 1);
            test.equal(delivery.mx[1].A[0], '192.0.2.1');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.noAddressFound = test => {
    const mockResolver = createMockDnsResolver({
        'mail.empty.example.com:A': { error: createDnsError('ENOTFOUND') },
        'mail.empty.example.com:AAAA': { error: createDnsError('ENOTFOUND') }
    });

    resolveIp({
        domain: 'empty.example.com',
        mx: [{ exchange: 'mail.empty.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver }
    })
        .then(() => {
            test.ok(false, 'Should have rejected');
            test.done();
        })
        .catch(err => {
            test.equal(err.code, 'ENOTFOUND');
            test.equal(err.category, 'dns');
            test.done();
        });
};

module.exports.ipv4Only = test => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1', '192.0.2.2'] },
        'mail.example.com:AAAA': { error: createDnsError('ENODATA') }
    });

    resolveIp({
        domain: 'example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver }
    })
        .then(delivery => {
            test.equal(delivery.mx[0].A.length, 2);
            test.equal(delivery.mx[0].A[0], '192.0.2.1');
            test.equal(delivery.mx[0].A[1], '192.0.2.2');
            test.equal(delivery.mx[0].AAAA.length, 0);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.ignoreIPv6 = test => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1'] }
    });

    resolveIp({
        domain: 'example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver, ignoreIPv6: true }
    })
        .then(delivery => {
            test.equal(delivery.mx[0].A.length, 1);
            test.equal(delivery.mx[0].A[0], '192.0.2.1');
            // AAAA should not be resolved when ignoreIPv6 is true
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.customResolverCalledWithCorrectArgs = test => {
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

    resolveIp({
        domain: 'example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: customResolver }
    })
        .then(delivery => {
            // Should have called resolver for both A and AAAA
            test.equal(calls.length, 2);
            test.ok(calls.some(c => c.domain === 'mail.example.com' && c.type === 'A'));
            test.ok(calls.some(c => c.domain === 'mail.example.com' && c.type === 'AAAA'));
            test.deepEqual(delivery.mx[0].A, ['192.0.2.1']);
            test.deepEqual(delivery.mx[0].AAAA, ['2001:db8::1']);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.dualStack = test => {
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { data: ['2001:db8::1'] }
    });

    resolveIp({
        domain: 'example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }],
        dnsOptions: { resolve: mockResolver }
    })
        .then(delivery => {
            test.equal(delivery.mx[0].A.length, 1);
            test.equal(delivery.mx[0].A[0], '192.0.2.1');
            test.equal(delivery.mx[0].AAAA.length, 1);
            test.equal(delivery.mx[0].AAAA[0], '2001:db8::1');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};
