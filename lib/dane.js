'use strict';

const nodeCrypto = require('node:crypto');
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
 * Resolve TLSA records for a given hostname and port
 * @param {string} hostname - The MX hostname
 * @param {number} port - The port number (default 25)
 * @param {Object} options - DANE options with optional custom resolver
 * @returns {Promise<Array>} Array of TLSA records
 */
async function resolveTlsaRecords(hostname, port, options) {
    const tlsaName = `_${port}._tcp.${hostname}`;

    // Use custom resolver if provided
    if (options.resolveTlsa && typeof options.resolveTlsa === 'function') {
        try {
            const records = await options.resolveTlsa(tlsaName);
            return records || [];
        } catch (err) {
            // NODATA or NXDOMAIN means no DANE records exist
            if (isNoRecordsError(err.code)) {
                return [];
            }
            throw err;
        }
    }

    // Use native dns.promises.resolveTlsa if available (preferred)
    if (hasNativePromiseResolveTlsa) {
        try {
            const records = await dns.promises.resolveTlsa(tlsaName);
            return records || [];
        } catch (err) {
            if (isNoRecordsError(err.code)) {
                return [];
            }
            throw err;
        }
    }

    // Use cached promisified dns.resolveTlsa if available
    if (resolveTlsaAsync) {
        try {
            const records = await resolveTlsaAsync(tlsaName);
            return records || [];
        } catch (err) {
            if (isNoRecordsError(err.code)) {
                return [];
            }
            throw err;
        }
    }

    // No resolver available
    return [];
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

    for (const record of tlsaRecords) {
        // Issue #4: Wrap each record verification in try/catch
        try {
            const usage = record.usage;
            const selector = record.selector;
            const matchingType = record.mtype !== undefined ? record.mtype : record.matchingType;
            const certAssocData = record.cert || record.data;

            if (!certAssocData) {
                continue;
            }

            // Convert cert association data to Buffer if needed
            let expectedData;
            if (Buffer.isBuffer(certAssocData)) {
                expectedData = certAssocData;
            } else if (certAssocData instanceof ArrayBuffer || ArrayBuffer.isView(certAssocData)) {
                expectedData = Buffer.from(certAssocData);
            } else if (typeof certAssocData === 'string') {
                expectedData = Buffer.from(certAssocData, 'hex');
            } else {
                continue;
            }

            // For DANE-EE (usage 3) and PKIX-EE (usage 1), verify against the end-entity certificate
            // Note: PKIX-EE should also perform PKIX path validation per RFC 6698, but this is not
            // currently implemented. The certificate will be validated against the system CA store
            // by the TLS layer separately.
            if (usage === DANE_USAGE.DANE_EE || usage === DANE_USAGE.PKIX_EE) {
                const certData = getCertData(cert, selector);
                if (!certData) {
                    errors.push(`Failed to extract certificate data for selector ${selector}`);
                    continue;
                }

                const hashedData = hashCertData(certData, matchingType);
                if (!hashedData) {
                    errors.push(`Failed to hash certificate data for matching type ${matchingType}`);
                    continue;
                }

                if (expectedData.equals(hashedData)) {
                    return {
                        valid: true,
                        matchedRecord: record,
                        error: null,
                        usage: usage === DANE_USAGE.DANE_EE ? 'DANE-EE' : 'PKIX-EE'
                    };
                }
            }

            // For DANE-TA (usage 2) and PKIX-TA (usage 0), verify against the trust anchor in the chain
            // Note: This requires the certificate chain to be provided. In the standard TLS
            // checkServerIdentity callback, only the peer certificate is available. The chain
            // must be obtained separately (e.g., via socket.getPeerCertificate(true)).
            if ((usage === DANE_USAGE.DANE_TA || usage === DANE_USAGE.PKIX_TA) && chain && chain.length > 0) {
                for (const chainCert of chain) {
                    const certData = getCertData(chainCert, selector);
                    if (!certData) {
                        continue;
                    }

                    const hashedData = hashCertData(certData, matchingType);
                    if (!hashedData) {
                        continue;
                    }

                    if (expectedData.equals(hashedData)) {
                        return {
                            valid: true,
                            matchedRecord: record,
                            error: null,
                            usage: usage === DANE_USAGE.DANE_TA ? 'DANE-TA' : 'PKIX-TA'
                        };
                    }
                }
            }

            // Log warning for DANE-TA/PKIX-TA without chain (Issue #3)
            if ((usage === DANE_USAGE.DANE_TA || usage === DANE_USAGE.PKIX_TA) && (!chain || chain.length === 0)) {
                errors.push(`TLSA record with usage ${usage} (${usage === DANE_USAGE.DANE_TA ? 'DANE-TA' : 'PKIX-TA'}) requires certificate chain which is not available`);
            }
        } catch (err) {
            // Continue to next record on error
            errors.push(`Error processing TLSA record: ${err.message}`);
            continue;
        }
    }

    return {
        valid: false,
        matchedRecord: null,
        error: errors.length > 0 ? errors.join('; ') : 'Certificate did not match any TLSA record'
    };
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
            // No TLSA records, fall back to normal verification
            return undefined;
        }

        // Issue #1, #2, #4: Wrap entire verification in try/catch
        try {
            const result = verifyCertAgainstTlsa(cert, tlsaRecords);

            if (!result.valid && !result.noRecords) {
                const error = new Error(`DANE verification failed for ${hostname}: ${result.error}`);
                error.code = 'DANE_VERIFICATION_FAILED';
                error.category = 'dane';

                if (options.logger) {
                    options.logger({
                        msg: 'DANE verification failed',
                        action: 'dane',
                        success: false,
                        hostname,
                        error: result.error
                    });
                }

                if (options.verify !== false) {
                    return error;
                }
            }

            if (result.valid && result.matchedRecord && options.logger) {
                options.logger({
                    msg: 'DANE verification succeeded',
                    action: 'dane',
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

            // Return undefined to indicate success (standard TLS behavior)
            return undefined;
        } catch (err) {
            // Log the error but don't crash
            if (options.logger) {
                options.logger({
                    msg: 'DANE verification error',
                    action: 'dane',
                    success: false,
                    hostname,
                    error: err.message
                });
            }

            // If verify is enabled, return the error
            if (options.verify !== false) {
                const error = new Error(`DANE verification error for ${hostname}: ${err.message}`);
                error.code = 'DANE_VERIFICATION_ERROR';
                error.category = 'dane';
                return error;
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
