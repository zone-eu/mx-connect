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

// Promise-based API tests

module.exports.promiseBasic = async test => {
    try {
        const connection = await mxConnect({
            target: 'test.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        test.ok(connection.socket);
        test.equal(connection.host, '192.0.2.1');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.promiseRejectsOnError = async test => {
    const mockResolver = createMockDnsResolver({
        'fail.example.com:MX': { error: { code: 'SERVFAIL' } }
    });

    try {
        await mxConnect({
            target: 'fail.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.ok(err);
        test.equal(err.category, 'dns');
    }
    test.done();
};

module.exports.promiseReturnsPromiseWithCallback = async test => {
    // Verify that mxConnect returns a promise even when callback is provided,
    // and that the callback still fires alongside the promise resolution
    let callbackResult = null;

    const result = mxConnect(
        {
            target: 'test.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            callbackResult = { err, connection };
        }
    );

    test.ok(result instanceof Promise, 'Should return a promise when callback is provided');

    try {
        const connection = await result;
        test.ok(connection.socket);

        // The callback bridge defers via setImmediate, give it a beat to run
        await new Promise(resolve => setImmediate(resolve));
        test.ok(callbackResult, 'Callback should have been invoked');
        test.ifError(callbackResult.err);
        test.equal(callbackResult.connection, connection, 'Callback and promise should deliver the same result');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.stringShorthandTarget = async test => {
    // mxConnect('domain') string shorthand must behave like { target: 'domain' }
    const mockResolver = createMockDnsResolver({
        'shorthand.example.com:MX': { error: { code: 'ENODATA' } },
        'shorthand.example.com:A': { error: { code: 'ENODATA' } },
        'shorthand.example.com:AAAA': { error: { code: 'ENODATA' } }
    });

    try {
        // No MX/A/AAAA records: rejection proves the string target went through the pipeline
        await mxConnect({ target: 'shorthand.example.com', dnsOptions: { resolve: mockResolver } });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.equal(err.category, 'dns');
        test.ok(err.message.includes('shorthand.example.com'));
    }
    test.done();
};

module.exports.stringMxEntryIp = async test => {
    // mx entries given as plain IP strings must connect without DNS lookups
    try {
        const connection = await mxConnect({
            target: 'test.example.com',
            mx: ['192.0.2.5'],
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        test.ok(connection.socket);
        test.equal(connection.host, '192.0.2.5');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.stringMxEntryHostname = async test => {
    // mx entries given as hostname strings must be resolved to IP addresses
    const mockResolver = createMockDnsResolver({
        'mail.example.com:A': { data: ['192.0.2.6'] },
        'mail.example.com:AAAA': { error: { code: 'ENODATA' } }
    });

    try {
        const connection = await mxConnect({
            target: 'test.example.com',
            mx: ['mail.example.com'],
            dnsOptions: { resolve: mockResolver },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        test.ok(connection.socket);
        test.equal(connection.host, '192.0.2.6');
        test.equal(connection.hostname, 'mail.example.com');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.emptyTargetRejectsCleanly = async test => {
    // A missing target must produce a clean DNS-category rejection, never a
    // synchronous throw
    const mockResolver = createMockDnsResolver({});

    try {
        await mxConnect({ dnsOptions: { resolve: mockResolver } });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.equal(err.category, 'dns');
    }
    test.done();
};

module.exports.callbackThrowDoesNotDoubleInvoke = async test => {
    // A callback that throws must surface as an uncaught exception (classic
    // callback semantics) and must NOT be re-invoked with its own error
    let calls = 0;

    // Take over uncaughtException handling for the duration of this test
    const originalListeners = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');
    const caught = new Promise(resolve => process.once('uncaughtException', resolve));

    try {
        mxConnect(
            {
                target: 'test.example.com',
                mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
                connectHook(delivery, options, callback) {
                    options.socket = createMockSocket({ remoteAddress: options.host });
                    return callback();
                }
            },
            () => {
                calls++;
                throw new Error('callback boom');
            }
        );

        const err = await caught;
        test.equal(err.message, 'callback boom', 'The thrown error should surface as an uncaught exception');

        // Give any (incorrect) second invocation a chance to happen
        await new Promise(resolve => setImmediate(resolve));
        test.equal(calls, 1, 'Callback must be invoked exactly once');
    } finally {
        process.removeAllListeners('uncaughtException');
        for (const listener of originalListeners) {
            process.on('uncaughtException', listener);
        }
    }
    test.done();
};

module.exports.mtaStsEnforceRejectsEndToEnd = async test => {
    // Full pipeline MTA-STS test with a mocked TXT record and cached policy:
    // an MX host not covered by an enforce-mode policy must be rejected
    const mockResolver = createMockDnsResolver({
        '_mta-sts.sts-e2e.example.com:TXT': { data: [['v=STSv1; id=test123']] }
    });

    const cachedPolicy = { id: 'test123', mode: 'enforce', mx: ['mail.example.com'], maxAge: 86400 };
    const setCalls = [];
    const cache = {
        async get() {
            return cachedPolicy;
        },
        async set(domain, policy) {
            setCalls.push({ domain, policy });
        }
    };

    try {
        await mxConnect({
            target: 'sts-e2e.example.com',
            mx: [{ exchange: 'rogue.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            dnsOptions: { resolve: mockResolver },
            mtaSts: { enabled: true, cache },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.equal(err.category, 'policy');
        test.equal(setCalls.length, 1, 'The renewed policy should have been cached');
        test.equal(setCalls[0].domain, 'sts-e2e.example.com');
    }
    test.done();
};

module.exports.mtaStsValidMxConnectsEndToEnd = async test => {
    // Full pipeline MTA-STS test: an MX host listed in the enforce-mode policy
    // must connect and carry the policy match on the connection
    const mockResolver = createMockDnsResolver({
        '_mta-sts.sts-ok.example.com:TXT': { data: [['v=STSv1; id=ok123']] }
    });

    const cachedPolicy = { id: 'ok123', mode: 'enforce', mx: ['mail.example.com'], maxAge: 86400 };
    const cache = {
        async get() {
            return cachedPolicy;
        },
        async set() {
            return false;
        }
    };

    try {
        const connection = await mxConnect({
            target: 'sts-ok.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            dnsOptions: { resolve: mockResolver },
            mtaSts: { enabled: true, cache },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        test.ok(connection.socket);
        test.equal(connection.policyMatch.valid, true);
        test.equal(connection.policyMatch.mode, 'enforce');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.mtaStsNoPolicyNoCacheConnects = async test => {
    // MTA-STS enabled without a cache handler and with no policy published:
    // the default no-op cache is used and the connection proceeds in mode none
    const mockResolver = createMockDnsResolver({});

    try {
        const connection = await mxConnect({
            target: 'nopolicy.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            dnsOptions: { resolve: mockResolver },
            mtaSts: { enabled: true },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        test.ok(connection.socket);
        test.equal(connection.policyMatch.valid, true);
        test.equal(connection.policyMatch.mode, 'none');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};
