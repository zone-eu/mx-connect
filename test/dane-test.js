/* eslint no-console: 0*/

'use strict';

const mxConnect = require('../lib/mx-connect');
const dane = require('../lib/dane');
const nodeCrypto = require('node:crypto');

// Helper to create mock socket for testing
function createMockSocket(opts = {}) {
    const { EventEmitter } = require('events');
    const socket = new EventEmitter();
    socket.remoteAddress = opts.remoteAddress || '192.0.2.1';
    socket.localAddress = opts.localAddress || '192.0.2.100';
    socket.localPort = opts.localPort || 12345;
    socket.write = () => true;
    socket.end = () => socket.emit('end');
    socket.destroy = () => socket.emit('close');
    socket.pipe = () => socket;
    return socket;
}

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
                verify: false, // Don't enforce verification (cert won't match mock)
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
 * Test DANE with resolver that throws error
 */
module.exports.daneResolverError = test => {
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

            // Check that TLSA lookup failure was logged
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
                verify: false,
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
 * Test DANE auto-detection when no resolver is available
 */
module.exports.daneAutoDetectNoResolver = test => {
    let logMessages = [];

    // Only test auto-detection if native support is not available
    if (dane.hasNativeResolveTlsa) {
        // Skip test - native support means DANE will be enabled
        test.ok(true, 'Skipping - native TLSA support available');
        test.done();
        return;
    }

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
                // enabled not set - should auto-detect
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

            // Should have logged that DANE is disabled
            const disabledLog = logMessages.find(log => log.msg === 'DANE disabled - no resolver available');
            test.ok(disabledLog, 'Should log DANE disabled');

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
