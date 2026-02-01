'use strict';

const getConnection = require('../lib/get-connection');
const { createMockConnectHook, createTrackingConnectHook } = require('./test-utils');

module.exports.noMxHosts = test => {
    getConnection({
        domain: 'empty.example.com',
        decodedDomain: 'empty.example.com',
        mx: []
    })
        .then(() => {
            test.ok(false, 'Should have rejected');
            test.done();
        })
        .catch(err => {
            test.equal(err.category, 'dns');
            test.ok(err.message.includes('No Mail Exchange'));
            test.done();
        });
};

module.exports.noValidAddresses = test => {
    // MX entries exist but have no resolvable IP addresses
    getConnection({
        domain: 'noips.example.com',
        decodedDomain: 'noips.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }]
    })
        .then(() => {
            test.ok(false, 'Should have rejected');
            test.done();
        })
        .catch(err => {
            test.equal(err.category, 'dns');
            test.ok(err.message.includes('No Mail Exchange'));
            test.done();
        });
};

module.exports.ipv6OnlyMx = test => {
    const { hook, connections } = createTrackingConnectHook();

    getConnection({
        domain: 'ipv6only.example.com',
        decodedDomain: 'ipv6only.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: ['2001:db8::1'] }],
        connectHook: hook
    })
        .then(() => {
            test.equal(connections[0].host, '2001:db8::1');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.ipv4Default = test => {
    const { hook, connections } = createTrackingConnectHook();

    getConnection({
        domain: 'dual.example.com',
        decodedDomain: 'dual.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: ['2001:db8::1'] }],
        connectHook: hook
    })
        .then(() => {
            test.equal(connections[0].host, '192.0.2.1');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.hookWithSocket = test => {
    const mockHook = createMockConnectHook({
        localAddress: '10.0.0.1',
        localPort: 12345,
        remoteAddress: '192.0.2.1'
    });

    getConnection({
        domain: 'test.example.com',
        decodedDomain: 'test.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
        connectHook: mockHook
    })
        .then(connection => {
            test.ok(connection.socket);
            test.equal(connection.localAddress, '10.0.0.1');
            test.equal(connection.localPort, 12345);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.priorityOrdering = test => {
    const { hook, connections } = createTrackingConnectHook();

    getConnection({
        domain: 'multi.example.com',
        decodedDomain: 'multi.example.com',
        mx: [
            { exchange: 'backup.example.com', priority: 20, A: ['192.0.2.2'], AAAA: [] },
            { exchange: 'primary.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] },
            { exchange: 'tertiary.example.com', priority: 30, A: ['192.0.2.3'], AAAA: [] }
        ],
        connectHook: hook
    })
        .then(connection => {
            test.equal(connections[0].host, '192.0.2.1');
            test.equal(connection.host, '192.0.2.1');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.ignoreMxHosts = test => {
    const { hook, connections } = createTrackingConnectHook();

    getConnection({
        domain: 'filter.example.com',
        decodedDomain: 'filter.example.com',
        mx: [
            { exchange: 'primary.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] },
            { exchange: 'backup.example.com', priority: 20, A: ['192.0.2.2'], AAAA: [] }
        ],
        ignoreMXHosts: ['192.0.2.1'],
        connectHook: hook
    })
        .then(() => {
            test.equal(connections[0].host, '192.0.2.2');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.connectHookError = test => {
    // connectHook errors reject the entire promise immediately
    const failingHook = function (delivery, options, callback) {
        const err = new Error('Hook rejected connection');
        err.code = 'HOOK_ERROR';
        return callback(err);
    };

    getConnection({
        domain: 'hookfail.example.com',
        decodedDomain: 'hookfail.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
        connectHook: failingHook
    })
        .then(() => {
            test.ok(false, 'Should have rejected');
            test.done();
        })
        .catch(err => {
            test.ok(err.message.includes('Hook rejected'));
            test.done();
        });
};

module.exports.customPort = test => {
    const { hook, connections } = createTrackingConnectHook();

    getConnection({
        domain: 'test.example.com',
        decodedDomain: 'test.example.com',
        port: 587,
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
        connectHook: hook
    })
        .then(() => {
            test.equal(connections[0].port, 587);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.deduplicateHosts = test => {
    const { hook, connections } = createTrackingConnectHook();

    getConnection({
        domain: 'dedup.example.com',
        decodedDomain: 'dedup.example.com',
        mx: [
            { exchange: 'mx1.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] },
            { exchange: 'mx2.example.com', priority: 20, A: ['192.0.2.1'], AAAA: [] }
        ],
        connectHook: hook
    })
        .then(() => {
            test.equal(connections.length, 1);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};
