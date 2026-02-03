'use strict';

const nodeCrypto = require('node:crypto');
const dns = require('dns');
const util = require('util');

// Check if native dns.resolveTlsa is available (Node.js v22.15.0+, v23.9.0+)
const hasNativeResolveTlsa = typeof dns.resolveTlsa === 'function';

/**
 * DANE Usage Types (RFC 6698)
 * 0 - PKIX-TA: CA constraint
 * 1 - PKIX-EE: Service certificate constraint
 * 2 - DANE-TA: Trust anchor assertion
 * 3 - DANE-EE: Domain-issued certificate
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
            if (err.code === 'ENODATA' || err.code === 'ENOTFOUND' || err.code === 'ENOENT') {
                return [];
            }
            throw err;
        }
    }

    // Use native dns.resolveTlsa if available
    if (hasNativeResolveTlsa) {
        const resolveTlsaAsync = util.promisify(dns.resolveTlsa);
        try {
            const records = await resolveTlsaAsync(tlsaName);
            return records || [];
        } catch (err) {
            // NODATA or NXDOMAIN means no DANE records exist
            if (err.code === 'ENODATA' || err.code === 'ENOTFOUND' || err.code === 'ENOENT') {
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
 * @returns {Buffer} The SPKI in DER format
 */
function extractSPKI(cert) {
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
}

/**
 * Get the certificate data to match based on selector
 * @param {Object} cert - X509 certificate object
 * @param {number} selector - DANE selector (0=full cert, 1=SPKI)
 * @returns {Buffer} The data to match
 */
function getCertData(cert, selector) {
    if (selector === DANE_SELECTOR.SPKI) {
        return extractSPKI(cert);
    }
    // Full certificate in DER format
    return cert.raw;
}

/**
 * Hash the certificate data based on matching type
 * @param {Buffer} data - The certificate data
 * @param {number} matchingType - DANE matching type (0=full, 1=SHA-256, 2=SHA-512)
 * @returns {Buffer} The hashed or raw data
 */
function hashCertData(data, matchingType) {
    if (!data) {
        return null;
    }

    switch (matchingType) {
        case DANE_MATCHING_TYPE.SHA256:
            return nodeCrypto.createHash('sha256').update(data).digest();
        case DANE_MATCHING_TYPE.SHA512:
            return nodeCrypto.createHash('sha512').update(data).digest();
        case DANE_MATCHING_TYPE.FULL:
        default:
            return data;
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

    for (const record of tlsaRecords) {
        const usage = record.usage;
        const selector = record.selector;
        const matchingType = record.mtype !== undefined ? record.mtype : record.matchingType;
        const certAssocData = record.cert || record.data;

        if (!certAssocData) {
            continue;
        }

        // Convert cert association data to Buffer if needed
        const expectedData = Buffer.isBuffer(certAssocData) ? certAssocData : Buffer.from(certAssocData, 'hex');

        // For DANE-EE (usage 3), verify against the end-entity certificate
        if (usage === DANE_USAGE.DANE_EE || usage === DANE_USAGE.PKIX_EE) {
            const certData = getCertData(cert, selector);
            const hashedData = hashCertData(certData, matchingType);

            if (hashedData && expectedData.equals(hashedData)) {
                return {
                    valid: true,
                    matchedRecord: record,
                    error: null,
                    usage: usage === DANE_USAGE.DANE_EE ? 'DANE-EE' : 'PKIX-EE'
                };
            }
        }

        // For DANE-TA (usage 2), verify against the trust anchor in the chain
        if ((usage === DANE_USAGE.DANE_TA || usage === DANE_USAGE.PKIX_TA) && chain && chain.length > 0) {
            for (const chainCert of chain) {
                const certData = getCertData(chainCert, selector);
                const hashedData = hashCertData(certData, matchingType);

                if (hashedData && expectedData.equals(hashedData)) {
                    return {
                        valid: true,
                        matchedRecord: record,
                        error: null,
                        usage: usage === DANE_USAGE.DANE_TA ? 'DANE-TA' : 'PKIX-TA'
                    };
                }
            }
        }
    }

    return {
        valid: false,
        matchedRecord: null,
        error: 'Certificate did not match any TLSA record'
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
    };
}

module.exports = {
    DANE_USAGE,
    DANE_SELECTOR,
    DANE_MATCHING_TYPE,
    EMPTY_DANE_HANDLER,
    hasNativeResolveTlsa,
    resolveTlsaRecords,
    verifyCertAgainstTlsa,
    createDaneVerifier,
    extractSPKI,
    getCertData,
    hashCertData
};
