/* eslint no-console: 0*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const mxConnect = require('../lib/mx-connect');
const { createMockSocket, createDnsError } = require('./test-utils');

/**
 * Test: DNSSEC-secure zone proceeds to TLSA lookup
 *
 * When checkDnssecSecure reports { secure: true }, the TLSA resolver
 * should be called as normal.
 */
test('dnssecSecureZoneProceedsToTlsa', (t, done) => {
    let tlsaLookupCalled = false;

    const mockResolveTlsa = async () => {
        tlsaLookupCalled = true;
        return [];
    };

    const mockCheckDnssecSecure = async () => ({ secure: true });

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
            dane: {
                enabled: true,
                resolveTlsa: mockResolveTlsa,
                checkDnssecSecure: mockCheckDnssecSecure,
                logger: () => {}
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');
            assert.ok(tlsaLookupCalled, 'resolveTlsa should be called when zone is DNSSEC-secure');
            done();
        }
    );
});

/**
 * Test: Insecure zone skips TLSA lookup
 *
 * When checkDnssecSecure reports { secure: false }, the TLSA resolver
 * should NOT be called and the connection should proceed with
 * opportunistic TLS (empty tlsaRecords).
 */
test('insecureZoneSkipsTlsa', (t, done) => {
    let tlsaLookupCalled = false;
    let logMessages = [];

    const mockResolveTlsa = async () => {
        tlsaLookupCalled = true;
        return [];
    };

    const mockCheckDnssecSecure = async () => ({ secure: false });

    mxConnect(
        {
            target: 'test.example.com',
            mx: [
                {
                    exchange: 'mail.eo.outlook.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: []
                }
            ],
            dane: {
                enabled: true,
                resolveTlsa: mockResolveTlsa,
                checkDnssecSecure: mockCheckDnssecSecure,
                logger: logObj => {
                    logMessages.push(logObj);
                }
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');
            assert.ok(!tlsaLookupCalled, 'resolveTlsa should NOT be called when zone is insecure');

            // Verify that the skip was logged
            const skipLog = logMessages.find(log => log.msg && log.msg.includes('Skipping TLSA lookup for insecure'));
            assert.ok(skipLog, 'Should log that TLSA lookup was skipped for insecure zone');
            assert.strictEqual(skipLog.hostname, 'mail.eo.outlook.com', 'Log should include the MX hostname');

            done();
        }
    );
});

/**
 * Test: checkDnssecSecure failure is a lookup failure, not "insecure"
 *
 * A DNS failure leaves the DNSSEC status unknown. Treating that as
 * "insecure" would skip the TLSA lookup and silently bypass DANE on a
 * transient error (e.g. a rate-limited resolver on a queue retry), so the
 * MX is marked as a DANE lookup failure and the connection is rejected
 * with a temporary error instead.
 */
function testDnssecCheckFailure(done, code) {
    let tlsaLookupCalled = false;
    let logMessages = [];

    const mockResolveTlsa = async () => {
        tlsaLookupCalled = true;
        return [];
    };

    const mockCheckDnssecSecure = async () => {
        throw createDnsError(code, `DNSSEC status lookup failed with ${code}`);
    };

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
            dane: {
                enabled: true,
                resolveTlsa: mockResolveTlsa,
                checkDnssecSecure: mockCheckDnssecSecure,
                logger: logObj => {
                    logMessages.push(logObj);
                }
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            assert.ok(err, `${code} from the DNSSEC check must not bypass DANE`);
            assert.ok(!connection, 'Connection should not exist');
            assert.strictEqual(err.category, 'dane', 'Error category should be dane');
            assert.ok(err.temporary, 'Error should be temporary so the message is retried');
            assert.ok(!tlsaLookupCalled, 'resolveTlsa should NOT be called when DNSSEC check fails');

            // Verify that the failure was logged
            const failLog = logMessages.find(log => log.msg && log.msg.includes('DNSSEC status check failed'));
            assert.ok(failLog, 'Should log that DNSSEC check failed');
            assert.strictEqual(failLog.code, code, 'Log should include the error code');

            done();
        }
    );
}

test('dnssecCheckFailureRejectsConnection', (t, done) => testDnssecCheckFailure(done, 'ESERVFAIL'));

//
// ENODATA/ENOTFOUND mean "no TLSA records" when they come from a TLSA lookup,
// but from the DNSSEC check they only mean the zone status is unknown. Folding
// them into the no-records case would reopen the DANE bypass.
//
test('dnssecCheckNoDataRejectsConnection', (t, done) => testDnssecCheckFailure(done, 'ENOTFOUND'));
test('dnssecCheckNxDomainRejectsConnection', (t, done) => testDnssecCheckFailure(done, 'ENODATA'));

/**
 * Test: Without checkDnssecSecure, TLSA lookup proceeds as normal
 *
 * When checkDnssecSecure is not provided, the existing behavior should
 * be preserved: TLSA lookups are attempted for all MX hosts.
 */
test('withoutCheckDnssecSecureTlsaProceeds', (t, done) => {
    let tlsaLookupCalled = false;

    const mockResolveTlsa = async () => {
        tlsaLookupCalled = true;
        return [];
    };

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
            dane: {
                enabled: true,
                resolveTlsa: mockResolveTlsa,
                // checkDnssecSecure intentionally not provided
                logger: () => {}
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');
            assert.ok(tlsaLookupCalled, 'resolveTlsa should be called when checkDnssecSecure is not provided');
            done();
        }
    );
});

/**
 * Test: checkDnssecSecure receives the correct MX hostname
 *
 * Verifies that the callback receives the MX exchange hostname,
 * not the target domain or TLSA query name.
 */
test('checkDnssecSecureReceivesCorrectHostname', (t, done) => {
    let receivedHostname = null;

    const mockResolveTlsa = async () => [];

    const mockCheckDnssecSecure = async hostname => {
        receivedHostname = hostname;
        return { secure: true };
    };

    mxConnect(
        {
            target: 'user@example.com',
            mx: [
                {
                    exchange: 'mx1.secure-provider.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: []
                }
            ],
            dane: {
                enabled: true,
                resolveTlsa: mockResolveTlsa,
                checkDnssecSecure: mockCheckDnssecSecure,
                logger: () => {}
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.strictEqual(receivedHostname, 'mx1.secure-provider.com', 'checkDnssecSecure should receive the MX exchange hostname');
            done();
        }
    );
});

/**
 * Test: Multiple MX hosts with mixed DNSSEC status
 *
 * When multiple MX hosts are provided, checkDnssecSecure should be
 * called for each one independently. Secure hosts get TLSA lookups,
 * insecure hosts skip them.
 */
test('multipleMxHostsMixedDnssecStatus', (t, done) => {
    let tlsaLookupHostnames = [];
    let dnssecCheckHostnames = [];

    const mockResolveTlsa = async tlsaName => {
        // Extract hostname from TLSA query name (e.g., _25._tcp.mail.example.com -> mail.example.com)
        const hostname = tlsaName.replace(/^_\d+\._tcp\./, '');
        tlsaLookupHostnames.push(hostname);
        return [];
    };

    const mockCheckDnssecSecure = async hostname => {
        dnssecCheckHostnames.push(hostname);
        // First host is secure, second is insecure
        if (hostname === 'mx1.secure.com') {
            return { secure: true };
        }
        return { secure: false };
    };

    mxConnect(
        {
            target: 'test.example.com',
            mx: [
                {
                    exchange: 'mx1.secure.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: []
                },
                {
                    exchange: 'mx2.insecure.com',
                    priority: 20,
                    A: ['192.0.2.2'],
                    AAAA: []
                }
            ],
            dane: {
                enabled: true,
                resolveTlsa: mockResolveTlsa,
                checkDnssecSecure: mockCheckDnssecSecure,
                logger: () => {}
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');

            // Both hosts should have been checked for DNSSEC status
            assert.strictEqual(dnssecCheckHostnames.length, 2, 'Should check DNSSEC status for both MX hosts');
            assert.ok(dnssecCheckHostnames.includes('mx1.secure.com'), 'Should check mx1.secure.com');
            assert.ok(dnssecCheckHostnames.includes('mx2.insecure.com'), 'Should check mx2.insecure.com');

            // Only the secure host should have had TLSA lookup
            assert.strictEqual(tlsaLookupHostnames.length, 1, 'Should only perform TLSA lookup for secure host');
            assert.strictEqual(tlsaLookupHostnames[0], 'mx1.secure.com', 'TLSA lookup should be for the secure host');

            done();
        }
    );
});

/**
 * Test: checkDnssecSecure returning null/undefined is treated as insecure
 *
 * Edge case: if the callback returns a falsy value instead of { secure: false },
 * it should still be treated as insecure.
 */
test('dnssecCheckReturningNullTreatedAsInsecure', (t, done) => {
    let tlsaLookupCalled = false;

    const mockResolveTlsa = async () => {
        tlsaLookupCalled = true;
        return [];
    };

    const mockCheckDnssecSecure = async () => null;

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
            dane: {
                enabled: true,
                resolveTlsa: mockResolveTlsa,
                checkDnssecSecure: mockCheckDnssecSecure,
                logger: () => {}
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(!tlsaLookupCalled, 'resolveTlsa should NOT be called when checkDnssecSecure returns null');
            done();
        }
    );
});

/**
 * Test: Pre-resolved TLSA records bypass DNSSEC check
 *
 * When MX entries already have tlsaRecords, the checkDnssecSecure
 * callback should not be called for those entries.
 */
test('preResolvedTlsaBypassesDnssecCheck', (t, done) => {
    let dnssecCheckCalled = false;

    const mockTlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: Buffer.alloc(32, 0xff)
        }
    ];

    const mockCheckDnssecSecure = async () => {
        dnssecCheckCalled = true;
        return { secure: true };
    };

    mxConnect(
        {
            target: 'test.example.com',
            mx: [
                {
                    exchange: 'mail.example.com',
                    priority: 10,
                    A: ['192.0.2.1'],
                    AAAA: [],
                    tlsaRecords: mockTlsaRecords
                }
            ],
            dane: {
                enabled: true,
                checkDnssecSecure: mockCheckDnssecSecure,
                logger: () => {}
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(!dnssecCheckCalled, 'checkDnssecSecure should NOT be called when TLSA records are pre-resolved');
            assert.ok(connection.tlsaRecords, 'Connection should have pre-resolved TLSA records');
            assert.strictEqual(connection.tlsaRecords.length, 1, 'Should have 1 pre-resolved TLSA record');
            done();
        }
    );
});
