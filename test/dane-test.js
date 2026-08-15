/* eslint no-console: 0*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const mxConnect = require('../lib/mx-connect');
const dane = require('../lib/dane');
const nodeCrypto = require('crypto');
const { createMockConnectHook } = require('./test-utils');

/**
 * Test DANE module exports
 */
test('daneModuleExports', async () => {
    assert.ok(dane.DANE_USAGE, 'DANE_USAGE should be exported');
    assert.ok(dane.DANE_SELECTOR, 'DANE_SELECTOR should be exported');
    assert.ok(dane.DANE_MATCHING_TYPE, 'DANE_MATCHING_TYPE should be exported');
    assert.ok(dane.EMPTY_DANE_HANDLER, 'EMPTY_DANE_HANDLER should be exported');
    assert.strictEqual(typeof dane.hasNativeResolveTlsa, 'boolean', 'hasNativeResolveTlsa should be a boolean');
    assert.strictEqual(typeof dane.resolveTlsaRecords, 'function', 'resolveTlsaRecords should be a function');
    assert.strictEqual(typeof dane.verifyCertAgainstTlsa, 'function', 'verifyCertAgainstTlsa should be a function');
    assert.strictEqual(typeof dane.createDaneVerifier, 'function', 'createDaneVerifier should be a function');
});

/**
 * Test DANE usage constants
 */
test('daneUsageConstants', async () => {
    assert.strictEqual(dane.DANE_USAGE.PKIX_TA, 0, 'PKIX_TA should be 0');
    assert.strictEqual(dane.DANE_USAGE.PKIX_EE, 1, 'PKIX_EE should be 1');
    assert.strictEqual(dane.DANE_USAGE.DANE_TA, 2, 'DANE_TA should be 2');
    assert.strictEqual(dane.DANE_USAGE.DANE_EE, 3, 'DANE_EE should be 3');
});

/**
 * Test DANE selector constants
 */
test('daneSelectorConstants', async () => {
    assert.strictEqual(dane.DANE_SELECTOR.FULL_CERT, 0, 'FULL_CERT should be 0');
    assert.strictEqual(dane.DANE_SELECTOR.SPKI, 1, 'SPKI should be 1');
});

/**
 * Test DANE matching type constants
 */
test('daneMatchingTypeConstants', async () => {
    assert.strictEqual(dane.DANE_MATCHING_TYPE.FULL, 0, 'FULL should be 0');
    assert.strictEqual(dane.DANE_MATCHING_TYPE.SHA256, 1, 'SHA256 should be 1');
    assert.strictEqual(dane.DANE_MATCHING_TYPE.SHA512, 2, 'SHA512 should be 2');
});

/**
 * Test hashCertData function with SHA-256
 */
test('hashCertDataSha256', async () => {
    const testData = Buffer.from('test certificate data');
    const expectedHash = nodeCrypto.createHash('sha256').update(testData).digest();
    const result = dane.hashCertData(testData, dane.DANE_MATCHING_TYPE.SHA256);
    assert.ok(Buffer.isBuffer(result), 'Result should be a Buffer');
    assert.ok(expectedHash.equals(result), 'SHA-256 hash should match');
});

/**
 * Test hashCertData function with SHA-512
 */
test('hashCertDataSha512', async () => {
    const testData = Buffer.from('test certificate data');
    const expectedHash = nodeCrypto.createHash('sha512').update(testData).digest();
    const result = dane.hashCertData(testData, dane.DANE_MATCHING_TYPE.SHA512);
    assert.ok(Buffer.isBuffer(result), 'Result should be a Buffer');
    assert.ok(expectedHash.equals(result), 'SHA-512 hash should match');
});

/**
 * Test hashCertData function with full data (no hash)
 */
test('hashCertDataFull', async () => {
    const testData = Buffer.from('test certificate data');
    const result = dane.hashCertData(testData, dane.DANE_MATCHING_TYPE.FULL);
    assert.ok(Buffer.isBuffer(result), 'Result should be a Buffer');
    assert.ok(testData.equals(result), 'Full data should be returned unchanged');
});

/**
 * Test hashCertData with null input
 */
test('hashCertDataNull', async () => {
    const result = dane.hashCertData(null, dane.DANE_MATCHING_TYPE.SHA256);
    assert.strictEqual(result, null, 'Result should be null for null input');
});

/**
 * Test verifyCertAgainstTlsa with no records
 */
test('verifyCertNoRecords', async () => {
    const result = dane.verifyCertAgainstTlsa({}, []);
    assert.strictEqual(result.valid, true, 'Should be valid when no records exist');
    assert.strictEqual(result.noRecords, true, 'Should indicate no records');
    assert.strictEqual(result.matchedRecord, null, 'Should have no matched record');
});

/**
 * Test verifyCertAgainstTlsa with no certificate
 */
test('verifyCertNoCert', async () => {
    const tlsaRecords = [{ usage: 3, selector: 1, mtype: 1, cert: Buffer.alloc(32) }];
    const result = dane.verifyCertAgainstTlsa(null, tlsaRecords);
    assert.strictEqual(result.valid, false, 'Should be invalid when no certificate');
    assert.ok(result.error, 'Should have an error message');
});

/**
 * Test createDaneVerifier returns a function
 */
test('createDaneVerifierReturnsFunction', async () => {
    const verifier = dane.createDaneVerifier([], {});
    assert.strictEqual(typeof verifier, 'function', 'Should return a function');
});

/**
 * Test createDaneVerifier with no records returns undefined (success)
 */
test('createDaneVerifierNoRecords', async () => {
    const verifier = dane.createDaneVerifier([], {});
    const result = verifier('example.com', {});
    assert.strictEqual(result, undefined, 'Should return undefined (success) when no records');
});

/**
 * Test EMPTY_DANE_HANDLER
 */
test('emptyDaneHandler', async () => {
    assert.strictEqual(dane.EMPTY_DANE_HANDLER.enabled, false, 'Should be disabled by default');
    const records = await dane.EMPTY_DANE_HANDLER.resolveTlsa('test.example.com');
    assert.deepStrictEqual(records, [], 'Should return empty array');
});

/**
 * Test mx-connect exports DANE module
 */
test('mxConnectExportsDane', async () => {
    assert.ok(mxConnect.dane, 'mx-connect should export dane module');
    assert.strictEqual(typeof mxConnect.dane.resolveTlsaRecords, 'function', 'Should export resolveTlsaRecords');
    assert.strictEqual(typeof mxConnect.dane.verifyCertAgainstTlsa, 'function', 'Should export verifyCertAgainstTlsa');
});

/**
 * Test DANE with custom resolver using mock socket
 */
test('daneWithCustomResolver', (t, done) => {
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
            connectHook: createMockConnectHook()
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');
            assert.ok(tlsaLookupCalled, 'Custom resolveTlsa should have been called');
            done();
        }
    );
});

/**
 * Test DANE with custom resolver returning TLSA records
 */
test('daneWithTlsaRecords', (t, done) => {
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
            connectHook: createMockConnectHook()
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');

            // Check that TLSA records were found
            const tlsaFoundLog = logMessages.find(log => log.msg === 'TLSA records found');
            assert.ok(tlsaFoundLog, 'Should log TLSA records found');
            assert.strictEqual(tlsaFoundLog.recordCount, 1, 'Should have 1 TLSA record');

            // Check that DANE was enabled for connection
            const daneEnabledLog = logMessages.find(log => log.msg === 'DANE enabled for connection');
            assert.ok(daneEnabledLog, 'Should log DANE enabled for connection');

            // Check connection has DANE properties
            assert.ok(connection.daneEnabled, 'Connection should have daneEnabled flag');
            assert.ok(connection.tlsaRecords, 'Connection should have tlsaRecords');
            assert.strictEqual(connection.tlsaRecords.length, 1, 'Should have 1 TLSA record');

            done();
        }
    );
});

/**
 * Test DANE with resolver that throws error (verify mode rejects connection)
 */
test('daneResolverError', (t, done) => {
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
            connectHook: createMockConnectHook()
        },
        (err, connection) => {
            assert.ok(err, 'Should return an error when DANE lookup fails in verify mode');
            assert.ok(!connection, 'Connection should not exist');
            assert.ok(err.message.includes('DANE TLSA lookup failed'), 'Error should mention DANE lookup failure');
            assert.strictEqual(err.category, 'dane', 'Error category should be dane');
            done();
        }
    );
});

/**
 * Test that verify:false no longer bypasses DANE enforcement (RFC 7672) and
 * that passing it logs a deprecation notice
 */
test('daneResolverErrorVerifyFalseStillEnforced', (t, done) => {
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
            connectHook: createMockConnectHook()
        },
        (err, connection) => {
            assert.ok(err, 'verify:false must not bypass DANE enforcement');
            assert.ok(!connection, 'Connection should not exist');
            assert.strictEqual(err.category, 'dane', 'Error category should be dane');

            const deprecationLog = logMessages.find(log => log.msg && log.msg.includes('dane.verify option is deprecated'));
            assert.ok(deprecationLog, 'Should log a deprecation notice for verify:false');

            const failLog = logMessages.find(log => log.msg === 'TLSA lookup failed');
            assert.ok(failLog, 'Should log TLSA lookup failure');
            assert.ok(failLog.error, 'Should include error message');

            done();
        }
    );
});

/**
 * Test DANE with NODATA response (no records exist)
 */
test('daneNoDataResponse', (t, done) => {
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
            connectHook: createMockConnectHook()
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');
            // Should succeed - NODATA means no DANE records, not an error
            done();
        }
    );
});

/**
 * Test DANE explicitly disabled
 */
test('daneExplicitlyDisabled', (t, done) => {
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
            connectHook: createMockConnectHook()
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');
            assert.ok(!tlsaLookupCalled, 'resolveTlsa should not be called when DANE is disabled');
            done();
        }
    );
});

/**
 * Test resolveTlsaRecords with custom resolver
 */
test('resolveTlsaRecordsCustomResolver', async () => {
    const mockRecords = [{ usage: 3, selector: 1, mtype: 1, cert: Buffer.alloc(32) }];
    const mockResolver = async tlsaName => {
        assert.strictEqual(tlsaName, '_25._tcp.mail.example.com', 'Should format TLSA name correctly');
        return mockRecords;
    };

    const records = await dane.resolveTlsaRecords('mail.example.com', 25, { resolveTlsa: mockResolver });
    assert.deepStrictEqual(records, mockRecords, 'Should return records from custom resolver');
});

/**
 * Test resolveTlsaRecords handles ENODATA gracefully
 */
test('resolveTlsaRecordsNoData', async () => {
    const mockResolver = async () => {
        const err = new Error('No data');
        err.code = 'ENODATA';
        throw err;
    };

    const records = await dane.resolveTlsaRecords('mail.example.com', 25, { resolveTlsa: mockResolver });
    assert.deepStrictEqual(records, [], 'Should return empty array for ENODATA');
});

/**
 * Test resolveTlsaRecords handles ENOTFOUND gracefully
 */
test('resolveTlsaRecordsNotFound', async () => {
    const mockResolver = async () => {
        const err = new Error('Not found');
        err.code = 'ENOTFOUND';
        throw err;
    };

    const records = await dane.resolveTlsaRecords('mail.example.com', 25, { resolveTlsa: mockResolver });
    assert.deepStrictEqual(records, [], 'Should return empty array for ENOTFOUND');
});

/**
 * Test resolveTlsaRecords propagates other errors
 */
test('resolveTlsaRecordsOtherError', async () => {
    const mockResolver = async () => {
        const err = new Error('Server failure');
        err.code = 'ESERVFAIL';
        throw err;
    };

    await assert.rejects(dane.resolveTlsaRecords('mail.example.com', 25, { resolveTlsa: mockResolver }), err => {
        assert.strictEqual(err.code, 'ESERVFAIL', 'Should propagate non-NODATA errors');
        return true;
    });
});

/**
 * Test hasNativeResolveTlsa detection
 */
test('hasNativeResolveTlsaDetection', async () => {
    const dns = require('dns');
    const expected = typeof dns.resolveTlsa === 'function';
    assert.strictEqual(dane.hasNativeResolveTlsa, expected, 'hasNativeResolveTlsa should match actual dns module');
});

/**
 * Test DANE with pre-resolved MX that includes TLSA records
 */
test('daneWithPreresolvedMx', (t, done) => {
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
            connectHook: createMockConnectHook()
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');

            // TLSA records should be passed through from pre-resolved MX
            assert.ok(connection.tlsaRecords, 'Connection should have tlsaRecords');
            assert.strictEqual(connection.tlsaRecords.length, 1, 'Should have 1 TLSA record');

            done();
        }
    );
});

/**
 * Test DANE stays disabled without explicit enabled:true
 */
test('daneAutoDetectNoResolver', (t, done) => {
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
            connectHook: createMockConnectHook()
        },
        (err, connection) => {
            assert.ifError(err);
            assert.ok(connection, 'Connection should exist');
            assert.ok(connection.socket, 'Connection should have socket');
            assert.ok(!tlsaLookupCalled, 'resolveTlsa should not be called when enabled is not set');
            done();
        }
    );
});

/**
 * Test extractSPKI with malformed certificate (Issue #1)
 */
test('extractSPKIMalformedCert', async () => {
    // Test with null
    let result = dane.extractSPKI(null);
    assert.strictEqual(result, null, 'Should return null for null certificate');

    // Test with empty object
    result = dane.extractSPKI({});
    assert.strictEqual(result, null, 'Should return null for empty certificate');

    // Test with invalid publicKey
    result = dane.extractSPKI({ publicKey: 'invalid-key-data' });
    assert.strictEqual(result, null, 'Should return null for invalid publicKey');

    // Test with malformed publicKey buffer
    result = dane.extractSPKI({ publicKey: Buffer.from('invalid') });
    assert.strictEqual(result, null, 'Should return null for malformed publicKey buffer');
});

/**
 * Test getCertData with malformed certificate (Issue #2)
 */
test('getCertDataMalformedCert', async () => {
    // Test with null
    let result = dane.getCertData(null, dane.DANE_SELECTOR.FULL_CERT);
    assert.strictEqual(result, null, 'Should return null for null certificate');

    // Test with empty object (no raw property)
    result = dane.getCertData({}, dane.DANE_SELECTOR.FULL_CERT);
    assert.strictEqual(result, null, 'Should return null for certificate without raw');

    // Test with SPKI selector on malformed cert
    result = dane.getCertData({ publicKey: 'invalid' }, dane.DANE_SELECTOR.SPKI);
    assert.strictEqual(result, null, 'Should return null for malformed certificate with SPKI selector');
});

/**
 * Test verifyCertAgainstTlsa with malformed TLSA records (Issue #4)
 */
test('verifyCertMalformedTlsaRecords', async () => {
    const mockCert = {
        raw: Buffer.from('test-cert-data'),
        publicKey: null
    };

    // Test with record missing cert field
    const recordsNoCert = [{ usage: 3, selector: 0, mtype: 1 }];
    let result = dane.verifyCertAgainstTlsa(mockCert, recordsNoCert);
    assert.strictEqual(result.valid, false, 'Should be invalid when record has no cert field');

    // Test with invalid usage value (should not crash)
    const recordsInvalidUsage = [{ usage: 99, selector: 0, mtype: 1, cert: Buffer.alloc(32) }];
    result = dane.verifyCertAgainstTlsa(mockCert, recordsInvalidUsage);
    assert.strictEqual(result.valid, false, 'Should be invalid for unknown usage type');

    // Test with invalid selector value (should not crash)
    const recordsInvalidSelector = [{ usage: 3, selector: 99, mtype: 1, cert: Buffer.alloc(32) }];
    result = dane.verifyCertAgainstTlsa(mockCert, recordsInvalidSelector);
    assert.strictEqual(result.valid, false, 'Should be invalid for unknown selector');
});

/**
 * Test createDaneVerifier catches exceptions (Issue #1, #2, #4)
 */
test('createDaneVerifierCatchesExceptions', async () => {
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
        assert.ok(true, 'Should not throw for malformed certificate');
    } catch (err) {
        assert.ok(false, 'Should not throw exception: ' + err.message);
    }

    // Result should be an error (verification failed), not an exception
    assert.ok(result instanceof Error || result === undefined, 'Should return error or undefined, not throw');
});

/**
 * Test isNoRecordsError helper function
 */
test('isNoRecordsErrorHelper', async () => {
    assert.ok(dane.isNoRecordsError, 'isNoRecordsError should be exported');
    assert.strictEqual(dane.isNoRecordsError('ENODATA'), true, 'ENODATA should be a no-records error');
    assert.strictEqual(dane.isNoRecordsError('ENOTFOUND'), true, 'ENOTFOUND should be a no-records error');
    assert.strictEqual(dane.isNoRecordsError('ENOENT'), true, 'ENOENT should be a no-records error');
    assert.strictEqual(dane.isNoRecordsError('ESERVFAIL'), false, 'ESERVFAIL should not be a no-records error');
    assert.strictEqual(dane.isNoRecordsError('ETIMEDOUT'), false, 'ETIMEDOUT should not be a no-records error');
    assert.strictEqual(dane.isNoRecordsError(undefined), false, 'undefined should not be a no-records error');
});

/**
 * Test hasNativePromiseResolveTlsa detection
 */
test('hasNativePromiseResolveTlsaDetection', async () => {
    const dns = require('dns');
    const expected = dns.promises && typeof dns.promises.resolveTlsa === 'function';
    assert.strictEqual(dane.hasNativePromiseResolveTlsa, expected, 'hasNativePromiseResolveTlsa should match actual dns.promises module');
});

/**
 * Test verifyCertAgainstTlsa with DANE-TA without chain (Issue #3)
 */
test('verifyCertDaneTaWithoutChain', async () => {
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
    assert.strictEqual(result.valid, false, 'Should be invalid when DANE-TA has no chain');
    assert.ok(result.error, 'Should have error message');
    assert.ok(result.error.includes('chain'), 'Error should mention chain requirement');
});

/**
 * Test verifyCertAgainstTlsa with PKIX-TA without chain (Issue #3)
 */
test('verifyCertPkixTaWithoutChain', async () => {
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
    assert.strictEqual(result.valid, false, 'Should be invalid when PKIX-TA has no chain');
    assert.ok(result.error, 'Should have error message');
    assert.ok(result.error.includes('chain'), 'Error should mention chain requirement');
});

/**
 * Test hashCertData handles exceptions gracefully
 */
test('hashCertDataHandlesExceptions', async () => {
    // Test with invalid data type that might cause issues
    const result = dane.hashCertData(undefined, dane.DANE_MATCHING_TYPE.SHA256);
    assert.strictEqual(result, null, 'Should return null for undefined data');
});

/**
 * Test verifyCertAgainstTlsa with string cert data (hex encoded)
 */
test('verifyCertWithStringCertData', async () => {
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
    assert.strictEqual(result.valid, true, 'Should handle hex-encoded cert data');
    assert.strictEqual(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
});

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
test('extractSPKIRawPeerCert', async () => {
    const { certDer, spkiDer } = generateTestCert();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    const result = dane.extractSPKI(rawPeerCert);
    assert.ok(Buffer.isBuffer(result), 'Should return a Buffer');
    assert.ok(spkiDer.equals(result), 'Should return the correct SPKI DER');
    assert.strictEqual(result.length, spkiDer.length, 'Buffer length should match SPKI DER');
});

/**
 * Test extractSPKI with X509Certificate object (.publicKey KeyObject)
 */
test('extractSPKIX509Certificate', async () => {
    const { certDer, spkiDer, publicKey } = generateTestCert();

    // Simulate an X509Certificate object: .publicKey is a KeyObject.
    const mockX509 = {
        publicKey, // KeyObject (PublicKeyObject)
        raw: certDer
    };

    const result = dane.extractSPKI(mockX509);
    assert.ok(Buffer.isBuffer(result), 'Should return a Buffer');
    assert.ok(spkiDer.equals(result), 'Should match the exported SPKI DER');
});

/**
 * Test extractSPKI with PEM-encoded public key string
 */
test('extractSPKIPemString', async () => {
    const { spkiDer, publicKey } = generateTestCert();
    const spkiPem = publicKey.export({ type: 'spki', format: 'pem' });

    const mockCert = {
        publicKey: spkiPem // PEM string
    };

    const result = dane.extractSPKI(mockCert);
    assert.ok(Buffer.isBuffer(result), 'Should return a Buffer');
    assert.ok(spkiDer.equals(result), 'PEM extraction should match DER');
});

/**
 * Test extractSPKI returns consistent results for raw peer cert and X509Certificate
 *
 * Both cert representations must produce the same SPKI DER output.
 */
test('extractSPKIConsistentAcrossCertTypes', async () => {
    const { certDer, spkiDer, publicKey } = generateTestCert();

    // Simulate raw peer cert
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    // Simulate X509Certificate
    const x509Cert = { publicKey };

    const result1 = dane.extractSPKI(rawPeerCert);
    const result2 = dane.extractSPKI(x509Cert);

    assert.ok(Buffer.isBuffer(result1), 'Raw peer cert result should be a Buffer');
    assert.ok(Buffer.isBuffer(result2), 'X509Certificate result should be a Buffer');
    assert.ok(result1.equals(result2), 'Both cert types should produce identical SPKI');
});

/**
 * Test full DANE-EE (usage=3) SPKI SHA-256 verification with raw peer cert
 *
 * This is the most common DANE configuration (e.g., mx1.forwardemail.net).
 * Verifies the complete pipeline: extractSPKI → hash → compare against TLSA.
 */
test('verifyCertDaneEESPKISha256RawPeerCert', async () => {
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
    assert.strictEqual(result.valid, true, 'DANE-EE SPKI SHA-256 should verify against raw peer cert');
    assert.strictEqual(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
    assert.ok(result.matchedRecord, 'Should have a matched record');
    assert.strictEqual(result.matchedRecord.usage, 3, 'Matched record usage should be 3');
    assert.strictEqual(result.matchedRecord.selector, 1, 'Matched record selector should be 1');
});

/**
 * Test full DANE-EE (usage=3) SPKI SHA-256 verification with X509Certificate
 */
test('verifyCertDaneEESPKISha256X509Certificate', async () => {
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
    assert.strictEqual(result.valid, true, 'DANE-EE SPKI SHA-256 should verify against X509Certificate');
    assert.strictEqual(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
});

/**
 * Test DANE-EE SPKI SHA-512 verification
 */
test('verifyCertDaneEESPKISha512', async () => {
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
    assert.strictEqual(result.valid, true, 'DANE-EE SPKI SHA-512 should verify');
    assert.strictEqual(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
});

/**
 * Test DANE-EE SPKI full match (mtype=0, no hash)
 */
test('verifyCertDaneEESPKIFullMatch', async () => {
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
    assert.strictEqual(result.valid, true, 'DANE-EE SPKI full match should verify');
});

/**
 * Test DANE-EE verification fails with wrong TLSA hash
 */
test('verifyCertDaneEEWrongHash', async () => {
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
    assert.strictEqual(result.valid, false, 'Should fail with wrong TLSA hash');
    assert.ok(result.error, 'Should have error message');
    assert.ok(result.error.includes('did not match'), 'Error should mention no match');
});

/**
 * Test DANE-EE full cert (selector=0) verification
 */
test('verifyCertDaneEEFullCertSelector', async () => {
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
    assert.strictEqual(result.valid, true, 'DANE-EE full cert SHA-256 should verify');
    assert.strictEqual(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
});

/**
 * Test PKIX-EE (usage=1) SPKI verification with raw peer cert
 */
test('verifyCertPkixEESPKI', async () => {
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
    assert.strictEqual(result.valid, true, 'PKIX-EE SPKI SHA-256 should verify');
    assert.strictEqual(result.usage, 'PKIX-EE', 'Should report PKIX-EE usage');
});

/**
 * Test createDaneVerifier end-to-end with correct TLSA (should pass)
 */
test('createDaneVerifierE2ECorrectTlsa', async () => {
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
    assert.strictEqual(result, undefined, 'Should return undefined (success) for matching TLSA');

    const successLog = logMessages.find(l => l.msg === 'DANE verification succeeded');
    assert.ok(successLog, 'Should log DANE verification succeeded');
    assert.strictEqual(successLog.usage, 'DANE-EE', 'Log should report DANE-EE');
});

/**
 * Test createDaneVerifier end-to-end with wrong TLSA (should fail)
 */
test('createDaneVerifierE2EWrongTlsa', async () => {
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
    assert.ok(result instanceof Error, 'Should return an Error for non-matching TLSA');
    assert.strictEqual(result.code, 'DANE_VERIFICATION_FAILED', 'Error code should be DANE_VERIFICATION_FAILED');
    assert.ok(result.message.includes('mail.example.com'), 'Error should include hostname');

    const failLog = logMessages.find(l => l.msg === 'DANE verification failed');
    assert.ok(failLog, 'Should log DANE verification failed');
});

/**
 * Test createDaneVerifier ignores verify:false and still fails closed
 *
 * RFC 7672 Section 2.2 makes verification failures fatal whenever usable
 * TLSA records are present, so there is no log-only mode.
 */
test('createDaneVerifierIgnoresVerifyFalse', async () => {
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
    assert.ok(result instanceof Error, 'Should still return an error when verify is false');
    assert.strictEqual(result.code, 'DANE_VERIFICATION_FAILED', 'Should report a verification failure');

    const failLog = logMessages.find(l => l.msg === 'DANE verification failed');
    assert.ok(failLog, 'Should still log DANE verification failed');
});

/**
 * Test createDaneVerifier with X509Certificate-style cert
 */
test('createDaneVerifierE2EX509Certificate', async () => {
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
    assert.strictEqual(result, undefined, 'Should return undefined (success) for X509Certificate with matching TLSA');
});

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
test('createDaneVerifierForwardsChainForDaneTa', async () => {
    const verifier = dane.createDaneVerifier(TA_TLSA_RECORDS, { logger: () => {} });

    const withoutChain = verifier('mail.example.com', TA_LEAF);
    assert.ok(withoutChain instanceof Error, 'DANE-TA should fail when no chain is supplied');
    assert.strictEqual(withoutChain.code, 'DANE_VERIFICATION_FAILED', 'Should report a verification failure');

    const withChain = verifier('mail.example.com', TA_LEAF, [TA_CA]);
    assert.strictEqual(withChain, undefined, 'DANE-TA should succeed when the issuing trust anchor is supplied in the chain');
});

/**
 * Test that DANE-TA works with the raw peer certificate shape returned by
 * tls.getPeerCertificate(), not just X509Certificate instances
 */
test('createDaneVerifierChainAcceptsRawPeerCerts', async () => {
    const verifier = dane.createDaneVerifier(TA_TLSA_RECORDS, { logger: () => {} });
    const result = verifier('mail.example.com', { raw: TA_LEAF_DER }, [{ raw: TA_CA_DER }]);

    assert.strictEqual(result, undefined, 'DANE-TA should succeed for raw peer certificate objects');
});

/**
 * Test that a DANE-TA record still fails when the chain contains no matching cert
 */
test('createDaneVerifierChainWithoutMatchFails', async () => {
    const { certDer } = generateTestCert();

    const verifier = dane.createDaneVerifier(TA_TLSA_RECORDS, { logger: () => {} });
    const result = verifier('mail.example.com', TA_LEAF, [{ raw: certDer }]);

    assert.ok(result instanceof Error, 'Should fail when no chain certificate matches the TLSA record');
    assert.strictEqual(result.code, 'DANE_VERIFICATION_FAILED', 'Should report a verification failure');
});

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
test('createDaneVerifierRejectsUnrelatedLeafWithPinnedCaInChain', async () => {
    // A self-signed certificate NOT issued by the pinned CA, standing in for
    // the certificate an interception proxy would present
    const { certDer } = generateTestCert();
    const impostorLeaf = new nodeCrypto.X509Certificate(certDer);

    assert.strictEqual(impostorLeaf.checkIssued(TA_CA), false, 'Impostor leaf must not actually be issued by the pinned CA');

    const verifier = dane.createDaneVerifier(TA_TLSA_RECORDS, { logger: () => {} });
    const result = verifier('mail.example.com', impostorLeaf, [TA_CA]);

    assert.ok(result instanceof Error, 'Must reject a leaf the pinned trust anchor did not issue');
    assert.strictEqual(result.code, 'DANE_VERIFICATION_FAILED', 'Should report a verification failure');

    // The pinned CA is not on the verified path (which is the leaf alone, since
    // nothing in the chain issued it), so it is never considered a match
    assert.ok(result.message.includes('did not match'), 'Error should report that no TLSA record matched');
});

/**
 * Test that multiple TLSA records are tried and first match wins
 */
test('verifyCertMultipleTlsaRecordsFirstMatchWins', async () => {
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
    assert.strictEqual(result.valid, true, 'Should match the second TLSA record');
    assert.ok(result.matchedRecord.cert.equals(spkiHash), 'Matched record should be the correct one');
});

/**
 * Test that cert.pubkey (raw key) is NOT the same as SPKI DER,
 * proving the bug that existed when extractSPKI returned cert.pubkey directly.
 */
test('extractSPKIPubkeyIsNotSPKI', async () => {
    const { certDer, spkiDer } = generateTestCert();
    const rawPeerCert = makeRawPeerCert(certDer, spkiDer);

    // cert.pubkey is the raw EC point (65 bytes), NOT the SPKI (91 bytes)
    assert.notStrictEqual(rawPeerCert.pubkey.length, spkiDer.length, 'Raw pubkey length should differ from SPKI length');
    assert.ok(!rawPeerCert.pubkey.equals(spkiDer), 'Raw pubkey should NOT equal SPKI DER');

    // But extractSPKI should return the correct SPKI
    const result = dane.extractSPKI(rawPeerCert);
    assert.ok(spkiDer.equals(result), 'extractSPKI should return correct SPKI, not raw pubkey');
});

/**
 * Test toBuffer handles JSON-deserialized Buffer objects from Redis/cache.
 *
 * When a Buffer is stored in Redis (or any JSON-based cache) and retrieved,
 * JSON.parse(JSON.stringify(buf)) produces a plain object:
 *   {"type":"Buffer","data":[94,129,...]}
 * instead of an actual Buffer instance. toBuffer must handle this pattern.
 */
test('toBufferJsonDeserializedBuffer', async () => {
    const original = Buffer.from('5e81da1af16df20b', 'hex');
    const deserialized = JSON.parse(JSON.stringify(original));

    // Confirm the deserialized object is NOT a Buffer
    assert.ok(!Buffer.isBuffer(deserialized), 'JSON-deserialized Buffer should not be a Buffer');
    assert.strictEqual(deserialized.type, 'Buffer', 'Should have type "Buffer"');
    assert.ok(Array.isArray(deserialized.data), 'Should have data array');

    // toBuffer should recover the original Buffer
    const result = dane.toBuffer(deserialized);
    assert.ok(Buffer.isBuffer(result), 'toBuffer should return a Buffer');
    assert.ok(original.equals(result), 'Recovered Buffer should equal original');
});

/**
 * Test that DANE verification works end-to-end when TLSA records have been
 * through a JSON round-trip (simulating Redis cache storage and retrieval).
 *
 * This is the exact scenario that caused production failures: tangerine
 * resolves TLSA records with cert as a Buffer, the records get cached in
 * Redis, and when retrieved the cert field is a plain object instead of
 * a Buffer. verifyCertAgainstTlsa must handle this transparently.
 */
test('verifyCertDaneEEWithJsonDeserializedTlsa', async () => {
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
    assert.ok(!Buffer.isBuffer(cachedRecords[0].cert), 'Cached cert should not be a Buffer');
    assert.strictEqual(cachedRecords[0].cert.type, 'Buffer', 'Cached cert should have type "Buffer"');

    // Verification should still succeed with cached (deserialized) records
    const result = dane.verifyCertAgainstTlsa(x509, cachedRecords);
    assert.strictEqual(result.valid, true, 'DANE verification should succeed with cached TLSA records');
    assert.strictEqual(result.usage, 'DANE-EE', 'Should report DANE-EE usage');
});

/**
 * Test that DANE verification FAILS with cached records when toBuffer
 * does NOT handle the deserialized pattern (regression guard).
 * This test uses a wrong hash to confirm the comparison still works correctly.
 */
test('verifyCertDaneEEWithJsonDeserializedTlsaWrongHash', async () => {
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
    assert.strictEqual(result.valid, false, 'Should reject wrong hash even from cached records');
});

/**
 * Test: malformed TLSA record input must not throw out of the verifier
 *
 * checkServerIdentity runs inside the TLS handshake; an exception escaping it
 * would crash the connection handling, so malformed input has to come back as
 * a DANE_VERIFICATION_ERROR return value instead.
 */
test('verifierHandlesMalformedTlsaRecordsWithoutThrowing', async () => {
    // Non-iterable array-like: passes the length check, then throws inside
    // verifyCertAgainstTlsa when iterated
    const verifier = dane.createDaneVerifier({ length: 1 }, {});

    const result = verifier('mail.example.com', { raw: Buffer.from('not a real cert') });
    assert.ok(result instanceof Error, 'Malformed records should produce an error return value, not a throw');
    assert.strictEqual(result.code, 'DANE_VERIFICATION_ERROR');
    assert.strictEqual(result.category, 'dane');
});

test('verifyCertTaUnparseableChainEntryRefusesWholeChain', async () => {
    // A chain entry that cannot be parsed might be the very link joining the leaf to the
    // pinned anchor. Skipping past it and reasoning about what remains would let an
    // attacker hide a missing link behind a malformed entry, so the chain is refused
    // outright instead.
    const intact = dane.verifyCertAgainstTlsa(TA_LEAF, TA_TLSA_RECORDS, [TA_CA]);
    assert.strictEqual(intact.valid, true, 'The intact chain must verify, so the comparison below is like for like');

    for (const junk of [Buffer.from('not a certificate'), null, {}, 'garbage', 42]) {
        const result = dane.verifyCertAgainstTlsa(TA_LEAF, TA_TLSA_RECORDS, [junk, TA_CA]);
        assert.strictEqual(result.valid, false, `A chain holding ${typeof junk} junk must not verify`);
        assert.ok(result.error.includes('no verified path'), 'The failure should name the missing verified path');
    }
});

test('verifyCertTaUnparseableLeafRefusesChain', async () => {
    // Same reasoning for the leaf: with nothing to build a path from, a trust anchor
    // record cannot be checked and must not be treated as a match
    const result = dane.verifyCertAgainstTlsa({ raw: Buffer.from('not a certificate') }, TA_TLSA_RECORDS, [TA_CA]);
    assert.strictEqual(result.valid, false, 'An unparseable leaf must not verify against a trust anchor record');
    assert.ok(result.error.includes('no verified path'));
});

test('verifyCertDaneEEAcceptsTypedArrayCertData', async () => {
    // A resolver may hand back the association data as a typed array rather than a Buffer.
    // It has to be accepted exactly like the Buffer form, or DANE silently stops matching
    // for anyone using such a resolver.
    const { certDer, spkiDer } = generateTestCert();
    const digest = nodeCrypto.createHash('sha256').update(spkiDer).digest();
    const leaf = new nodeCrypto.X509Certificate(certDer);

    for (const certData of [new Uint8Array(digest), digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength)]) {
        const records = [{ usage: 3, selector: 1, mtype: 1, cert: certData }];
        const result = dane.verifyCertAgainstTlsa(leaf, records, null);
        assert.strictEqual(result.valid, true, 'A typed array or ArrayBuffer must match like a Buffer');
    }

    // And a typed array holding the wrong digest must still fail
    const wrong = [{ usage: 3, selector: 1, mtype: 1, cert: new Uint8Array(32) }];
    assert.strictEqual(dane.verifyCertAgainstTlsa(leaf, wrong, null).valid, false, 'A wrong digest must not match whatever its container');
});

test('verifyCertRecordThatThrowsIsReportedNotPropagated', async () => {
    // A record that blows up while being read must be reported as a failed match rather
    // than escaping into the TLS handshake, where it would surface as an unrelated crash
    const { certDer } = generateTestCert();
    const leaf = new nodeCrypto.X509Certificate(certDer);
    const hostile = {
        usage: 3,
        selector: 1,
        mtype: 1,
        get cert() {
            throw new Error('malformed association data');
        }
    };

    const result = dane.verifyCertAgainstTlsa(leaf, [hostile], null);
    assert.strictEqual(result.valid, false, 'A record that throws must not be treated as a match');
    assert.ok(result.error.includes('malformed association data'), 'The underlying reason should be reported');
});

test('verifyCertUnhashableCertDataDoesNotMatch', async () => {
    // If the certificate data cannot be read or hashed, there is nothing to compare
    // against and verification has to fail. Returning a match here, or letting the error
    // escape, would turn a malformed certificate into a successful DANE check.
    const record = [{ usage: 3, selector: 0, mtype: 1, cert: Buffer.alloc(32) }];

    for (const raw of [42, {}, true]) {
        const result = dane.verifyCertAgainstTlsa({ raw }, record, null);
        assert.strictEqual(result.valid, false, `Certificate data of type ${typeof raw} must not produce a match`);
        assert.ok(result.error.includes('Failed to hash'), 'The failure should say the data could not be hashed');
    }

    // Reading the certificate data at all may throw; that is a failure too, not a match
    const throwingCert = {
        get raw() {
            throw new Error('unreadable certificate');
        }
    };
    const result = dane.verifyCertAgainstTlsa(throwingCert, record, null);
    assert.strictEqual(result.valid, false, 'A certificate that throws while being read must not match');
});
