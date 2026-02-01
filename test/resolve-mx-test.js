'use strict';

const resolveMx = require('../lib/resolve-mx');
const { createMockDnsResolver, createDnsError } = require('./test-utils');

module.exports.dnsServfail = test => {
    const mockResolver = createMockDnsResolver({
        'servfail.example.com:MX': { error: createDnsError('SERVFAIL') }
    });

    resolveMx({
        domain: 'servfail.example.com',
        isIp: false,
        isPunycode: false,
        decodedDomain: 'servfail.example.com',
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

module.exports.fallbackToA = test => {
    const mockResolver = createMockDnsResolver({
        'noMx.example.com:MX': { error: createDnsError('ENODATA') },
        'noMx.example.com:A': { data: ['192.0.2.1'] }
    });

    resolveMx({
        domain: 'noMx.example.com',
        isIp: false,
        isPunycode: false,
        decodedDomain: 'noMx.example.com',
        dnsOptions: { resolve: mockResolver }
    })
        .then(delivery => {
            test.ok(delivery.mx.length === 1);
            test.equal(delivery.mx[0].exchange, 'noMx.example.com');
            test.equal(delivery.mx[0].mx, false);
            test.deepEqual(delivery.mx[0].A, ['192.0.2.1']);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.blockedLocalAddress = test => {
    const mockResolver = createMockDnsResolver({
        'local.example.com:MX': { error: createDnsError('ENODATA') },
        'local.example.com:A': { data: ['127.0.0.1'] }
    });

    resolveMx({
        domain: 'local.example.com',
        isIp: false,
        isPunycode: false,
        decodedDomain: 'local.example.com',
        dnsOptions: {
            resolve: mockResolver,
            blockLocalAddresses: true
        }
    })
        .then(() => {
            test.ok(false, 'Should have rejected');
            test.done();
        })
        .catch(err => {
            test.equal(err.category, 'dns');
            test.ok(err.message.includes('127.0.0.1'));
            test.done();
        });
};

module.exports.mxRecordsSorted = test => {
    const mockResolver = createMockDnsResolver({
        'multi.example.com:MX': {
            data: [
                { exchange: 'backup.example.com', priority: 20 },
                { exchange: 'primary.example.com', priority: 10 },
                { exchange: 'tertiary.example.com', priority: 30 }
            ]
        }
    });

    resolveMx({
        domain: 'multi.example.com',
        isIp: false,
        isPunycode: false,
        decodedDomain: 'multi.example.com',
        dnsOptions: { resolve: mockResolver }
    })
        .then(delivery => {
            test.equal(delivery.mx.length, 3);
            test.equal(delivery.mx[0].exchange, 'primary.example.com');
            test.equal(delivery.mx[0].priority, 10);
            test.equal(delivery.mx[1].exchange, 'backup.example.com');
            test.equal(delivery.mx[1].priority, 20);
            test.equal(delivery.mx[2].exchange, 'tertiary.example.com');
            test.equal(delivery.mx[2].priority, 30);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.ipLiteral = test => {
    resolveMx({
        domain: '192.0.2.1',
        isIp: true,
        isPunycode: false,
        decodedDomain: '192.0.2.1'
    })
        .then(delivery => {
            test.equal(delivery.mx.length, 1);
            test.equal(delivery.mx[0].exchange, '192.0.2.1');
            test.deepEqual(delivery.mx[0].A, ['192.0.2.1']);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};
