/* eslint no-console: 0*/

'use strict';

const mxConnect = require('../lib/mx-connect');
const { createMockSocket } = require('./test-utils');

/**
 * Test: DNSSEC-secure zone proceeds to TLSA lookup
 *
 * When checkDnssecSecure reports { secure: true }, the TLSA resolver
 * should be called as normal.
 */
module.exports.dnssecSecureZoneProceedsToTlsa = test => {
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
            test.ifError(err);
            test.ok(connection, 'Connection should exist');
            test.ok(connection.socket, 'Connection should have socket');
            test.ok(tlsaLookupCalled, 'resolveTlsa should be called when zone is DNSSEC-secure');
            test.done();
        }
    );
};

/**
 * Test: Insecure zone skips TLSA lookup
 *
 * When checkDnssecSecure reports { secure: false }, the TLSA resolver
 * should NOT be called and the connection should proceed with
 * opportunistic TLS (empty tlsaRecords).
 */
module.exports.insecureZoneSkipsTlsa = test => {
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
            test.ifError(err);
            test.ok(connection, 'Connection should exist');
            test.ok(connection.socket, 'Connection should have socket');
            test.ok(!tlsaLookupCalled, 'resolveTlsa should NOT be called when zone is insecure');

            // Verify that the skip was logged
            const skipLog = logMessages.find(log => log.msg && log.msg.includes('Skipping TLSA lookup for insecure'));
            test.ok(skipLog, 'Should log that TLSA lookup was skipped for insecure zone');
            test.equal(skipLog.hostname, 'mail.eo.outlook.com', 'Log should include the MX hostname');

            test.done();
        }
    );
};

/**
 * Test: checkDnssecSecure failure assumes insecure (safe default)
 *
 * When checkDnssecSecure throws an error, the zone should be treated
 * as insecure and TLSA lookups should be skipped. This is the safe
 * default to avoid SERVFAIL-induced delivery failures.
 */
module.exports.dnssecCheckFailureAssumesInsecure = test => {
    let tlsaLookupCalled = false;
    let logMessages = [];

    const mockResolveTlsa = async () => {
        tlsaLookupCalled = true;
        return [];
    };

    const mockCheckDnssecSecure = async () => {
        const err = new Error('DNS resolution failed');
        err.code = 'ESERVFAIL';
        throw err;
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
            test.ifError(err);
            test.ok(connection, 'Connection should exist');
            test.ok(connection.socket, 'Connection should have socket');
            test.ok(!tlsaLookupCalled, 'resolveTlsa should NOT be called when DNSSEC check fails');

            // Verify that the failure was logged
            const failLog = logMessages.find(log => log.msg && log.msg.includes('DNSSEC status check failed'));
            test.ok(failLog, 'Should log that DNSSEC check failed');
            test.equal(failLog.code, 'ESERVFAIL', 'Log should include the error code');

            test.done();
        }
    );
};

/**
 * Test: Without checkDnssecSecure, TLSA lookup proceeds as normal
 *
 * When checkDnssecSecure is not provided, the existing behavior should
 * be preserved: TLSA lookups are attempted for all MX hosts.
 */
module.exports.withoutCheckDnssecSecureTlsaProceeds = test => {
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
            test.ifError(err);
            test.ok(connection, 'Connection should exist');
            test.ok(connection.socket, 'Connection should have socket');
            test.ok(tlsaLookupCalled, 'resolveTlsa should be called when checkDnssecSecure is not provided');
            test.done();
        }
    );
};

/**
 * Test: checkDnssecSecure receives the correct MX hostname
 *
 * Verifies that the callback receives the MX exchange hostname,
 * not the target domain or TLSA query name.
 */
module.exports.checkDnssecSecureReceivesCorrectHostname = test => {
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
            test.ifError(err);
            test.ok(connection, 'Connection should exist');
            test.equal(receivedHostname, 'mx1.secure-provider.com', 'checkDnssecSecure should receive the MX exchange hostname');
            test.done();
        }
    );
};

/**
 * Test: Multiple MX hosts with mixed DNSSEC status
 *
 * When multiple MX hosts are provided, checkDnssecSecure should be
 * called for each one independently. Secure hosts get TLSA lookups,
 * insecure hosts skip them.
 */
module.exports.multipleMxHostsMixedDnssecStatus = test => {
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
            test.ifError(err);
            test.ok(connection, 'Connection should exist');

            // Both hosts should have been checked for DNSSEC status
            test.equal(dnssecCheckHostnames.length, 2, 'Should check DNSSEC status for both MX hosts');
            test.ok(dnssecCheckHostnames.includes('mx1.secure.com'), 'Should check mx1.secure.com');
            test.ok(dnssecCheckHostnames.includes('mx2.insecure.com'), 'Should check mx2.insecure.com');

            // Only the secure host should have had TLSA lookup
            test.equal(tlsaLookupHostnames.length, 1, 'Should only perform TLSA lookup for secure host');
            test.equal(tlsaLookupHostnames[0], 'mx1.secure.com', 'TLSA lookup should be for the secure host');

            test.done();
        }
    );
};

/**
 * Test: checkDnssecSecure returning null/undefined is treated as insecure
 *
 * Edge case: if the callback returns a falsy value instead of { secure: false },
 * it should still be treated as insecure.
 */
module.exports.dnssecCheckReturningNullTreatedAsInsecure = test => {
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
            test.ifError(err);
            test.ok(connection, 'Connection should exist');
            test.ok(!tlsaLookupCalled, 'resolveTlsa should NOT be called when checkDnssecSecure returns null');
            test.done();
        }
    );
};

/**
 * Test: Pre-resolved TLSA records bypass DNSSEC check
 *
 * When MX entries already have tlsaRecords, the checkDnssecSecure
 * callback should not be called for those entries.
 */
module.exports.preResolvedTlsaBypassesDnssecCheck = test => {
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
            test.ifError(err);
            test.ok(connection, 'Connection should exist');
            test.ok(!dnssecCheckCalled, 'checkDnssecSecure should NOT be called when TLSA records are pre-resolved');
            test.ok(connection.tlsaRecords, 'Connection should have pre-resolved TLSA records');
            test.equal(connection.tlsaRecords.length, 1, 'Should have 1 pre-resolved TLSA record');
            test.done();
        }
    );
};
