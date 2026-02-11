'use strict';

const nodeCrypto = require('crypto');
const dns = require('dns');
const util = require('util');

// Check if native dns.resolveTlsa is available (Node.js v22.15.0+, v23.9.0+)
// Also check dns.promises.resolveTlsa for native promise support
const hasNativeResolveTlsa = typeof dns.resolveTlsa === 'function';
const hasNativePromiseResolveTlsa = dns.promises && typeof dns.promises.resolveTlsa === 'function';

// Cache the promisified version to avoid creating it on every call (Issue #5)
const resolveTlsaAsync = hasNativeResolveTlsa ? util.promisify(dns.resolveTlsa) : null;

/**
 * DANE Usage Types (RFC 6698)
 * 0 - PKIX-TA: CA constraint
 * 1 - PKIX-EE: Service certificate constraint
 * 2 - DANE-TA: Trust anchor assertion
 * 3 - DANE-EE: Domain-issued certificate
 *
 * Note: DANE-EE (usage=3) is fully supported. PKIX-EE (usage=1) performs TLSA matching
 * but does not perform additional PKIX path validation. DANE-TA (usage=2) and PKIX-TA
 * (usage=0) require the full certificate chain which is not available in the standard
 * TLS checkServerIdentity callback - these will only work if the chain is explicitly
 * provided or if the matching certificate is the end-entity certificate itself.
 */
const DANE_USAGE = {
    PKIX_TA: 0,
    PKIX_EE: 1,
    DANE_TA: 2,
    DANE_EE: 3
};

/**
 * DANE Selector Types (RFC 6698)
 * 0 - Full certificate
 * 1 - SubjectPublicKeyInfo
 */
const DANE_SELECTOR = {
    FULL_CERT: 0,
    SPKI: 1
};

/**
 * DANE Matching Types (RFC 6698)
 * 0 - No hash (full data)
 * 1 - SHA-256
 * 2 - SHA-512
 */
const DANE_MATCHING_TYPE = {
    FULL: 0,
    SHA256: 1,
    SHA512: 2
};

/**
 * Default empty DANE handler for when DANE is disabled
 */
const EMPTY_DANE_HANDLER = {
    enabled: false,
    async resolveTlsa(/* hostname */) {
        return [];
    }
};

/**
 * Check if an error code indicates no records exist (not a failure)
 * @param {string} code - Error code
 * @returns {boolean} True if the error indicates no records
 */
function isNoRecordsError(code) {
    return code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ENOENT';
}

/**
 * Calls a TLSA resolver and returns records, treating "no records" errors as empty results.
 * @param {Function} resolver - Async function that resolves TLSA records
 * @param {string} tlsaName - The TLSA query name (e.g., _25._tcp.mail.example.com)
 * @returns {Promise<Array>} Array of TLSA records
 * @private
 */
async function callTlsaResolver(resolver, tlsaName) {
    try {
        const records = await resolver(tlsaName);
        return records || [];
    } catch (err) {
        if (isNoRecordsError(err.code)) {
            return [];
        }
        throw err;
    }
}

/**
 * Resolve TLSA records for a given hostname and port
 * @param {string} hostname - The MX hostname
 * @param {number} port - The port number (default 25)
 * @param {Object} options - DANE options with optional custom resolver
 * @returns {Promise<Array>} Array of TLSA records
 */
function resolveTlsaRecords(hostname, port, options) {
    const tlsaName = `_${port}._tcp.${hostname}`;

    // Select resolver: custom > native promise > promisified callback
    const resolver =
        (typeof options.resolveTlsa === 'function' && options.resolveTlsa) || (hasNativePromiseResolveTlsa && dns.promises.resolveTlsa) || resolveTlsaAsync;

    if (!resolver) {
        return Promise.resolve([]);
    }

    return callTlsaResolver(resolver, tlsaName);
}

/**
 * Extract the SubjectPublicKeyInfo from a certificate
 * @param {Object} cert - X509 certificate object
 * @returns {Buffer|null} The SPKI in DER format, or null if extraction fails
 */
function extractSPKI(cert) {
    // Issue #1: Wrap in try/catch to handle malformed certificates
    try {
        // Get the public key in DER format
        const publicKey = cert.publicKey;
        if (!publicKey) {
            return null;
        }

        // Export as SPKI (SubjectPublicKeyInfo)
        return nodeCrypto.createPublicKey(publicKey).export({
            type: 'spki',
            format: 'der'
        });
    } catch {
        // Return null for malformed certificates instead of crashing
        return null;
    }
}

/**
 * Get the certificate data to match based on selector
 * @param {Object} cert - X509 certificate object
 * @param {number} selector - DANE selector (0=full cert, 1=SPKI)
 * @returns {Buffer|null} The data to match, or null if extraction fails
 */
function getCertData(cert, selector) {
    // Issue #2: Add null checks and try/catch protection
    try {
        if (!cert) {
            return null;
        }

        if (selector === DANE_SELECTOR.SPKI) {
            return extractSPKI(cert);
        }

        // Full certificate in DER format
        // cert.raw may not exist or may throw on malformed certs
        return cert.raw || null;
    } catch {
        return null;
    }
}

/**
 * Hash the certificate data based on matching type
 * @param {Buffer} data - The certificate data
 * @param {number} matchingType - DANE matching type (0=full, 1=SHA-256, 2=SHA-512)
 * @returns {Buffer|null} The hashed or raw data
 */
function hashCertData(data, matchingType) {
    if (!data) {
        return null;
    }

    try {
        switch (matchingType) {
            case DANE_MATCHING_TYPE.SHA256:
                return nodeCrypto.createHash('sha256').update(data).digest();
            case DANE_MATCHING_TYPE.SHA512:
                return nodeCrypto.createHash('sha512').update(data).digest();
            case DANE_MATCHING_TYPE.FULL:
            default:
                return data;
        }
    } catch {
        return null;
    }
}

/**
 * Maps DANE usage values to human-readable labels
 */
const USAGE_LABELS = {
    [DANE_USAGE.PKIX_TA]: 'PKIX-TA',
    [DANE_USAGE.PKIX_EE]: 'PKIX-EE',
    [DANE_USAGE.DANE_TA]: 'DANE-TA',
    [DANE_USAGE.DANE_EE]: 'DANE-EE'
};

/**
 * Convert cert association data to a Buffer.
 * Returns null if the data type is not supported.
 * @param {Buffer|ArrayBuffer|ArrayBufferView|string} data - The cert association data
 * @returns {Buffer|null}
 * @private
 */
function toBuffer(data) {
    if (Buffer.isBuffer(data)) {
        return data;
    }
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        return Buffer.from(data);
    }
    if (typeof data === 'string') {
        return Buffer.from(data, 'hex');
    }
    return null;
}

/**
 * Try to match a single certificate against expected TLSA data.
 * @param {Object} certToCheck - The certificate to verify
 * @param {number} selector - DANE selector
 * @param {number} matchingType - DANE matching type
 * @param {Buffer} expectedData - The expected cert association data
 * @returns {{matched: boolean, error: string|null}}
 * @private
 */
function matchCert(certToCheck, selector, matchingType, expectedData) {
    const certData = getCertData(certToCheck, selector);
    if (!certData) {
        return { matched: false, error: `Failed to extract certificate data for selector ${selector}` };
    }

    const hashedData = hashCertData(certData, matchingType);
    if (!hashedData) {
        return { matched: false, error: `Failed to hash certificate data for matching type ${matchingType}` };
    }

    return { matched: expectedData.equals(hashedData), error: null };
}

/**
 * Verify a certificate against TLSA records
 * @param {Object} cert - The server certificate (X509Certificate or peer certificate)
 * @param {Array} tlsaRecords - Array of TLSA records
 * @param {Array} [chain] - Optional certificate chain for DANE-TA verification
 * @returns {Object} Verification result { valid: boolean, matchedRecord: Object|null, error: string|null }
 */
function verifyCertAgainstTlsa(cert, tlsaRecords, chain) {
    if (!tlsaRecords || tlsaRecords.length === 0) {
        return { valid: true, matchedRecord: null, error: null, noRecords: true };
    }

    if (!cert) {
        return { valid: false, matchedRecord: null, error: 'No certificate provided' };
    }

    const errors = [];
    const hasChain = chain && chain.length > 0;

    for (const record of tlsaRecords) {
        try {
            const { usage, selector } = record;
            const matchingType = record.mtype !== undefined ? record.mtype : record.matchingType;
            const expectedData = toBuffer(record.cert || record.data);

            if (!expectedData) {
                continue;
            }

            const isEE = usage === DANE_USAGE.DANE_EE || usage === DANE_USAGE.PKIX_EE;
            const isTA = usage === DANE_USAGE.DANE_TA || usage === DANE_USAGE.PKIX_TA;

            // For DANE-EE (usage 3) and PKIX-EE (usage 1), verify against the end-entity certificate
            if (isEE) {
                const result = matchCert(cert, selector, matchingType, expectedData);
                if (result.error) {
                    errors.push(result.error);
                    continue;
                }
                if (result.matched) {
                    return { valid: true, matchedRecord: record, error: null, usage: USAGE_LABELS[usage] };
                }
            }

            // For DANE-TA (usage 2) and PKIX-TA (usage 0), verify against the trust anchor in the chain
            if (isTA) {
                if (!hasChain) {
                    errors.push(`TLSA record with usage ${usage} (${USAGE_LABELS[usage]}) requires certificate chain which is not available`);
                    continue;
                }
                for (const chainCert of chain) {
                    const result = matchCert(chainCert, selector, matchingType, expectedData);
                    if (result.matched) {
                        return { valid: true, matchedRecord: record, error: null, usage: USAGE_LABELS[usage] };
                    }
                }
            }
        } catch (err) {
            errors.push(`Error processing TLSA record: ${err.message}`);
        }
    }

    return {
        valid: false,
        matchedRecord: null,
        error: errors.length > 0 ? errors.join('; ') : 'Certificate did not match any TLSA record'
    };
}

/**
 * Logs a DANE event if a logger is configured
 * @param {Object} options - DANE options with optional logger
 * @param {Object} entry - Log entry fields
 * @private
 */
function logDane(options, entry) {
    if (options.logger) {
        options.logger(Object.assign({ action: 'dane' }, entry));
    }
}

/**
 * Creates a DANE error with standard properties
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @returns {Error}
 * @private
 */
function daneError(message, code) {
    const error = new Error(message);
    error.code = code;
    error.category = 'dane';
    return error;
}

/**
 * Create a TLS verification function for DANE
 * @param {Array} tlsaRecords - Array of TLSA records
 * @param {Object} options - DANE options
 * @returns {Function} TLS checkServerIdentity function
 */
function createDaneVerifier(tlsaRecords, options) {
    return function checkServerIdentity(hostname, cert) {
        if (!tlsaRecords || tlsaRecords.length === 0) {
            return undefined;
        }

        try {
            const result = verifyCertAgainstTlsa(cert, tlsaRecords);

            if (!result.valid && !result.noRecords) {
                logDane(options, { msg: 'DANE verification failed', success: false, hostname, error: result.error });

                if (options.verify !== false) {
                    return daneError(`DANE verification failed for ${hostname}: ${result.error}`, 'DANE_VERIFICATION_FAILED');
                }
            }

            if (result.valid && result.matchedRecord) {
                logDane(options, {
                    msg: 'DANE verification succeeded',
                    success: true,
                    hostname,
                    usage: result.usage,
                    matchedRecord: {
                        usage: result.matchedRecord.usage,
                        selector: result.matchedRecord.selector,
                        matchingType: result.matchedRecord.mtype || result.matchedRecord.matchingType
                    }
                });
            }

            return undefined;
        } catch (err) {
            logDane(options, { msg: 'DANE verification error', success: false, hostname, error: err.message });

            if (options.verify !== false) {
                return daneError(`DANE verification error for ${hostname}: ${err.message}`, 'DANE_VERIFICATION_ERROR');
            }

            return undefined;
        }
    };
}

module.exports = {
    DANE_USAGE,
    DANE_SELECTOR,
    DANE_MATCHING_TYPE,
    EMPTY_DANE_HANDLER,
    hasNativeResolveTlsa,
    hasNativePromiseResolveTlsa,
    resolveTlsaRecords,
    verifyCertAgainstTlsa,
    createDaneVerifier,
    extractSPKI,
    getCertData,
    hashCertData,
    isNoRecordsError
};
