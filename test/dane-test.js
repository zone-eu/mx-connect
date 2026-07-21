/* eslint no-console: 0*/

'use strict';

const mxConnect = require('../lib/mx-connect');
const dane = require('../lib/dane');
const nodeCrypto = require('crypto');
const { createMockSocket } = require('./test-utils');

/**
 * Test DANE module exports
 */
module.exports.daneModuleExports = test => {
    test.ok(dane.DANE_USAGE, 'DANE_USAGE should be exported');
    test.ok(dane.DANE_SELECTOR, 'DANE_SELECTOR should be exported');
    test.ok(dane.DANE_MATCHING_TYPE, 'DANE_MATCHING_TYPE should be exported');
    test.ok(dane.EMPTY_DANE_HANDLER, 'EMPTY_DANE_HANDLER should be exported');
    test.equal(typeof dane.hasNativeResolveTlsa, 'boolean', 'hasNativeResolveTlsa should be a boolean');
    test.equal(typeof dane.resolveTlsaRecords, 'function', 'resolveTlsaRecords should be a function');
    test.equal(typeof dane.verifyCertAgainstTlsa, 'function', 'verifyCertAgainstTlsa should be a function');
    test.equal(typeof dane.createDaneVerifier, 'function', 'createDaneVerifier should be a function');
    test.done();
};

/**
 * Test DANE usage constants
 */
module.exports.daneUsageConstants = test => {
    test.equal(dane.DANE_USAGE.PKIX_TA, 0, 'PKIX_TA should be 0');
    test.equal(dane.DANE_USAGE.PKIX_EE, 1, 'PKIX_EE should be 1');
    test.equal(dane.DANE_USAGE.DANE_TA, 2, 'DANE_TA should be 2');
    test.equal(dane.DANE_USAGE.DANE_EE, 3, 'DANE_EE should be 3');
    test.done();
};

/**
 * Test DANE selector constants
 */
module.exports.daneSelectorConstants = test => {
    test.equal(dane.DANE_SELECTOR.FULL_CERT, 0, 'FULL_CERT should be 0');
    test.equal(dane.DANE_SELECTOR.SPKI, 1, 'SPKI should be 1');
    test.done();
};

/**
 * Test DANE matching type constants
 */
module.exports.daneMatchingTypeConstants = test => {
    test.equal(dane.DANE_MATCHING_TYPE.FULL, 0, 'FULL should be 0');
    test.equal(dane.DANE_MATCHING_TYPE.SHA256, 1, 'SHA256 should be 1');
    test.equal(dane.DANE_MATCHING_TYPE.SHA512, 2, 'SHA512 should be 2');
    test.done();
};

/**
 * Test hashCertData function with SHA-256
 */
module.exports.hashCertDataSha256 = test => {
    const testData = Buffer.from('test certificate data');
    const expectedHash = nodeCrypto.createHash('sha256').update(testData).digest();
    const result = dane.hashCertData(testData, dane.DANE_MATCHING_TYPE.SHA256);
    test.ok(Buffer.isBuffer(result), 'Result should be a Buffer');
    test.ok(expectedHash.equals(result), 'SHA-256 hash should match');
    test.done();
};

/**
 * Test hashCertData function with SHA-512
 */
module.exports.hashCertDataSha512 = test => {
    const testData = Buffer.from('test certificate data');
    const expectedHash = nodeCrypto.createHash('sha512').update(testData).digest();
    const result = dane.hashCertData(testData, dane.DANE_MATCHING_TYPE.SHA512);
    test.ok(Buffer.isBuffer(result), 'Result should be a Buffer');
    test.ok(expectedHash.equals(result), 'SHA-512 hash should match');
    test.done();
};

/**
 * Test hashCertData function with full data (no hash)
 */
module.exports.hashCertDataFull = test => {
    const testData = Buffer.from('test certificate data');
    const result = dane.hashCertData(testData, dane.DANE_MATCHING_TYPE.FULL);
    test.ok(Buffer.isBuffer(result), 'Result should be a Buffer');
    test.ok(testData.equals(result), 'Full data should be returned unchanged');
    test.done();
};

/**
 * Test hashCertData with null input
 */
module.exports.hashCertDataNull = test => {
    const result = dane.hashCertData(null, dane.DANE_MATCHING_TYPE.SHA256);
    test.equal(result, null, 'Result should be null for null input');
    test.done();
};

/**
 * Test verifyCertAgainstTlsa with no records
 */
module.exports.verifyCertNoRecords = test => {
    const result = dane.verifyCertAgainstTlsa({}, []);
    test.equal(result.valid, true, 'Should be valid when no records exist');
    test.equal(result.noRecords, true, 'Should indicate no records');
    test.equal(result.matchedRecord, null, 'Should have no matched record');
    test.done();
};

/**
 * Test verifyCertAgainstTlsa with no certificate
 */
module.exports.verifyCertNoCert = test => {
    const tlsaRecords = [{ usage: 3, selector: 1, mtype: 1, cert: Buffer.alloc(32) }];
    const result = dane.verifyCertAgainstTlsa(null, tlsaRecords);
    test.equal(result.valid, false, 'Should be invalid when no certificate');
    test.ok(result.error, 'Should have an error message');
    test.done();
};

/**
 * Test createDaneVerifier returns a function
 */
module.exports.createDaneVerifierReturnsFunction = test => {
    const verifier = dane.createDaneVerifier([], {});
    test.equal(typeof verifier, 'function', 'Should return a function');
    test.done();
};

/**
 * Test createDaneVerifier with no records returns undefined (success)
 */
module.exports.createDaneVerifierNoRecords = test => {
    const verifier = dane.createDaneVerifier([], {});
    const result = verifier('example.com', {});
    test.equal(result, undefined, 'Should return undefined (success) when no records');
    test.done();
};

/**
 * Test EMPTY_DANE_HANDLER
 */
module.exports.emptyDaneHandler = async test => {
    test.equal(dane.EMPTY_DANE_HANDLER.enabled, false, 'Should be disabled by default');
    const records = await dane.EMPTY_DANE_HANDLER.resolveTlsa('test.example.com');
    test.deepEqual(records, [], 'Should return empty array');
    test.done();
};

/**
 * Test mx-connect exports DANE module
 */
module.exports.mxConnectExportsDane = test => {
    test.ok(mxConnect.dane, 'mx-connect should export dane module');
    test.equal(typeof mxConnect.dane.resolveTlsaRecords, 'function', 'Should export resolveTlsaRecords');
    test.equal(typeof mxConnect.dane.verifyCertAgainstTlsa, 'function', 'Should export verifyCertAgainstTlsa');
    test.done();
};

/**
 * Test DANE with custom resolver using mock socket
 */
module.exports.daneWithCustomResolver = test => {
    let tlsaLookupCalled = false;

    const mockResolveTlsa = async () => {
        tlsaLookupCalled = true;
        // Return empty array to simulate no DANE records
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
            test.ok(tlsaLookupCalled, 'Custom resolveTlsa should have been called');
            test.done();
        }
    );
};

/**
 * Test DANE with custom resolver returning TLSA records
 */
module.exports.daneWithTlsaRecords = test => {
    let logMessages = [];

    // Mock TLSA records (these won't match the actual certificate, but tests the flow)
    const mockTlsaRecords = [
        {
            usage: 3, // DANE-EE
            selector: 1, // SPKI
            mtype: 1, // SHA-256
            cert: Buffer.alloc(32, 0xff), // Fake hash
            ttl: 3600
        }
    ];

    const mockResolveTlsa = async () => mockTlsaRecords;

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

            // Check that TLSA records were found
            const tlsaFoundLog = logMessages.find(log => log.msg === 'TLSA records found');
            test.ok(tlsaFoundLog, 'Should log TLSA records found');
            test.equal(tlsaFoundLog.recordCount, 1, 'Should have 1 TLSA record');

            // Check that DANE was enabled for connection
            const daneEnabledLog = logMessages.find(log => log.msg === 'DANE enabled for connection');
            test.ok(daneEnabledLog, 'Should log DANE enabled for connection');

            // Check connection has DANE properties
            test.ok(connection.daneEnabled, 'Connection should have daneEnabled flag');
            test.ok(connection.tlsaRecords, 'Connection should have tlsaRecords');
            test.equal(connection.tlsaRecords.length, 1, 'Should have 1 TLSA record');

            test.done();
        }
    );
};

/**
 * Test DANE with resolver that throws error (verify mode rejects connection)
 */
module.exports.daneResolverError = test => {
    const mockResolveTlsa = async () => {
        const err = new Error('DNS lookup failed');
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
                logger: () => {}
            },
            connectHook(delivery, options, callback) {
                options.socket = createMockSocket({ remoteAddress: options.host });
                return callback();
            }
        },
        (err, connection) => {
            test.ok(err, 'Should return an error when DANE lookup fails in verify mode');
            test.ok(!connection, 'Connection should not exist');
            test.ok(err.message.includes('DANE TLSA lookup failed'), 'Error should mention DANE lookup failure');
            test.equal(err.category, 'dane', 'Error category should be dane');
            test.done();
        }
    );
};

/**
 * Test that verify:false no longer bypasses DANE enforcement (RFC 7672) and
 * that passing it logs a deprecation notice
 */
module.exports.daneResolverErrorVerifyFalseStillEnforced = test => {
    let logMessages = [];

    const mockResolveTlsa = async () => {
        const err = new Error('DNS lookup failed');
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
                verify: false,
                resolveTlsa: mockResolveTlsa,
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
            test.ok(err, 'verify:false must not bypass DANE enforcement');
            test.ok(!connection, 'Connection should not exist');
            test.equal(err.category, 'dane', 'Error category should be dane');

            const deprecationLog = logMessages.find(log => log.msg && log.msg.includes('dane.verify option is deprecated'));
            test.ok(deprecationLog, 'Should log a deprecation notice for verify:false');

            const failLog = logMessages.find(log => log.msg === 'TLSA lookup failed');
            test.ok(failLog, 'Should log TLSA lookup failure');
            test.ok(failLog.error, 'Should include error message');

            test.done();
        }
    );
};

/**
 * Test DANE with NODATA response (no records exist)
 */
module.exports.daneNoDataResponse = test => {
    const mockResolveTlsa = async () => {
        const err = new Error('No data');
        err.code = 'ENODATA';
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
            // Should succeed - NODATA means no DANE records, not an error
            test.done();
        }
    );
};

/**
 * Test DANE explicitly disabled
 */
module.exports.daneExplicitlyDisabled = test => {
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
                enabled: false,
                resolveTlsa: mockResolveTlsa
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
            test.ok(!tlsaLookupCalled, 'resolveTlsa should not be called when DANE is disabled');
            test.done();
        }
    );
};

/**
 * Test resolveTlsaRecords with custom resolver
 */
module.exports.resolveTlsaRecordsCustomResolver = async test => {
    const mockRecords = [{ usage: 3, selector: 1, mtype: 1, cert: Buffer.alloc(32) }];
    const mockResolver = async tlsaName => {
        test.equal(tlsaName, '_25._tcp.mail.example.com', 'Should format TLSA name correctly');
        return mockRecords;
    };

    const records = await dane.resolveTlsaRecords('mail.example.com', 25, { resolveTlsa: mockResolver });
    test.deepEqual(records, mockRecords, 'Should return records from custom resolver');
    test.done();
};

/**
 * Test resolveTlsaRecords handles ENODATA gracefully
 */
module.exports.resolveTlsaRecordsNoData = async test => {
    const mockResolver = async () => {
        const err = new Error('No data');
        err.code = 'ENODATA';
        throw err;
    };

    const records = await dane.resolveTlsaRecords('mail.example.com', 25, { resolveTlsa: mockResolver });
    test.deepEqual(records, [], 'Should return empty array for ENODATA');
    test.done();
};

/**
 * Test resolveTlsaRecords handles ENOTFOUND gracefully
 */
module.exports.resolveTlsaRecordsNotFound = async test => {
    const mockResolver = async () => {
        const err = new Error('Not found');
        err.code = 'ENOTFOUND';
        throw err;
    };

    const records = await dane.resolveTlsaRecords('mail.example.com', 25, { resolveTlsa: mockResolver });
    test.deepEqual(records, [], 'Should return empty array for ENOTFOUND');
    test.done();
};

/**
 * Test resolveTlsaRecords propagates other errors
 */
module.exports.resolveTlsaRecordsOtherError = async test => {
    const mockResolver = async () => {
        const err = new Error('Server failure');
        err.code = 'ESERVFAIL';
        throw err;
    };

    try {
        await dane.resolveTlsaRecords('mail.example.com', 25, { resolveTlsa: mockResolver });
        test.ok(false, 'Should have thrown an error');
    } catch (err) {
        test.equal(err.code, 'ESERVFAIL', 'Should propagate non-NODATA errors');
    }
    test.done();
};

/**
 * Test hasNativeResolveTlsa detection
 */
module.exports.hasNativeResolveTlsaDetection = test => {
    const dns = require('dns');
    const expected = typeof dns.resolveTlsa === 'function';
    test.equal(dane.hasNativeResolveTlsa, expected, 'hasNativeResolveTlsa should match actual dns module');
    test.done();
};

/**
 * Test DANE with pre-resolved MX that includes TLSA records
 */
module.exports.daneWithPreresolvedMx = test => {
    let logMessages = [];

    const mockTlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: Buffer.alloc(32, 0xaa)
        }
    ];

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

            // TLSA records should be passed through from pre-resolved MX
            test.ok(connection.tlsaRecords, 'Connection should have tlsaRecords');
            test.equal(connection.tlsaRecords.length, 1, 'Should have 1 TLSA record');

            test.done();
        }
    );
};

/**
 * Test DANE stays disabled without explicit enabled:true
 */
module.exports.daneAutoDetectNoResolver = test => {
    let tlsaLookupCalled = false;

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
                // enabled not set - should default to false
                resolveTlsa: async () => {
                    tlsaLookupCalled = true;
                    return [];
                },
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
            test.ok(!tlsaLookupCalled, 'resolveTlsa should not be called when enabled is not set');
            test.done();
        }
    );
};

/**
 * Test extractSPKI with malformed certificate (Issue #1)
 */
module.exports.extractSPKIMalformedCert = test => {
    // Test with null
    let result = dane.extractSPKI(null);
    test.equal(result, null, 'Should return null for null certificate');

    // Test with empty object
    result = dane.extractSPKI({});
    test.equal(result, null, 'Should return null for empty certificate');

    // Test with invalid publicKey
    result = dane.extractSPKI({ publicKey: 'invalid-key-data' });
    test.equal(result, null, 'Should return null for invalid publicKey');

    // Test with malformed publicKey buffer
    result = dane.extractSPKI({ publicKey: Buffer.from('invalid') });
    test.equal(result, null, 'Should return null for malformed publicKey buffer');

    test.done();
};

/**
 * Test getCertData with malformed certificate (Issue #2)
 */
module.exports.getCertDataMalformedCert = test => {
    // Test with null
    let result = dane.getCertData(null, dane.DANE_SELECTOR.FULL_CERT);
    test.equal(result, null, 'Should return null for null certificate');

    // Test with empty object (no raw property)
    result = dane.getCertData({}, dane.DANE_SELECTOR.FULL_CERT);
    test.equal(result, null, 'Should return null for certificate without raw');

    // Test with SPKI selector on malformed cert
    result = dane.getCertData({ publicKey: 'invalid' }, dane.DANE_SELECTOR.SPKI);
    test.equal(result, null, 'Should return null for malformed certificate with SPKI selector');

    test.done();
};

/**
 * Test verifyCertAgainstTlsa with malformed TLSA records (Issue #4)
 */
module.exports.verifyCertMalformedTlsaRecords = test => {
    const mockCert = {
        raw: Buffer.from('test-cert-data'),
        publicKey: null
    };

    // Test with record missing cert field
    const recordsNoCert = [{ usage: 3, selector: 0, mtype: 1 }];
    let result = dane.verifyCertAgainstTlsa(mockCert, recordsNoCert);
    test.equal(result.valid, false, 'Should be invalid when record has no cert field');

    // Test with invalid usage value (should not crash)
    const recordsInvalidUsage = [{ usage: 99, selector: 0, mtype: 1, cert: Buffer.alloc(32) }];
    result = dane.verifyCertAgainstTlsa(mockCert, recordsInvalidUsage);
    test.equal(result.valid, false, 'Should be invalid for unknown usage type');

    // Test with invalid selector value (should not crash)
    const recordsInvalidSelector = [{ usage: 3, selector: 99, mtype: 1, cert: Buffer.alloc(32) }];
    result = dane.verifyCertAgainstTlsa(mockCert, recordsInvalidSelector);
    test.equal(result.valid, false, 'Should be invalid for unknown selector');

    test.done();
};

/**
 * Test createDaneVerifier catches exceptions (Issue #1, #2, #4)
 */
module.exports.createDaneVerifierCatchesExceptions = test => {
    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: Buffer.alloc(32, 0xff)
        }
    ];

    const verifier = dane.createDaneVerifier(tlsaRecords, { verify: true });

    // Test with malformed certificate - should not throw
    let result;
    try {
        result = verifier('example.com', { publicKey: 'invalid' });
        test.ok(true, 'Should not throw for malformed certificate');
    } catch (err) {
        test.ok(false, 'Should not throw exception: ' + err.message);
    }

    // Result should be an error (verification failed), not an exception
    test.ok(result instanceof Error || result === undefined, 'Should return error or undefined, not throw');

    test.done();
};

/**
 * Test isNoRecordsError helper function
 */
module.exports.isNoRecordsErrorHelper = test => {
    test.ok(dane.isNoRecordsError, 'isNoRecordsError should be exported');
    test.equal(dane.isNoRecordsError('ENODATA'), true, 'ENODATA should be a no-records error');
    test.equal(dane.isNoRecordsError('ENOTFOUND'), true, 'ENOTFOUND should be a no-records error');
    test.equal(dane.isNoRecordsError('ENOENT'), true, 'ENOENT should be a no-records error');
    test.equal(dane.isNoRecordsError('ESERVFAIL'), false, 'ESERVFAIL should not be a no-records error');
    test.equal(dane.isNoRecordsError('ETIMEDOUT'), false, 'ETIMEDOUT should not be a no-records error');
    test.equal(dane.isNoRecordsError(undefined), false, 'undefined should not be a no-records error');
    test.done();
};

/**
 * Test hasNativePromiseResolveTlsa detection
 */
module.exports.hasNativePromiseResolveTlsaDetection = test => {
    const dns = require('dns');
    const expected = dns.promises && typeof dns.promises.resolveTlsa === 'function';
    test.equal(dane.hasNativePromiseResolveTlsa, expected, 'hasNativePromiseResolveTlsa should match actual dns.promises module');
    test.done();
};

/**
 * Test verifyCertAgainstTlsa with DANE-TA without chain (Issue #3)
 */
module.exports.verifyCertDaneTaWithoutChain = test => {
    const mockCert = {
        raw: Buffer.from('test-cert-data'),
        publicKey: null
    };

    // DANE-TA record without chain should fail with informative error
    const daneTeRecords = [
        {
            usage: 2, // DANE-TA
            selector: 0,
            mtype: 1,
            cert: Buffer.alloc(32, 0xaa)
        }
    ];

    const result = dane.verifyCertAgainstTlsa(mockCert, daneTeRecords);
    test.equal(result.valid, false, 'Should be invalid when DANE-TA has no chain');
    test.ok(result.error, 'Should have error message');
    test.ok(result.error.includes('chain'), 'Error should mention chain requirement');

    test.done();
};

/**
 * Test verifyCertAgainstTlsa with PKIX-TA without chain (Issue #3)
 */
module.exports.verifyCertPkixTaWithoutChain = test => {
    const mockCert = {
        raw: Buffer.from('test-cert-data'),
        publicKey: null
    };

    // PKIX-TA record without chain should fail with informative error
    const pkixTaRecords = [
        {
            usage: 0, // PKIX-TA
            selector: 0,
            mtype: 1,
            cert: Buffer.alloc(32, 0xaa)
        }
    ];

    const result = dane.verifyCertAgainstTlsa(mockCert, pkixTaRecords);
    test.equal(result.valid, false, 'Should be invalid when PKIX-TA has no chain');
    test.ok(result.error, 'Should have error message');
    test.ok(result.error.includes('chain'), 'Error should mention chain requirement');

    test.done();
};

/**
 * Test hashCertData handles exceptions gracefully
 */
module.exports.hashCertDataHandlesExceptions = test => {
    // Test with invalid data type that might cause issues
    const result = dane.hashCertData(undefined, dane.DANE_MATCHING_TYPE.SHA256);
    test.equal(result, null, 'Should return null for undefined data');

    test.done();
};

/**
 * Test verifyCertAgainstTlsa with string cert data (hex encoded)
 */
module.exports.verifyCertWithStringCertData = test => {
    const testData = Buffer.from('test-cert-data');
    const hash = nodeCrypto.createHash('sha256').update(testData).digest();

    const mockCert = {
        raw: testData
    };

    // Record with hex-encoded cert data
    const records = [
        {
            usage: 3,
            selector: 0,
            mtype: 1,
            cert: hash.toString('hex') // String instead of Buffer
        }
    ];

    const result = dane.verifyCertAgainstTlsa(mockCert, records);
    test.equal(result.valid, true, 'Should handle hex-encoded cert data');
    test.equal(result.usage, 'DANE-EE', 'Should report DANE-EE usage');

    test.done();
};

/**
 * Pre-generated self-signed EC P-256 certificate (CN=dane-test, 100-year validity).
 * Generated once to avoid runtime dependency on the openssl CLI, temp files, and /tmp/ access.
 */
const TEST_CERT_DER = Buffer.from(
    'MIIBfzCCASWgAwIBAgIUGBfi6DOkXQjkn1O5aH0cilLBqrIwCgYIKoZIzj0EAwIw' +
        'FDESMBAGA1UEAwwJZGFuZS10ZXN0MCAXDTI2MDMwODE4NDg0MFoYDzIxMjYwMjEy' +
        'MTg0ODQwWjAUMRIwEAYDVQQDDAlkYW5lLXRlc3QwWTATBgcqhkjOPQIBBggqhkjO' +
        'PQMBBwNCAARBC6O+FFgdIi8jYteV1ViqgFd7PjyhZWt4i2GTHxYOiW0dPJh0xK+N' +
        '4ICQ7wKFRkoVUTwV+M6c+DcXn1eglIX/o1MwUTAdBgNVHQ4EFgQUGG2dEXK/ICd5' +
        'BI5pQgTFMRHTczYwHwYDVR0jBBgwFoAUGG2dEXK/ICd5BI5pQgTFMRHTczYwDwYD' +
        'VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiEA5UBl+TsPC5OIwyrDDQFy' +
        'kQVzB+csDxqRozwAXkRv3+wCIFKQLs1y3bCPuOQ6PHKG4fbDDljoIZDl08u1PYEG' +
        'T7xk',
    'base64'
);

/**
 * Pre-parsed certificate data derived from TEST_CERT_DER.
 * Computed once at module load to avoid redundant X509 parsing and SPKI export across tests.
 */
const TEST_CERT = (() => {
    const x509 = new nodeCrypto.X509Certificate(TEST_CERT_DER);
    const spkiDer = x509.publicKey.export({ type: 'spki', format: 'der' });
    return { certDer: TEST_CERT_DER, spkiDer, publicKey: x509.publicKey };
})();

function generateTestCert() {
    return TEST_CERT;
}

/**
 * Build a mock raw peer cert (as returned by tls.getPeerCertificate()).
 * .raw   = full DER certificate (valid)
 * .pubkey = raw public key bytes (NOT SPKI — this is what Node.js actually provides)
 */
function makeRawPeerCert(certDer, spkiDer) {
    return {
        raw: certDer,
        // Node's getPeerCertificate().pubkey is the raw key, not SPKI.
        // For EC P-256: 65 bytes (04 || X || Y), whereas SPKI is 91 bytes.
        pubkey: Buffer.from(spkiDer.subarray(spkiDer.length - 65))
    };
}

/**
 * Test extractSPKI with raw peer certificate (has .raw DER)
 *
 * Raw peer certs from tls.getPeerCertificate() have .pubkey (raw key bytes)
 * and .raw (full DER cert). extractSPKI must use .raw to reconstruct the
 * correct SPKI, because .pubkey is NOT the SPKI.
 */
module.exports.extractSPKIRawPeerCert = test => {
    const { certDer, spkiDer } = generateTestCert();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const result = dane.extractSPKI(rawPeerCert);
    test.ok(Buffer.isBuffer(result), 'Should return a Buffer');
    test.ok(spkiDer.equals(result), 'Should return the correct SPKI DER');
    test.equal(result.length, spkiDer.length, 'Buffer length should match SPKI DER');
    test.done();
};

/**
 * Test extractSPKI with X509Certificate object (.publicKey KeyObject)
 */
module.exports.extractSPKIX509Certificate = test => {
    const { certDer, spkiDer, publicKey } = generateTestCert();

    // Simulate an X509Certificate object: .publicKey is a KeyObject.
    const mockX509 = {
        publicKey, // KeyObject (PublicKeyObject)
        raw: certDer
    };

    const result = dane.extractSPKI(mockX509);
    test.ok(Buffer.isBuffer(result), 'Should return a Buffer');
    test.ok(spkiDer.equals(result), 'Should match the exported SPKI DER');
    test.done();
};

/**
 * Test extractSPKI with PEM-encoded public key string
 */
module.exports.extractSPKIPemString = test => {
    const { spkiDer, publicKey } = generateTestCert();
    const spkiPem = publicKey.export({ type: 'spki', format: 'pem' });

    const mockCert = {
        publicKey: spkiPem // PEM string
    };

    const result = dane.extractSPKI(mockCert);
    test.ok(Buffer.isBuffer(result), 'Should return a Buffer');
    test.ok(spkiDer.equals(result), 'PEM extraction should match DER');
    test.done();
};

/**
 * Test extractSPKI returns consistent results for raw peer cert and X509Certificate
 *
 * Both cert representations must produce the same SPKI DER output.
 */
module.exports.extractSPKIConsistentAcrossCertTypes = test => {
    const { certDer, spkiDer, publicKey } = generateTestCert();

    // Simulate raw peer cert
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    // Simulate X509Certificate
    const x509Cert = { publicKey };

    const result1 = dane.extractSPKI(rawPeerCert);
    const result2 = dane.extractSPKI(x509Cert);

    test.ok(Buffer.isBuffer(result1), 'Raw peer cert result should be a Buffer');
    test.ok(Buffer.isBuffer(result2), 'X509Certificate result should be a Buffer');
    test.ok(result1.equals(result2), 'Both cert types should produce identical SPKI');
    test.done();
};

/**
 * Test full DANE-EE (usage=3) SPKI SHA-256 verification with raw peer cert
 *
 * This is the most common DANE configuration (e.g., mx1.forwardemail.net).
 * Verifies the complete pipeline: extractSPKI → hash → compare against TLSA.
 */
module.exports.verifyCertDaneEESPKISha256RawPeerCert = test => {
    const { certDer, spkiDer } = generateTestCert();
    const spkiHash = nodeCrypto.createHash('sha256').update(spkiDer).digest();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: spkiHash
        }
    ];

    const result = dane.verifyCertAgainstTlsa(rawPeerCert, tlsaRecords);
    test.equal(result.valid, true, 'DANE-EE SPKI SHA-256 should verify against raw peer cert');
    test.equal(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
    test.ok(result.matchedRecord, 'Should have a matched record');
    test.equal(result.matchedRecord.usage, 3, 'Matched record usage should be 3');
    test.equal(result.matchedRecord.selector, 1, 'Matched record selector should be 1');
    test.done();
};

/**
 * Test full DANE-EE (usage=3) SPKI SHA-256 verification with X509Certificate
 */
module.exports.verifyCertDaneEESPKISha256X509Certificate = test => {
    const { certDer, spkiDer, publicKey } = generateTestCert();
    const spkiHash = nodeCrypto.createHash('sha256').update(spkiDer).digest();

    // Simulate X509Certificate
    const x509Cert = {
        raw: certDer,
        publicKey // KeyObject
    };

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: spkiHash
        }
    ];

    const result = dane.verifyCertAgainstTlsa(x509Cert, tlsaRecords);
    test.equal(result.valid, true, 'DANE-EE SPKI SHA-256 should verify against X509Certificate');
    test.equal(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
    test.done();
};

/**
 * Test DANE-EE SPKI SHA-512 verification
 */
module.exports.verifyCertDaneEESPKISha512 = test => {
    const { certDer, spkiDer } = generateTestCert();
    const spkiHash = nodeCrypto.createHash('sha512').update(spkiDer).digest();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 2, // SHA-512
            cert: spkiHash
        }
    ];

    const result = dane.verifyCertAgainstTlsa(rawPeerCert, tlsaRecords);
    test.equal(result.valid, true, 'DANE-EE SPKI SHA-512 should verify');
    test.equal(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
    test.done();
};

/**
 * Test DANE-EE SPKI full match (mtype=0, no hash)
 */
module.exports.verifyCertDaneEESPKIFullMatch = test => {
    const { certDer, spkiDer } = generateTestCert();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 0, // Full match
            cert: spkiDer
        }
    ];

    const result = dane.verifyCertAgainstTlsa(rawPeerCert, tlsaRecords);
    test.equal(result.valid, true, 'DANE-EE SPKI full match should verify');
    test.done();
};

/**
 * Test DANE-EE verification fails with wrong TLSA hash
 */
module.exports.verifyCertDaneEEWrongHash = test => {
    const { certDer, spkiDer } = generateTestCert();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: Buffer.alloc(32, 0xab) // Wrong hash
        }
    ];

    const result = dane.verifyCertAgainstTlsa(rawPeerCert, tlsaRecords);
    test.equal(result.valid, false, 'Should fail with wrong TLSA hash');
    test.ok(result.error, 'Should have error message');
    test.ok(result.error.includes('did not match'), 'Error should mention no match');
    test.done();
};

/**
 * Test DANE-EE full cert (selector=0) verification
 */
module.exports.verifyCertDaneEEFullCertSelector = test => {
    const { certDer } = generateTestCert();
    const certHash = nodeCrypto.createHash('sha256').update(certDer).digest();

    const rawPeerCert = {
        raw: certDer,
        pubkey: Buffer.from('irrelevant-for-selector-0')
    };

    const tlsaRecords = [
        {
            usage: 3,
            selector: 0, // Full cert
            mtype: 1, // SHA-256
            cert: certHash
        }
    ];

    const result = dane.verifyCertAgainstTlsa(rawPeerCert, tlsaRecords);
    test.equal(result.valid, true, 'DANE-EE full cert SHA-256 should verify');
    test.equal(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
    test.done();
};

/**
 * Test PKIX-EE (usage=1) SPKI verification with raw peer cert
 */
module.exports.verifyCertPkixEESPKI = test => {
    const { certDer, spkiDer } = generateTestCert();
    const spkiHash = nodeCrypto.createHash('sha256').update(spkiDer).digest();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 1, // PKIX-EE
            selector: 1,
            mtype: 1,
            cert: spkiHash
        }
    ];

    const result = dane.verifyCertAgainstTlsa(rawPeerCert, tlsaRecords);
    test.equal(result.valid, true, 'PKIX-EE SPKI SHA-256 should verify');
    test.equal(result.usage, 'PKIX-EE', 'Should report PKIX-EE usage');
    test.done();
};

/**
 * Test createDaneVerifier end-to-end with correct TLSA (should pass)
 */
module.exports.createDaneVerifierE2ECorrectTlsa = test => {
    const { certDer, spkiDer } = generateTestCert();
    const spkiHash = nodeCrypto.createHash('sha256').update(spkiDer).digest();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: spkiHash
        }
    ];

    let logMessages = [];
    const verifier = dane.createDaneVerifier(tlsaRecords, {
        verify: true,
        logger: entry => logMessages.push(entry)
    });

    const result = verifier('mail.example.com', rawPeerCert);
    test.equal(result, undefined, 'Should return undefined (success) for matching TLSA');

    const successLog = logMessages.find(l => l.msg === 'DANE verification succeeded');
    test.ok(successLog, 'Should log DANE verification succeeded');
    test.equal(successLog.usage, 'DANE-EE', 'Log should report DANE-EE');
    test.done();
};

/**
 * Test createDaneVerifier end-to-end with wrong TLSA (should fail)
 */
module.exports.createDaneVerifierE2EWrongTlsa = test => {
    const { certDer, spkiDer } = generateTestCert();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: Buffer.alloc(32, 0xab) // Wrong hash
        }
    ];

    let logMessages = [];
    const verifier = dane.createDaneVerifier(tlsaRecords, {
        verify: true,
        logger: entry => logMessages.push(entry)
    });

    const result = verifier('mail.example.com', rawPeerCert);
    test.ok(result instanceof Error, 'Should return an Error for non-matching TLSA');
    test.equal(result.code, 'DANE_VERIFICATION_FAILED', 'Error code should be DANE_VERIFICATION_FAILED');
    test.ok(result.message.includes('mail.example.com'), 'Error should include hostname');

    const failLog = logMessages.find(l => l.msg === 'DANE verification failed');
    test.ok(failLog, 'Should log DANE verification failed');
    test.done();
};

/**
 * Test createDaneVerifier ignores verify:false and still fails closed
 *
 * RFC 7672 Section 2.2 makes verification failures fatal whenever usable
 * TLSA records are present, so there is no log-only mode.
 */
module.exports.createDaneVerifierIgnoresVerifyFalse = test => {
    const { certDer, spkiDer } = generateTestCert();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: Buffer.alloc(32, 0xab) // Wrong hash
        }
    ];

    let logMessages = [];
    const verifier = dane.createDaneVerifier(tlsaRecords, {
        verify: false,
        logger: entry => logMessages.push(entry)
    });

    const result = verifier('mail.example.com', rawPeerCert);
    test.ok(result instanceof Error, 'Should still return an error when verify is false');
    test.equal(result.code, 'DANE_VERIFICATION_FAILED', 'Should report a verification failure');

    const failLog = logMessages.find(l => l.msg === 'DANE verification failed');
    test.ok(failLog, 'Should still log DANE verification failed');
    test.done();
};

/**
 * Test createDaneVerifier with X509Certificate-style cert
 */
module.exports.createDaneVerifierE2EX509Certificate = test => {
    const { certDer, spkiDer, publicKey } = generateTestCert();
    const spkiHash = nodeCrypto.createHash('sha256').update(spkiDer).digest();

    // Simulate X509Certificate (has .publicKey as KeyObject)
    const x509Cert = {
        raw: certDer,
        publicKey
    };

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: spkiHash
        }
    ];

    const verifier = dane.createDaneVerifier(tlsaRecords, { verify: true, logger: () => {} });
    const result = verifier('mail.example.com', x509Cert);
    test.equal(result, undefined, 'Should return undefined (success) for X509Certificate with matching TLSA');
    test.done();
};

//
// A CA and an end-entity certificate that CA actually issued, used for the
// DANE-TA (usage 2) tests below. Generated with a 100 year validity so they
// do not expire out from under the suite.
//
const TA_CA_DER = Buffer.from(
    'MIIDHTCCAgWgAwIBAgIUEzfEvuik2FH3KONZNbrXsLLiuKowDQYJKoZIhvcNAQELBQAwHTEbMBkGA1UEAwwSbXgtY29ubmVjdCBUZXN0IENBMCAXDTI2' +
        'MDcyMTEwMzMwNVoYDzIxMjYwNjI3MTAzMzA1WjAdMRswGQYDVQQDDBJteC1jb25uZWN0IFRlc3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK' +
        'AoIBAQDTBmW0OllNCaYdOicFrP76I/nVDD0OUG61FyBrizj2YYsaOV61Nm28hoRLyl/5mLJx9DW4b8b7mY87KGc87NXT5cRDJiXN/EEuVieZeixMLwIn' +
        'pZqw51K+/acT0HJJUX6Nadk3/86Xo4X3nEfQPL/xJgiiBLBNpJRV1C6eH4T2Db9uXBX75l4fUL+oT58/hSGguyashzyE3g+3DRPIcpasI1bmP4cfv8Gi' +
        't4m7LRLibPqXP4iJbHAjr4Xh8Dfvq1Sq/E2cT8tsL7nrEQ9ZVjpd09pl09s2P1pRLVynAnGKQ7I3LSeBWlK0L41OABIEy+ghjnjaTDgPap7S6og08Yv5' +
        'AgMBAAGjUzBRMB0GA1UdDgQWBBS4SyQT7WjLroxzXK/eOP/Gc4GTrTAfBgNVHSMEGDAWgBS4SyQT7WjLroxzXK/eOP/Gc4GTrTAPBgNVHRMBAf8EBTAD' +
        'AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBAomjape3xZkLXU/rl3+JY/2AF2mVE6DQDCkNeIeeMcXSdkyyO6N3miVi1XXk6M9tIQGTsB2naBaQIrGhiCePk' +
        'yE0vMtMYKGa6ig+2cjzIKqtCd+vE9YSRweGEKiIG6DYVjUACCo0C37IyFnKtqP2p074/3eOBzgHW4wdYIXR3GYHJAuJuW/Px85h/s77GY9frJvecg93U' +
        'IthlRu1b6L+hz8NtLr8LgIVqQEjdJlSXFyAK0qayMYYQpYDrjR4W+Qsg+2LFNfCa6MIPE20bqH8lXuDOZXiQyEeuYiMOSOeF/tFny/Z74Tz+Oana2GiD' +
        '4HhD4xyU2idOxbOYw42+XOjc',
    'base64'
);

const TA_LEAF_DER = Buffer.from(
    'MIIDCjCCAfKgAwIBAgIUJEeZ42eIrDgzaP5cn3hXX+hc+a4wDQYJKoZIhvcNAQELBQAwHTEbMBkGA1UEAwwSbXgtY29ubmVjdCBUZXN0IENBMCAXDTI2' +
        'MDcyMTEwMzMwNVoYDzIxMjYwNjI3MTAzMzA1WjAbMRkwFwYDVQQDDBBtYWlsLmV4YW1wbGUuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC' +
        'AQEAyRvizu5PbuRQtnmFakuEumA+lsmLvZGWUhQRyf6OhF7dMXUNkfQ/iAAhuNoUVIzjEzG/d6nmZJFg4YFCwqArT+Iv2f2wis+nRoIX588NdTDYiqeL' +
        'yoZmjXVvlLENO9DceCubaRKtqEmz7LI+XLRGLGUER/bUJMmQ/FV2K/A/MLJHlMJKAba+m85xEmjGVKlCFscNZsHl5bAw2fVaknVytQlCnp3qjOwP6EUm' +
        'w0h8deiPmMl+doa2T9N93f4aX3IjNaqrxxin94JxO+Shyeu/7Phd4kQ/XNFBGcMy/U41TVvre96zvJd/y3Y8RpBdYVplv+XpR7kM1Dibv2VfCXE0TwID' +
        'AQABo0IwQDAdBgNVHQ4EFgQU08eGh9XiMdbfvNXPIJtv46bxQgYwHwYDVR0jBBgwFoAUuEskE+1oy66Mc1yv3jj/xnOBk60wDQYJKoZIhvcNAQELBQAD' +
        'ggEBAG4UpmlkKa4Yj4Ak1jh3ejKwVEfSwRV22SqK2RpYLx5fj77eDim/PDCd60esnWW0bl3vvUfsMrGVnxJWbV57/ORcvvrrbnWitF2/cKzMfsbspQkK' +
        '+0srbphSQdFESOuYrEOllPigjSEiT3xIUUHztlRMzvYRvr5UNXRhlU9rpyiVwpF44tW6rvJIIdag4j/Z1Gjo2H6Pw1iOW5ZbTMGj/W0LOByzvBpVwEqK' +
        '5GOwe59o9t4KjzTotwod4fEBK1fkTX13cCwM74zFoKv6P9xvWEMkj4rffIL8CnuEFWrfMfgyV6eot+SJfjQag6sF0xOhmyzqFnkLmqqnBMwbLU7x3S8=',
    'base64'
);

const TA_CA = new nodeCrypto.X509Certificate(TA_CA_DER);
const TA_LEAF = new nodeCrypto.X509Certificate(TA_LEAF_DER);

// TLSA record pinning the CA as trust anchor: usage 2, selector 1 (SPKI), mtype 1 (SHA-256)
const TA_TLSA_RECORDS = [
    {
        usage: 2,
        selector: 1,
        mtype: 1,
        cert: nodeCrypto
            .createHash('sha256')
            .update(TA_CA.publicKey.export({ type: 'spki', format: 'der' }))
            .digest()
    }
];

/**
 * Test that createDaneVerifier forwards its third argument as the issuer chain,
 * which is what makes DANE-TA (usage 2) verification possible
 */
module.exports.createDaneVerifierForwardsChainForDaneTa = test => {
    const verifier = dane.createDaneVerifier(TA_TLSA_RECORDS, { logger: () => {} });

    const withoutChain = verifier('mail.example.com', TA_LEAF);
    test.ok(withoutChain instanceof Error, 'DANE-TA should fail when no chain is supplied');
    test.equal(withoutChain.code, 'DANE_VERIFICATION_FAILED', 'Should report a verification failure');

    const withChain = verifier('mail.example.com', TA_LEAF, [TA_CA]);
    test.equal(withChain, undefined, 'DANE-TA should succeed when the issuing trust anchor is supplied in the chain');

    test.done();
};

/**
 * Test that DANE-TA works with the raw peer certificate shape returned by
 * tls.getPeerCertificate(), not just X509Certificate instances
 */
module.exports.createDaneVerifierChainAcceptsRawPeerCerts = test => {
    const verifier = dane.createDaneVerifier(TA_TLSA_RECORDS, { logger: () => {} });
    const result = verifier('mail.example.com', { raw: TA_LEAF_DER }, [{ raw: TA_CA_DER }]);

    test.equal(result, undefined, 'DANE-TA should succeed for raw peer certificate objects');
    test.done();
};

/**
 * Test that a DANE-TA record still fails when the chain contains no matching cert
 */
module.exports.createDaneVerifierChainWithoutMatchFails = test => {
    const { certDer } = generateTestCert();

    const verifier = dane.createDaneVerifier(TA_TLSA_RECORDS, { logger: () => {} });
    const result = verifier('mail.example.com', TA_LEAF, [{ raw: certDer }]);

    test.ok(result instanceof Error, 'Should fail when no chain certificate matches the TLSA record');
    test.equal(result.code, 'DANE_VERIFICATION_FAILED', 'Should report a verification failure');
    test.done();
};

/**
 * Test that a DANE-TA match requires the pinned trust anchor to have actually
 * issued the presented certificate.
 *
 * The trust anchor a TLSA record pins is public - it is sent in the clear by
 * the real server on every handshake. If merely appearing in the chain were
 * enough, an attacker could present a certificate of their own and staple the
 * pinned CA onto the chain to have it accepted, which defeats the point of
 * DANE entirely.
 */
module.exports.createDaneVerifierRejectsUnrelatedLeafWithPinnedCaInChain = test => {
    // A self-signed certificate NOT issued by the pinned CA, standing in for
    // the certificate an interception proxy would present
    const { certDer } = generateTestCert();
    const impostorLeaf = new nodeCrypto.X509Certificate(certDer);

    test.equal(impostorLeaf.checkIssued(TA_CA), false, 'Impostor leaf must not actually be issued by the pinned CA');

    const verifier = dane.createDaneVerifier(TA_TLSA_RECORDS, { logger: () => {} });
    const result = verifier('mail.example.com', impostorLeaf, [TA_CA]);

    test.ok(result instanceof Error, 'Must reject a leaf the pinned trust anchor did not issue');
    test.equal(result.code, 'DANE_VERIFICATION_FAILED', 'Should report a verification failure');

    // The pinned CA is not on the verified path (which is the leaf alone, since
    // nothing in the chain issued it), so it is never considered a match
    test.ok(result.message.includes('did not match'), 'Error should report that no TLSA record matched');

    test.done();
};

/**
 * Test that multiple TLSA records are tried and first match wins
 */
module.exports.verifyCertMultipleTlsaRecordsFirstMatchWins = test => {
    const { certDer, spkiDer } = generateTestCert();
    const spkiHash = nodeCrypto.createHash('sha256').update(spkiDer).digest();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const tlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: Buffer.alloc(32, 0xab) // Wrong — won't match
        },
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: spkiHash // Correct — should match
        }
    ];

    const result = dane.verifyCertAgainstTlsa(rawPeerCert, tlsaRecords);
    test.equal(result.valid, true, 'Should match the second TLSA record');
    test.ok(result.matchedRecord.cert.equals(spkiHash), 'Matched record should be the correct one');
    test.done();
};

/**
 * Test that cert.pubkey (raw key) is NOT the same as SPKI DER,
 * proving the bug that existed when extractSPKI returned cert.pubkey directly.
 */
module.exports.extractSPKIPubkeyIsNotSPKI = test => {
    const { certDer, spkiDer } = generateTestCert();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    // cert.pubkey is the raw EC point (65 bytes), NOT the SPKI (91 bytes)
    test.notEqual(rawPeerCert.pubkey.length, spkiDer.length, 'Raw pubkey length should differ from SPKI length');
    test.ok(!rawPeerCert.pubkey.equals(spkiDer), 'Raw pubkey should NOT equal SPKI DER');

    // But extractSPKI should return the correct SPKI
    const result = dane.extractSPKI(rawPeerCert);
    test.ok(spkiDer.equals(result), 'extractSPKI should return correct SPKI, not raw pubkey');
    test.done();
};

/**
 * Test toBuffer handles JSON-deserialized Buffer objects from Redis/cache.
 *
 * When a Buffer is stored in Redis (or any JSON-based cache) and retrieved,
 * JSON.parse(JSON.stringify(buf)) produces a plain object:
 *   {"type":"Buffer","data":[94,129,...]}
 * instead of an actual Buffer instance. toBuffer must handle this pattern.
 */
module.exports.toBufferJsonDeserializedBuffer = test => {
    const original = Buffer.from('5e81da1af16df20b', 'hex');
    const deserialized = JSON.parse(JSON.stringify(original));

    // Confirm the deserialized object is NOT a Buffer
    test.ok(!Buffer.isBuffer(deserialized), 'JSON-deserialized Buffer should not be a Buffer');
    test.equal(deserialized.type, 'Buffer', 'Should have type "Buffer"');
    test.ok(Array.isArray(deserialized.data), 'Should have data array');

    // toBuffer should recover the original Buffer
    const result = dane.toBuffer(deserialized);
    test.ok(Buffer.isBuffer(result), 'toBuffer should return a Buffer');
    test.ok(original.equals(result), 'Recovered Buffer should equal original');
    test.done();
};

/**
 * Test that DANE verification works end-to-end when TLSA records have been
 * through a JSON round-trip (simulating Redis cache storage and retrieval).
 *
 * This is the exact scenario that caused production failures: tangerine
 * resolves TLSA records with cert as a Buffer, the records get cached in
 * Redis, and when retrieved the cert field is a plain object instead of
 * a Buffer. verifyCertAgainstTlsa must handle this transparently.
 */
module.exports.verifyCertDaneEEWithJsonDeserializedTlsa = test => {
    const { certDer, spkiDer } = generateTestCert();
    const x509 = new nodeCrypto.X509Certificate(certDer);
    const spkiHash = nodeCrypto.createHash('sha256').update(spkiDer).digest();

    // Simulate what tangerine returns (cert is a real Buffer)
    const freshRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: spkiHash
        }
    ];

    // Simulate Redis round-trip: JSON.stringify then JSON.parse
    const cachedRecords = JSON.parse(JSON.stringify(freshRecords));

    // Confirm the cert field is no longer a Buffer
    test.ok(!Buffer.isBuffer(cachedRecords[0].cert), 'Cached cert should not be a Buffer');
    test.equal(cachedRecords[0].cert.type, 'Buffer', 'Cached cert should have type "Buffer"');

    // Verification should still succeed with cached (deserialized) records
    const result = dane.verifyCertAgainstTlsa(x509, cachedRecords);
    test.equal(result.valid, true, 'DANE verification should succeed with cached TLSA records');
    test.equal(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
    test.done();
};

/**
 * Test that DANE verification FAILS with cached records when toBuffer
 * does NOT handle the deserialized pattern (regression guard).
 * This test uses a wrong hash to confirm the comparison still works correctly.
 */
module.exports.verifyCertDaneEEWithJsonDeserializedTlsaWrongHash = test => {
    const { certDer } = generateTestCert();
    const x509 = new nodeCrypto.X509Certificate(certDer);

    // Wrong hash, but JSON-deserialized format
    const wrongHash = Buffer.alloc(32, 0xff);
    const cachedRecords = JSON.parse(
        JSON.stringify([
            {
                usage: 3,
                selector: 1,
                mtype: 1,
                cert: wrongHash
            }
        ])
    );

    const result = dane.verifyCertAgainstTlsa(x509, cachedRecords);
    test.equal(result.valid, false, 'Should reject wrong hash even from cached records');
    test.done();
};
