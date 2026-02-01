'use strict';

const mxConnect = require('../lib/mx-connect');
const { createMockDnsResolver, createMockSocket } = require('./test-utils');

module.exports.basicWithMock = test => {
    const mockResolver = createMockDnsResolver({
        'test.example.com:MX': {
            data: [{ exchange: 'mail.example.com', priority: 10 }]
        },
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { error: { code: 'ENODATA' } }
    });

    mxConnect(
        {
            target: 'test.example.com',
            dnsOptions: { resolve: mockResolver },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            test.ifError(err);
            test.ok(connection.socket);
            test.equal(connection.host, '192.0.2.1');
            test.done();
        }
    );
};

module.exports.addressWithMock = test => {
    const mockResolver = createMockDnsResolver({
        'example.com:MX': {
            data: [{ exchange: 'mail.example.com', priority: 10 }]
        },
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { error: { code: 'ENODATA' } }
    });

    mxConnect(
        {
            target: 'user@example.com',
            dnsOptions: { resolve: mockResolver },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            test.ifError(err);
            test.ok(connection.socket);
            test.done();
        }
    );
};

module.exports.preResolvedMx = test => {
    mxConnect(
        {
            target: 'test.example.com',
            mx: [
                {
                    exchange: 'mail.example.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: []
                }
            ],
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            test.ifError(err);
            test.ok(connection.socket);
            test.equal(connection.host, '192.0.2.1');
            test.done();
        }
    );
};

module.exports.dnsFailure = test => {
    const mockResolver = createMockDnsResolver({
        'fail.example.com:MX': { error: { code: 'SERVFAIL' } }
    });

    mxConnect(
        {
            target: 'fail.example.com',
            dnsOptions: { resolve: mockResolver }
        },
        (err, connection) => {
            test.ok(err);
            test.ok(!connection);
            test.equal(err.category, 'dns');
            test.done();
        }
    );
};

module.exports.connectionFailure = test => {
    const mockResolver = createMockDnsResolver({
        'noconnect.example.com:MX': {
            data: [{ exchange: 'mail.example.com', priority: 10 }]
        },
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { error: { code: 'ENODATA' } }
    });

    mxConnect(
        {
            target: 'noconnect.example.com',
            dnsOptions: { resolve: mockResolver },
            connectHook(delivery, options, callback) {
                const err = new Error('Connection refused');
                err.code = 'ECONNREFUSED';
                return callback(err);
            }
        },
        (err, connection) => {
            test.ok(err);
            test.ok(!connection);
            test.done();
        }
    );
};

module.exports.mtaStsDisabled = test => {
    mxConnect(
        {
            target: 'test.example.com',
            mx: [
                {
                    exchange: 'mail.example.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: []
                }
            ],
            mtaSts: {
                enabled: false
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            test.ifError(err);
            test.ok(connection.socket);
            test.ok(!connection.policyMatch);
            test.done();
        }
    );
};

module.exports.customPort = test => {
    let usedPort = null;

    mxConnect(
        {
            target: 'test.example.com',
            port: 587,
            mx: [
                {
                    exchange: 'mail.example.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: []
                }
            ],
            connectHook(delivery, options, callback) {
                usedPort = options.port;
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        err => {
            test.ifError(err);
            test.equal(usedPort, 587);
            test.done();
        }
    );
};

module.exports.mxPriorityOrdering = test => {
    let connectedHost = null;

    mxConnect(
        {
            target: 'test.example.com',
            mx: [
                { exchange: 'backup.example.com', priority: 20, A: ['192.0.2.2'], AAAA: [] },
                { exchange: 'primary.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }
            ],
            connectHook(delivery, options, callback) {
                // Track which host was connected to first
                connectedHost = options.host;
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            test.ifError(err);
            // Should connect to primary first (lower priority number = higher priority)
            test.equal(connectedHost, '192.0.2.1');
            test.equal(connection.host, '192.0.2.1');
            test.done();
        }
    );
};
