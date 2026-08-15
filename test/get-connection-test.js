'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const net = require('net');
const EventEmitter = require('events');
const getConnection = require('../lib/get-connection');
const {
    createMockConnectHook,
    createFailingConnectHook,
    createTrackingConnectHook,
    startServer,
    startGreetingServer,
    readGreeting,
    closeServer,
    getFreePort
} = require('./test-utils');

/**
 * Temporarily replaces net.connect with a stub factory for deterministic
 * socket behavior (timeouts, errors) without real network activity.
 * Returns a restore function that must be called in a finally block.
 */
function stubNetConnect(factory) {
    const original = net.connect;
    net.connect = factory;
    return () => {
        net.connect = original;
    };
}

/**
 * A socket stub that refuses the connection on the next tick. This is how the retry path is
 * driven without touching the network, and it counts its own destroy calls so a test can
 * assert the handle was released.
 */
function refusingSocket() {
    const socket = new EventEmitter();
    socket.destroyCount = 0;
    socket.destroy = () => socket.destroyCount++;
    setImmediate(() => {
        const err = new Error('connection refused');
        err.code = 'ECONNREFUSED';
        socket.emit('error', err);
    });
    return socket;
}

test('noMxHosts', async () => {
    await assert.rejects(
        getConnection({
            domain: 'empty.example.com',
            decodedDomain: 'empty.example.com',
            mx: []
        }),
        err => {
            assert.strictEqual(err.category, 'dns');
            assert.ok(err.message.includes('No Mail Exchange'));
            return true;
        }
    );
});

test('noValidAddresses', async () => {
    // MX entries exist but have no resolvable IP addresses
    await assert.rejects(
        getConnection({
            domain: 'noips.example.com',
            decodedDomain: 'noips.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: [] }]
        }),
        err => {
            assert.strictEqual(err.category, 'dns');
            assert.ok(err.message.includes('No Mail Exchange'));
            return true;
        }
    );
});

test('ipv6OnlyMx', async () => {
    const { hook, connections } = createTrackingConnectHook();

    await getConnection({
        domain: 'ipv6only.example.com',
        decodedDomain: 'ipv6only.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: ['2001:db8::1'] }],
        connectHook: hook
    });
    assert.strictEqual(connections[0].host, '2001:db8::1');
});

test('ipv4Default', async () => {
    const { hook, connections } = createTrackingConnectHook();

    await getConnection({
        domain: 'dual.example.com',
        decodedDomain: 'dual.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: ['2001:db8::1'] }],
        connectHook: hook
    });
    assert.strictEqual(connections[0].host, '192.0.2.1');
});

test('preferIPv6', async () => {
    const { hook, connections } = createTrackingConnectHook();

    await getConnection({
        domain: 'dual.example.com',
        decodedDomain: 'dual.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: ['2001:db8::1'] }],
        dnsOptions: { preferIPv6: true },
        connectHook: hook
    });
    assert.strictEqual(connections[0].host, '2001:db8::1');
});

test('hookWithSocket', async () => {
    const mockHook = createMockConnectHook({
        localAddress: '10.0.0.1',
        localPort: 12345,
        remoteAddress: '192.0.2.1'
    });

    const connection = await getConnection({
        domain: 'test.example.com',
        decodedDomain: 'test.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
        connectHook: mockHook
    });
    assert.ok(connection.socket);
    assert.strictEqual(connection.localAddress, '10.0.0.1');
    assert.strictEqual(connection.localPort, 12345);
});

test('priorityOrdering', async () => {
    const { hook, connections } = createTrackingConnectHook();

    const connection = await getConnection({
        domain: 'multi.example.com',
        decodedDomain: 'multi.example.com',
        mx: [
            { exchange: 'backup.example.com', priority: 20, A: ['192.0.2.2'], AAAA: [] },
            { exchange: 'primary.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] },
            { exchange: 'tertiary.example.com', priority: 30, A: ['192.0.2.3'], AAAA: [] }
        ],
        connectHook: hook
    });
    assert.strictEqual(connections[0].host, '192.0.2.1');
    assert.strictEqual(connection.host, '192.0.2.1');
});

test('ignoreMxHosts', async () => {
    const { hook, connections } = createTrackingConnectHook();

    await getConnection({
        domain: 'filter.example.com',
        decodedDomain: 'filter.example.com',
        mx: [
            { exchange: 'primary.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] },
            { exchange: 'backup.example.com', priority: 20, A: ['192.0.2.2'], AAAA: [] }
        ],
        ignoreMXHosts: ['192.0.2.1'],
        connectHook: hook
    });
    assert.strictEqual(connections[0].host, '192.0.2.2');
});

test('connectHookError', async () => {
    // connectHook errors reject the entire promise immediately
    const hookError = new Error('Hook rejected connection');
    hookError.code = 'HOOK_ERROR';
    const { hook } = createFailingConnectHook(hookError);

    await assert.rejects(
        getConnection({
            domain: 'hookfail.example.com',
            decodedDomain: 'hookfail.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            connectHook: hook
        }),
        err => {
            assert.ok(err.message.includes('Hook rejected'));
            return true;
        }
    );
});

test('connectHookErrorStopsRetry', async () => {
    // A hook error is fatal: remaining hosts must not be attempted
    const { hook, attempts } = createFailingConnectHook(new Error('Hook rejected connection'));

    await assert.rejects(
        getConnection({
            domain: 'hookfatal.example.com',
            decodedDomain: 'hookfatal.example.com',
            mx: [
                { exchange: 'primary.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] },
                { exchange: 'backup.example.com', priority: 20, A: ['192.0.2.2'], AAAA: [] }
            ],
            connectHook: hook
        }),
        err => {
            assert.ok(err.message.includes('Hook rejected'));
            assert.strictEqual(attempts.length, 1, 'Fatal hook error must not retry the next host');
            return true;
        }
    );
});

test('customPort', async () => {
    const { hook, connections } = createTrackingConnectHook();

    await getConnection({
        domain: 'test.example.com',
        decodedDomain: 'test.example.com',
        port: 587,
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
        connectHook: hook
    });
    assert.strictEqual(connections[0].port, 587);
});

test('deduplicateHosts', async () => {
    const { hook, connections } = createTrackingConnectHook();

    await getConnection({
        domain: 'dedup.example.com',
        decodedDomain: 'dedup.example.com',
        mx: [
            { exchange: 'mx1.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] },
            { exchange: 'mx2.example.com', priority: 20, A: ['192.0.2.1'], AAAA: [] }
        ],
        connectHook: hook
    });
    assert.strictEqual(connections.length, 1);
});

test('mtaStsEnforceRejects', async () => {
    // Policy failure in enforce mode must reject without attempting a connection
    const { hook, connections } = createTrackingConnectHook();
    const logEntries = [];

    await assert.rejects(
        getConnection({
            domain: 'sts.example.com',
            decodedDomain: 'sts.example.com',
            mx: [
                {
                    exchange: 'rogue.example.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: [],
                    policyMatch: { valid: false, testing: false, mode: 'enforce' }
                }
            ],
            mtaSts: { logger: entry => logEntries.push(entry) },
            connectHook: hook
        }),
        err => {
            assert.strictEqual(err.category, 'policy');
            assert.strictEqual(connections.length, 0, 'Must not connect to a host that fails an enforced policy');
            assert.ok(
                logEntries.some(entry => entry.success === false),
                'Policy failure should be logged'
            );
            return true;
        }
    );
});

test('mtaStsTestingModeConnects', async () => {
    // Policy failure in testing mode is logged but the connection proceeds
    const { hook, connections } = createTrackingConnectHook();
    const logEntries = [];

    const connection = await getConnection({
        domain: 'sts-testing.example.com',
        decodedDomain: 'sts-testing.example.com',
        mx: [
            {
                exchange: 'rogue.example.com',
                priority: 10,
                A: ['192.0.2.1'],
                AAAA: [],
                policyMatch: { valid: false, testing: true, mode: 'testing' }
            }
        ],
        mtaSts: { logger: entry => logEntries.push(entry) },
        connectHook: hook
    });
    assert.ok(connection.socket);
    assert.strictEqual(connections.length, 1);
    assert.ok(
        logEntries.some(entry => entry.success === false),
        'Policy failure should still be logged in testing mode'
    );
});

test('daneLookupFailureRejects', async () => {
    // A failed TLSA/DNSSEC lookup must fail closed with a temporary error
    const { hook, connections } = createTrackingConnectHook();
    const logEntries = [];

    await assert.rejects(
        getConnection({
            domain: 'dane.example.com',
            decodedDomain: 'dane.example.com',
            mx: [
                {
                    exchange: 'mail.example.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: [],
                    daneLookupFailed: true,
                    daneLookupError: new Error('TLSA query SERVFAIL')
                }
            ],
            dane: { enabled: true, logger: entry => logEntries.push(entry) },
            connectHook: hook
        }),
        err => {
            assert.strictEqual(err.category, 'dane');
            assert.ok(err.temporary, 'DANE lookup failure must be temporary so delivery is retried');
            assert.strictEqual(connections.length, 0, 'Must not connect when the DANE status is unknown');
            assert.ok(
                logEntries.some(entry => entry.success === false),
                'DANE rejection should be logged'
            );
            return true;
        }
    );
});

test('daneVerifierSetup', async () => {
    // TLSA records present: connection result carries the DANE verifier and requires TLS
    const { hook } = createTrackingConnectHook();

    const connection = await getConnection({
        domain: 'dane-ok.example.com',
        decodedDomain: 'dane-ok.example.com',
        mx: [
            {
                exchange: 'mail.example.com',
                priority: 10,
                A: ['192.0.2.1'],
                AAAA: [],
                tlsaRecords: [{ usage: 3, selector: 1, mtype: 1, cert: Buffer.alloc(32) }]
            }
        ],
        dane: { enabled: true },
        connectHook: hook
    });
    assert.ok(connection.daneEnabled);
    assert.ok(connection.requireTls);
    assert.strictEqual(typeof connection.daneVerifier, 'function');
    assert.strictEqual(connection.tlsaRecords.length, 1);
});

test('retryFallsBackToNextHost', async () => {
    // First host refuses the TCP connection (nothing listens on [::1]:port),
    // so the next host in priority order must be attempted and succeed
    const server = await startServer();
    const port = server.address().port;
    const connectErrors = [];

    const connection = await getConnection({
        domain: 'retry.example.com',
        decodedDomain: 'retry.example.com',
        port,
        mx: [
            { exchange: 'unreachable.example.com', priority: 10, A: [], AAAA: ['::1'] },
            { exchange: 'reachable.example.com', priority: 20, A: ['127.0.0.1'], AAAA: [] }
        ],
        connectError: err => connectErrors.push(err)
    });
    assert.strictEqual(connection.host, '127.0.0.1');
    assert.ok(connection.socket);
    assert.strictEqual(connectErrors.length, 1, 'The failed attempt should be reported via connectError');
    assert.strictEqual(connectErrors[0].category, 'network');
    assert.ok(connectErrors[0].temporary, 'Socket errors must be temporary');
    connection.socket.destroy();

    await closeServer(server);
});

test('connectTimeout', async () => {
    // A socket that never connects must be timed out, destroyed, and reported
    // as a temporary network error
    const sockets = [];
    const restore = stubNetConnect(() => {
        const socket = new EventEmitter();
        socket.destroyCount = 0;
        socket.destroy = () => socket.destroyCount++;
        sockets.push(socket);
        return socket;
    });

    try {
        await assert.rejects(
            getConnection({
                domain: 'timeout.example.com',
                decodedDomain: 'timeout.example.com',
                maxConnectTime: 20,
                mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }]
            }),
            err => {
                assert.ok(err.message.includes('timed out'), 'Error should mention the timeout');
                assert.strictEqual(err.category, 'network');
                assert.ok(err.temporary, 'Timeouts must be temporary');
                assert.strictEqual(sockets.length, 1);
                assert.ok(sockets[0].destroyCount > 0, 'Timed out socket must be destroyed');
                return true;
            }
        );
    } finally {
        restore();
    }
});

test('lateConnectAfterTimeoutIsDestroyed', async () => {
    // If the TCP connection completes after the timeout already settled the
    // promise, the late socket must be destroyed instead of leaking
    let socket;
    let connectListener;
    const restore = stubNetConnect((options, listener) => {
        connectListener = listener;
        socket = new EventEmitter();
        socket.destroyCount = 0;
        socket.destroy = () => socket.destroyCount++;
        return socket;
    });

    try {
        await assert.rejects(
            getConnection({
                domain: 'late.example.com',
                decodedDomain: 'late.example.com',
                maxConnectTime: 10,
                mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }]
            }),
            err => {
                assert.ok(err.temporary);
                const destroyedByTimeout = socket.destroyCount;
                // Simulate the connection completing after the timeout fired
                connectListener();
                assert.ok(socket.destroyCount > destroyedByTimeout, 'Late socket must be destroyed, not leaked');
                return true;
            }
        );
    } finally {
        restore();
    }
});

test('duplicateSocketErrorsAreHandled', async () => {
    // A second error event after the first must not crash the process as an
    // unhandled 'error' event
    let socket;
    const restore = stubNetConnect(() => (socket = refusingSocket()));

    try {
        await assert.rejects(
            getConnection({
                domain: 'doubleerror.example.com',
                decodedDomain: 'doubleerror.example.com',
                mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }]
            }),
            err => {
                assert.strictEqual(err.category, 'network');
                // Emitting a second error would throw synchronously right here if the
                // socket had no listener left
                const second = new Error('late reset');
                second.code = 'ECONNRESET';
                socket.emit('error', second);
                assert.ok(true, 'Second socket error did not raise an uncaught exception');
                return true;
            }
        );
    } finally {
        restore();
    }
});

test('maxMxHostsCap', async () => {
    // Connection attempts must be capped at 20 hosts even when more are listed
    let attempts = 0;
    const restore = stubNetConnect(() => {
        attempts++;
        return refusingSocket();
    });

    const mx = [];
    for (let i = 1; i <= 25; i++) {
        mx.push({ exchange: `mx${i}.example.com`, priority: i, A: [`192.0.2.${i}`], AAAA: [] });
    }

    try {
        await assert.rejects(
            getConnection({
                domain: 'many.example.com',
                decodedDomain: 'many.example.com',
                mx
            }),
            err => {
                assert.strictEqual(err.category, 'network');
                assert.strictEqual(attempts, 20, 'Connection attempts must stop at the 20 host cap');
                return true;
            }
        );
    } finally {
        restore();
    }
});

test('allHostsIgnoredUsesMxLastError', async () => {
    // When ignoreMXHosts filters out every host, a provided mxLastError is
    // used as the rejection so the caller sees the original failure
    const lastError = new Error('previous delivery attempt failed');
    lastError.response = 'Network error: previous delivery attempt failed';
    lastError.category = 'network';

    await assert.rejects(
        getConnection({
            domain: 'ignored.example.com',
            decodedDomain: 'ignored.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            ignoreMXHosts: ['192.0.2.1'],
            mxLastError: lastError
        }),
        err => {
            assert.strictEqual(err, lastError, 'Rejection should be the provided mxLastError');
            return true;
        }
    );
});

test('allHostsIgnoredDefaultError', async () => {
    // Without mxLastError, filtering out every host produces a temporary
    // network error
    await assert.rejects(
        getConnection({
            domain: 'ignored2.example.com',
            decodedDomain: 'ignored2.example.com',
            mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
            ignoreMXHosts: ['192.0.2.1']
        }),
        err => {
            assert.strictEqual(err.category, 'network');
            assert.ok(err.temporary, 'Filtered-host failure must be temporary');
            assert.ok(err.message.includes('ignored2.example.com'));
            return true;
        }
    );
});

test('localAddressSelectionForIPv6', async () => {
    // With an IPv4 localAddress configured but an IPv6 target, the IPv6 local
    // address and hostname must be selected for the connection
    const { hook, connections } = createTrackingConnectHook();

    await getConnection({
        domain: 'v6select.example.com',
        decodedDomain: 'v6select.example.com',
        localAddress: '192.0.2.100',
        localAddressIPv6: '2001:db8::100',
        localHostnameIPv6: 'v6.local.example.com',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: [], AAAA: ['2001:db8::1'] }],
        connectHook: hook
    });
    assert.strictEqual(connections[0].host, '2001:db8::1');
    assert.strictEqual(connections[0].localAddress, '2001:db8::100');
    assert.strictEqual(connections[0].localHostname, 'v6.local.example.com');
});

test('allHostsFailPreservesFirstError', async () => {
    // When every host fails, the rejection must carry the first error encountered
    const port = await getFreePort();

    await assert.rejects(
        getConnection({
            domain: 'allfail.example.com',
            decodedDomain: 'allfail.example.com',
            port,
            mx: [
                { exchange: 'mx1.example.com', priority: 10, A: ['127.0.0.1'], AAAA: [] },
                { exchange: 'mx2.example.com', priority: 20, A: [], AAAA: ['::1'] }
            ]
        }),
        err => {
            assert.strictEqual(err.category, 'network');
            assert.ok(err.temporary);
            assert.ok(err.message.includes('mx1.example.com'), 'Rejection should preserve the first error');
            return true;
        }
    );
});

test('localAddressKeptForMatchingFamily', async () => {
    // When the configured localAddress already matches the target IP family it
    // must be used as-is, without switching to the per-family settings
    const { hook, connections } = createTrackingConnectHook();

    await getConnection({
        domain: 'v4keep.example.com',
        decodedDomain: 'v4keep.example.com',
        localAddress: '192.0.2.100',
        localAddressIPv4: '192.0.2.200',
        mx: [{ exchange: 'mail.example.com', priority: 10, A: ['192.0.2.1'], AAAA: [] }],
        connectHook: hook
    });
    assert.strictEqual(connections[0].localAddress, '192.0.2.100', 'Matching-family localAddress must be kept');
});

test('connectedSocketCarriesData', async () => {
    // The other socket tests assert that a connection was established; this one asserts the
    // socket is actually usable, by reading the greeting the listener sends. It runs against
    // a local listener rather than a real MX on port 25, which hosted CI runners block.
    const server = await startGreetingServer();
    const { port } = server.address();

    const delivery = await getConnection({
        domain: 'mx-connect.test',
        decodedDomain: 'mx-connect.test',
        port,
        mx: [{ exchange: 'mx-connect.test', priority: 10, A: ['127.0.0.1'], AAAA: [] }]
    });
    assert.ok(delivery.socket);
    assert.strictEqual(delivery.host, '127.0.0.1');
    assert.strictEqual(delivery.port, port);
    assert.strictEqual(delivery.hostname, 'mx-connect.test');

    const greeting = await readGreeting(delivery.socket);
    assert.ok(greeting.startsWith('220 '), 'The connected socket must carry the greeting');
    delivery.socket.destroy();

    await closeServer(server);
});
