'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const mxConnect = require('../lib/mx-connect');
const { createMockDnsResolver, createTrackingDnsResolver, createMockSocket, startGreetingServer, closeServer } = require('./test-utils');

test('basicWithMock', (t, done) => {
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
            assert.ifError(err);
            assert.ok(connection.socket);
            assert.strictEqual(connection.host, '192.0.2.1');
            done();
        }
    );
});

test('addressWithMock', (t, done) => {
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
            assert.ifError(err);
            assert.ok(connection.socket);
            done();
        }
    );
});

test('preResolvedMx', (t, done) => {
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
            assert.ifError(err);
            assert.ok(connection.socket);
            assert.strictEqual(connection.host, '192.0.2.1');
            done();
        }
    );
});

test('dnsFailure', (t, done) => {
    const mockResolver = createMockDnsResolver({
        'fail.example.com:MX': { error: { code: 'SERVFAIL' } }
    });

    mxConnect(
        {
            target: 'fail.example.com',
            dnsOptions: { resolve: mockResolver }
        },
        (err, connection) => {
            assert.ok(err);
            assert.ok(!connection);
            assert.strictEqual(err.category, 'dns');
            done();
        }
    );
});

test('connectionFailure', (t, done) => {
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
            assert.ok(err);
            assert.ok(!connection);
            done();
        }
    );
});

test('mtaStsDisabled', (t, done) => {
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
            assert.ifError(err);
            assert.ok(connection.socket);
            assert.ok(!connection.policyMatch);
            done();
        }
    );
});

test('customPort', (t, done) => {
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
            assert.ifError(err);
            assert.strictEqual(usedPort, 587);
            done();
        }
    );
});

test('mxPriorityOrdering', (t, done) => {
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
            assert.ifError(err);
            // Should connect to primary first (lower priority number = higher priority)
            assert.strictEqual(connectedHost, '192.0.2.1');
            assert.strictEqual(connection.host, '192.0.2.1');
            done();
        }
    );
});

// Promise-based API tests

test('promiseBasic', async () => {
    try {
        const connection = await mxConnect({
            target: 'test.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        assert.ok(connection.socket);
        assert.strictEqual(connection.host, '192.0.2.1');
    } catch (err) {
        assert.ifError(err);
    }
});

test('promiseRejectsOnError', async () => {
    const mockResolver = createMockDnsResolver({
        'fail.example.com:MX': { error: { code: 'SERVFAIL' } }
    });

    try {
        await mxConnect({
            target: 'fail.example.com',
            dnsOptions: { resolve: mockResolver }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.ok(err);
        assert.strictEqual(err.category, 'dns');
    }
});

test('promiseReturnsPromiseWithCallback', async () => {
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

    assert.ok(result instanceof Promise, 'Should return a promise when callback is provided');

    try {
        const connection = await result;
        assert.ok(connection.socket);

        // The callback bridge defers via setImmediate, give it a beat to run
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(callbackResult, 'Callback should have been invoked');
        assert.ifError(callbackResult.err);
        assert.strictEqual(callbackResult.connection, connection, 'Callback and promise should deliver the same result');
    } catch (err) {
        assert.ifError(err);
    }
});

test('stringShorthandTarget', async () => {
    // mxConnect('domain') string shorthand must behave like { target: 'domain' }
    const mockResolver = createMockDnsResolver({
        'shorthand.example.com:MX': { error: { code: 'ENODATA' } },
        'shorthand.example.com:A': { error: { code: 'ENODATA' } },
        'shorthand.example.com:AAAA': { error: { code: 'ENODATA' } }
    });

    try {
        // No MX/A/AAAA records: rejection proves the string target went through the pipeline
        await mxConnect({ target: 'shorthand.example.com', dnsOptions: { resolve: mockResolver } });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
        assert.ok(err.message.includes('shorthand.example.com'));
    }
});

test('stringMxEntryIp', async () => {
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
        assert.ok(connection.socket);
        assert.strictEqual(connection.host, '192.0.2.5');
    } catch (err) {
        assert.ifError(err);
    }
});

test('stringMxEntryHostname', async () => {
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
        assert.ok(connection.socket);
        assert.strictEqual(connection.host, '192.0.2.6');
        assert.strictEqual(connection.hostname, 'mail.example.com');
    } catch (err) {
        assert.ifError(err);
    }
});

test('emptyTargetRejectsCleanly', async () => {
    // A missing target must produce a clean DNS-category rejection, never a
    // synchronous throw
    const mockResolver = createMockDnsResolver({});

    try {
        await mxConnect({ dnsOptions: { resolve: mockResolver } });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'dns');
    }
});

test('callbackThrowDoesNotDoubleInvoke', async () => {
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
        assert.strictEqual(err.message, 'callback boom', 'The thrown error should surface as an uncaught exception');

        // Give any (incorrect) second invocation a chance to happen
        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(calls, 1, 'Callback must be invoked exactly once');
    } finally {
        process.removeAllListeners('uncaughtException');
        for (const listener of originalListeners) {
            process.on('uncaughtException', listener);
        }
    }
});

test('mtaStsEnforceRejectsEndToEnd', async () => {
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
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.category, 'policy');
        assert.strictEqual(setCalls.length, 1, 'The renewed policy should have been cached');
        assert.strictEqual(setCalls[0].domain, 'sts-e2e.example.com');
    }
});

test('mtaStsValidMxConnectsEndToEnd', async () => {
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
        assert.ok(connection.socket);
        assert.strictEqual(connection.policyMatch.valid, true);
        assert.strictEqual(connection.policyMatch.mode, 'enforce');
    } catch (err) {
        assert.ifError(err);
    }
});

test('mtaStsNoPolicyNoCacheConnects', async () => {
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
        assert.ok(connection.socket);
        assert.strictEqual(connection.policyMatch.valid, true);
        assert.strictEqual(connection.policyMatch.mode, 'none');
    } catch (err) {
        assert.ifError(err);
    }
});

test('mxOptionIpLiteralValidated', async () => {
    // Addresses passed through the mx option skip MX resolution, and used to skip
    // validation with it, which left blockLocalAddresses silently inert for exactly
    // the input an operator is most likely to hand-craft
    const attempts = [];

    try {
        await mxConnect({
            target: 'literal.example.com',
            mx: ['127.0.0.1'],
            dnsOptions: { blockLocalAddresses: true },
            connectHook(delivery, options, callback) {
                attempts.push(options.host);
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.code, 'InvalidIpAddress');
        assert.strictEqual(err.category, 'dns');
        assert.ok(err.message.includes('127.0.0.1'));
    }
    assert.deepStrictEqual(attempts, [], 'No connection may be attempted to a blocked address');
});

test('mxOptionPreResolvedAddressValidated', async () => {
    // Same for addresses supplied on a resolved MX object, including the transition
    // forms that reach an internal IPv4 host through an outwardly public IPv6 address
    for (const address of ['127.0.0.1', '64:ff9b::7f00:1']) {
        try {
            await mxConnect({
                target: 'literal.example.com',
                mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [address] }],
                dnsOptions: { blockLocalAddresses: true },
                connectHook(delivery, options, callback) {
                    options.socket = createMockSocket({ remoteAddress: options.host });
                    return callback();
                }
            });
            assert.ok(false, `Should have rejected ${address}`);
        } catch (err) {
            assert.strictEqual(err.code, 'InvalidIpAddress', `${address} should be rejected as invalid`);
            assert.ok(err.message.includes('127.0.0.1'), `${address} should be reported by the address it reaches`);
        }
    }
});

test('mtaStsPolicyHostAddressValidated', async () => {
    // Fetching an MTA-STS policy means an HTTPS request to whatever mta-sts.<domain>
    // resolves to, before any MX record is considered. A domain must not be able to
    // publish a policy host pointing at an internal address and have every delivery
    // attempt connect there while blockLocalAddresses is enabled.
    const mockResolver = createMockDnsResolver({
        '_mta-sts.sts-ssrf.example.com:TXT': { data: [['v=STSv1; id=ssrf1']] },
        'mta-sts.sts-ssrf.example.com:A': { data: ['169.254.169.254'] },
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { error: { code: 'ENODATA' } }
    });

    const logEntries = [];
    let seenDelivery = null;

    try {
        const connection = await mxConnect({
            target: 'sts-ssrf.example.com',
            mx: ['mail.example.com'],
            dnsOptions: { resolve: mockResolver, blockLocalAddresses: true },
            mtaSts: { enabled: true, logger: entry => logEntries.push(entry) },
            connectHook(delivery, options, callback) {
                seenDelivery = delivery;
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        assert.ok(connection.socket);
        assert.strictEqual(connection.host, '192.0.2.1');
        // With the policy host unusable no policy is fetched, so nothing is enforced
        assert.strictEqual(connection.policyMatch.mode, 'none');
    } catch (err) {
        assert.ifError(err);
    }

    const blocked = (seenDelivery && seenDelivery.blockedAddresses) || [];
    assert.deepStrictEqual(
        blocked.map(entry => entry.ip),
        ['169.254.169.254'],
        'The policy host address should be recorded as blocked'
    );
    assert.strictEqual(blocked[0].exchange, 'mta-sts.sts-ssrf.example.com');

    const skipped = logEntries.filter(entry => entry.msg === 'Skipped MTA-STS policy host address');
    assert.strictEqual(skipped.length, 1);
    assert.strictEqual(skipped[0].host, '169.254.169.254');
});

test('mtaStsPolicyResolverUsesTwoArgumentAForm', async () => {
    // mailauth asks for A records explicitly, while custom resolvers are promised that
    // A lookups always arrive in the two-argument form. A resolver implementing only
    // that form must not be left waiting for a callback that never comes.
    const { resolver, calls } = createTrackingDnsResolver({
        '_mta-sts.sts-arity.example.com:TXT': { data: [['v=STSv1; id=arity1']] },
        'mail.example.com:A': { data: ['192.0.2.1'] }
    });

    try {
        const connection = await mxConnect({
            target: 'sts-arity.example.com',
            mx: ['mail.example.com'],
            dnsOptions: { resolve: resolver },
            mtaSts: { enabled: true },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        assert.ok(connection.socket);
    } catch (err) {
        assert.ifError(err);
    }

    const policyHostCalls = calls.filter(entry => entry.domain === 'mta-sts.sts-arity.example.com');
    assert.ok(policyHostCalls.length > 0, 'The policy host must be resolved');
    assert.strictEqual(policyHostCalls[0].type, 'A');
    assert.strictEqual(policyHostCalls[0].args, 2, 'A lookups must use the two-argument resolver form');

    const txtCalls = calls.filter(entry => entry.type === 'TXT');
    assert.strictEqual(txtCalls.length, 1);
    assert.strictEqual(txtCalls[0].args, 3, 'Other record types keep the three-argument form');
});

test('mtaStsPolicyResolverHonoursIgnoreIPv6', async () => {
    // mailauth falls back to an AAAA lookup for the policy host when the A lookup comes
    // back empty, which would reach for IPv6 on a host that asked never to use it
    const { resolver, calls } = createTrackingDnsResolver({
        '_mta-sts.sts-v6.example.com:TXT': { data: [['v=STSv1; id=v6only1']] },
        'mail.example.com:A': { data: ['192.0.2.1'] }
    });

    try {
        const connection = await mxConnect({
            target: 'sts-v6.example.com',
            mx: ['mail.example.com'],
            dnsOptions: { resolve: resolver, ignoreIPv6: true },
            mtaSts: { enabled: true },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        assert.ok(connection.socket);
    } catch (err) {
        assert.ifError(err);
    }

    const aaaaCalls = calls.filter(entry => entry.type === 'AAAA');
    assert.deepStrictEqual(aaaaCalls, [], 'No AAAA lookup may be issued when ignoreIPv6 is set');
});

test('mxOptionNonCanonicalAddressRejected', async () => {
    // ipaddr.js reads a leading zero as octal, the platform resolver reads it as decimal,
    // so 0127.0.0.1 is the public 87.0.0.1 to a range check and 127.0.0.1 to the socket.
    // net.connect would hand such a string to dns.lookup, so the address validated has to
    // be a canonical literal or it is not the address connected to.
    for (const address of ['0127.0.0.1', '010.000.000.001', '0169.254.169.254']) {
        const attempts = [];
        try {
            await mxConnect({
                target: 'octal.example.com',
                mx: [{ exchange: 'mail.example.com', priority: 10, A: [address], AAAA: [] }],
                dnsOptions: { blockLocalAddresses: true },
                connectHook(delivery, options, callback) {
                    attempts.push(options.host);
                    options.socket = createMockSocket({ remoteAddress: options.host });
                    return callback();
                }
            });
            assert.ok(false, `Should have rejected ${address}`);
        } catch (err) {
            assert.strictEqual(err.code, 'InvalidIpAddress', `${address} should be refused`);
        }
        assert.deepStrictEqual(attempts, [], `no connection may be attempted for ${address}`);
    }
});

test('mxOptionIPv6RejectedWhenIgnoreIPv6', async () => {
    // Skipping AAAA lookups does nothing for an address the caller supplied directly, so
    // ignoreIPv6 used to be silently inert for the mx option and the delivery went out
    // over IPv6 anyway
    // The three shapes an IPv6 address can arrive in through the mx option, each reaching
    // a different branch: a bare string, pre-resolved AAAA, and an IPv6 literal exchange
    const shapes = [
        ['string entry', ['2606:4700:4700::1111']],
        ['pre-resolved AAAA', [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: ['2606:4700:4700::1111'] }]],
        ['IPv6 literal exchange', [{ exchange: '2606:4700:4700::1111', priority: 10 }]]
    ];

    for (const [label, mx] of shapes) {
        const attempts = [];
        try {
            await mxConnect({
                target: 'v6.example.com',
                mx,
                dnsOptions: { ignoreIPv6: true },
                connectHook(delivery, options, callback) {
                    attempts.push(options.host);
                    options.socket = createMockSocket({ remoteAddress: options.host });
                    return callback();
                }
            });
            assert.ok(false, `Should have rejected an IPv6 address given as ${label}`);
        } catch (err) {
            assert.strictEqual(err.code, 'InvalidIpAddress', `${label} should be refused as an invalid address`);
        }
        assert.deepStrictEqual(attempts, [], `No IPv6 connection may be attempted for ${label}`);
    }

    // An entry that also carries an IPv4 address stays deliverable over IPv4, and the
    // address dropped on the way has to be visible rather than silently filtered
    let seenDelivery = null;
    try {
        const connection = await mxConnect({
            target: 'v6.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: ['2606:4700:4700::1111'] }],
            dnsOptions: { ignoreIPv6: true },
            connectHook(delivery, options, callback) {
                seenDelivery = delivery;
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        assert.strictEqual(connection.host, '192.0.2.1', 'Delivery must fall to the IPv4 address rather than fail');
    } catch (err) {
        assert.ifError(err);
    }

    const blocked = (seenDelivery && seenDelivery.blockedAddresses) || [];
    assert.deepStrictEqual(
        blocked.map(entry => entry.ip),
        ['2606:4700:4700::1111'],
        'The dropped IPv6 address must be recorded'
    );
    assert.ok(blocked[0].reason.includes('ignoreIPv6'), 'The record must name the option that dropped it');
});

test('ignoreIPv6TargetRefusedAndRetryable', async () => {
    // An IPv6 target is refused by the address check rather than while parsing, so the
    // error names the address and carries a code. It is also temporary: nothing is wrong
    // with the host, this sender just does not use IPv6, so the message waits for the
    // setting to change instead of bouncing.
    try {
        await mxConnect({ target: '[IPv6:2001:db8:1ff::a0b:dbd0]', dnsOptions: { ignoreIPv6: true } });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.code, 'InvalidIpAddress');
        assert.strictEqual(err.category, 'dns');
        assert.strictEqual(err.temporary, true, 'A local transport policy must not bounce the message');
        assert.ok(err.message.includes('2001:db8:1ff::a0b:dbd0'));
        assert.ok(err.message.includes('given as the delivery target'), 'The target must not be reported as an MX lookup result');
    }

    // An IPv6 target that is never used as a destination, because the mx option supplies
    // the real host, must not be refused at all
    try {
        const connection = await mxConnect({
            target: '[IPv6:2001:db8:1ff::a0b:dbd0]',
            mx: ['192.0.2.1'],
            dnsOptions: { ignoreIPv6: true },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        assert.strictEqual(connection.host, '192.0.2.1', 'An unused IPv6 target must not block delivery');
    } catch (err) {
        assert.ifError(err);
    }
});

test('blockedAddressRefusalStaysPermanent', async () => {
    // A refusal that is a property of the destination stays permanent: retrying will not
    // make a loopback MX deliverable
    try {
        await mxConnect({
            target: 'local.example.com',
            mx: ['127.0.0.1'],
            dnsOptions: { blockLocalAddresses: true }
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.strictEqual(err.code, 'InvalidIpAddress');
        assert.ok(!err.temporary, 'A blocked destination must not be retried');
    }
});

test('mtaStsPolicyHostAddressPassesFilter', async () => {
    // The other MTA-STS tests either use a cached policy or have the policy host address
    // rejected, so none of them proves an accepted address still reaches mailauth. Without
    // this, a filter that rejected everything would silently stop policies being fetched at
    // all and every one of those tests would still pass. The policy host resolves to
    // loopback and the options do not block it, so the fetch is attempted and refused
    // locally, which keeps the test offline and immediate.
    const { resolver, calls } = createTrackingDnsResolver({
        '_mta-sts.pass.example.com:TXT': { data: [['v=STSv1; id=pass1']] },
        'mta-sts.pass.example.com:A': { data: ['127.0.0.1'] },
        'mail.example.com:A': { data: ['192.0.2.1'] },
        'mail.example.com:AAAA': { error: { code: 'ENODATA' } }
    });

    let seenDelivery = null;
    try {
        const connection = await mxConnect({
            target: 'pass.example.com',
            mx: ['mail.example.com'],
            dnsOptions: { resolve: resolver },
            mtaSts: { enabled: true },
            connectHook(delivery, options, callback) {
                seenDelivery = delivery;
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        });
        assert.ok(connection.socket);
        assert.strictEqual(connection.host, '192.0.2.1');
    } catch (err) {
        assert.ifError(err);
    }

    const policyHostCalls = calls.filter(entry => entry.domain === 'mta-sts.pass.example.com');
    assert.ok(policyHostCalls.length > 0, 'The policy host must be resolved');
    assert.deepStrictEqual((seenDelivery && seenDelivery.blockedAddresses) || [], [], 'An allowed policy host address must not be filtered out');
});

test('endToEndOverRealSocket', async () => {
    // The whole public API against a real socket, with no connectHook diverting it and no
    // network beyond loopback. Every other test here supplies its own socket, so this is
    // the only one that proves the pieces connect to anything.
    const server = await startGreetingServer();
    const { port } = server.address();

    try {
        const connection = await mxConnect({ target: 'mx-connect.test', mx: ['127.0.0.1'], port });
        assert.ok(connection.socket);
        assert.strictEqual(connection.host, '127.0.0.1');
        assert.strictEqual(connection.port, port);

        const greeting = await new Promise(resolve => connection.socket.once('data', chunk => resolve(chunk.toString())));
        assert.ok(greeting.startsWith('220 '), 'The connected socket must carry the greeting');
        connection.socket.destroy();
    } catch (err) {
        assert.ifError(err);
    }

    await closeServer(server);
});

test('resolveAsyncDrivesTheWholePipeline', async () => {
    // The promise-based resolver has to serve every lookup the delivery makes, not just
    // the MX one, and a synchronous return is as acceptable as a promise
    const calls = [];
    const records = {
        'async.example.com:MX': [{ exchange: 'mail.example.com', priority: 10 }],
        'mail.example.com:A': ['192.0.2.1']
    };

    const connection = await mxConnect({
        target: 'async.example.com',
        dnsOptions: {
            resolveAsync(domain, type) {
                calls.push(`${domain}:${type}`);
                const answer = records[`${domain}:${type}`];
                if (!answer) {
                    const err = new Error('ENODATA');
                    err.code = 'ENODATA';
                    throw err;
                }
                return answer;
            }
        },
        connectHook(delivery, options, callback) {
            options.socket = createMockSocket({ remoteAddress: options.host });
            return callback();
        }
    });

    assert.strictEqual(connection.host, '192.0.2.1');
    assert.ok(calls.includes('async.example.com:MX'), 'The MX lookup should go through resolveAsync');
    assert.ok(calls.includes('mail.example.com:A'), 'Address lookups should go through it too');
    assert.ok(!calls.some(call => call.endsWith(':undefined')), 'Every lookup should name its record type');
});

test('resolveAsyncCoversTheMtaStsPolicyLookup', async () => {
    // The policy host is resolved before any MX record is considered, and it must use the
    // caller's resolver like everything else. Falling back to system DNS there would both
    // ignore the configuration and reach a different answer than the rest of the delivery.
    const calls = [];
    const records = {
        '_mta-sts.sts-async.example.com:TXT': [['v=STSv1; id=async1']],
        'mail.example.com:A': ['192.0.2.1']
    };

    const connection = await mxConnect({
        target: 'sts-async.example.com',
        mx: ['mail.example.com'],
        mtaSts: { enabled: true },
        dnsOptions: {
            resolveAsync(domain, type) {
                calls.push(`${domain}:${type}`);
                const answer = records[`${domain}:${type}`];
                if (!answer) {
                    const err = new Error('ENOTFOUND');
                    err.code = 'ENOTFOUND';
                    throw err;
                }
                return answer;
            }
        },
        connectHook(delivery, options, callback) {
            options.socket = createMockSocket({ remoteAddress: options.host });
            return callback();
        }
    });

    assert.ok(connection.socket);
    assert.ok(calls.includes('_mta-sts.sts-async.example.com:TXT'), 'The policy TXT lookup should use resolveAsync');
    assert.ok(
        calls.some(call => call.startsWith('mta-sts.sts-async.example.com:')),
        'The policy host lookup should use resolveAsync'
    );
});

test('legacyResolveStillWorksAlongsideTheNewOption', async () => {
    // The callback form keeps working untouched, including its two-argument A lookups
    const arities = [];
    const connection = await mxConnect({
        target: 'legacy.example.com',
        dnsOptions: {
            resolve(domain, typeOrCallback, maybeCallback) {
                const twoArgForm = typeof typeOrCallback === 'function';
                const type = twoArgForm ? 'A' : typeOrCallback;
                const callback = twoArgForm ? typeOrCallback : maybeCallback;
                arities.push({ type, args: twoArgForm ? 2 : 3 });

                if (type === 'MX') {
                    return setImmediate(() => callback(null, [{ exchange: 'mail.example.com', priority: 10 }]));
                }
                if (type === 'A') {
                    return setImmediate(() => callback(null, ['192.0.2.3']));
                }
                const err = new Error('ENODATA');
                err.code = 'ENODATA';
                return setImmediate(() => callback(err));
            }
        },
        connectHook(delivery, options, callback) {
            options.socket = createMockSocket({ remoteAddress: options.host });
            return callback();
        }
    });

    assert.strictEqual(connection.host, '192.0.2.3');
    assert.ok(
        arities.some(call => call.type === 'A' && call.args === 2),
        'A lookups must keep using the two-argument callback form'
    );
    assert.ok(
        arities.some(call => call.type === 'MX' && call.args === 3),
        'Other record types keep the three-argument form'
    );
});
