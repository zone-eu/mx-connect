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
 * but does not perform additional PKIX path validation.
 *
 * DANE-TA (usage=2) and PKIX-TA (usage=0) need the issuer chain, which Node does not
 * pass to a checkServerIdentity callback - the caller must hand it to the verifier
 * explicitly. When it is supplied, the pinned certificate must lie on a signature
 * verified path from the end-entity certificate; a certificate that merely appears
 * in the chain is not accepted (see buildVerifiedPath).
 *
 * Remaining gap: usage=0 does not additionally require PKIX path validation to have
 * succeeded (RFC 7671 Section 5.1). RFC 7672 Section 3.1 makes usages 0 and 1
 * inapplicable to SMTP in any case; prefer DANE-EE (usage=3).
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
 * @param {Object} cert - X509 certificate object (X509Certificate or raw peer cert)
 * @returns {Buffer|null} The SPKI in DER format, or null if extraction fails
 */
function extractSPKI(cert) {
    try {
        // Case 1: X509Certificate object (Node.js 15+)
        // .publicKey is a KeyObject — use .export() directly.
        // NOTE: crypto.createPublicKey(KeyObject) does NOT work — it throws
        // "Invalid key object type public, expected private".
        if (cert.publicKey && typeof cert.publicKey === 'object' && typeof cert.publicKey.export === 'function') {
            return cert.publicKey.export({ type: 'spki', format: 'der' });
        }

        // Case 2: Raw peer certificate from tls.getPeerCertificate()
        // IMPORTANT: cert.pubkey is the RAW public key bytes (e.g. 65 bytes
        // for EC P-256), NOT the SubjectPublicKeyInfo (SPKI) DER encoding.
        // SPKI wraps the raw key with an ASN.1 header containing the algorithm
        // OID (e.g. 91 bytes for EC P-256).  TLSA records hash the SPKI, so
        // we must reconstruct it from the full certificate DER (cert.raw).
        if (cert.raw) {
            const x509 = new nodeCrypto.X509Certificate(cert.raw);
            return x509.publicKey.export({ type: 'spki', format: 'der' });
        }

        // Case 3: PEM-encoded public key string (unlikely but handle gracefully)
        if (typeof cert.publicKey === 'string') {
            return nodeCrypto.createPublicKey(cert.publicKey).export({
                type: 'spki',
                format: 'der'
            });
        }

        return null;
    } catch {
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
    // Handle JSON-deserialized Buffer objects ({"type":"Buffer","data":[...]})
    // that come back from cache stores (e.g. Redis) after JSON round-tripping:
    // JSON.parse(JSON.stringify(buf)) produces a plain object, not a Buffer.
    if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
        return Buffer.from(data.data);
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
 * Coerce a certificate-like value into an X509Certificate.
 *
 * Accepts both X509Certificate instances and the raw peer certificate objects
 * returned by tls.getPeerCertificate(), which carry the DER in `.raw`.
 *
 * @param {Object} cert - Certificate to coerce
 * @returns {nodeCrypto.X509Certificate|null} The certificate, or null if it cannot be parsed
 * @private
 */
function toX509(cert) {
    if (!cert) {
        return null;
    }

    if (cert instanceof nodeCrypto.X509Certificate) {
        return cert;
    }

    try {
        const raw = toBuffer(cert.raw);
        return raw ? new nodeCrypto.X509Certificate(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Build the certificate path running from the end-entity certificate up through
 * the supplied issuer chain, verifying the issuer signature at every hop.
 *
 * This is what makes a DANE-TA/PKIX-TA match meaningful. Without it, "the TLSA
 * record matches some certificate the peer sent" is not a statement about the
 * certificate the peer is actually presenting: an attacker can append the
 * pinned trust anchor (a public value, readable from the real server) to a
 * chain for their own unrelated certificate and be trusted. Only certificates
 * that genuinely issued the leaf, transitively, may be considered.
 *
 * Returns null if the path cannot be established, so callers fail closed.
 *
 * @param {Object} cert - The end-entity certificate presented by the server
 * @param {Array} chain - Issuer certificates supplied by the caller
 * @returns {Array<nodeCrypto.X509Certificate>|null} Certificates on the verified path, leaf first
 * @private
 */
function buildVerifiedPath(cert, chain) {
    const leaf = toX509(cert);
    if (!leaf) {
        return null;
    }

    const issuers = [];
    for (const entry of chain) {
        const x509 = toX509(entry);
        if (!x509) {
            // An entry we cannot parse might be the link we need, so refuse to
            // reason about this chain at all rather than skipping past it.
            return null;
        }
        issuers.push(x509);
    }

    const path = [leaf];
    const used = new Set();
    let current = leaf;

    // Each hop consumes one issuer, so this terminates even if the peer sends
    // a chain containing cycles or repeated certificates.
    for (;;) {
        const next = issuers.findIndex((candidate, index) => {
            if (used.has(index)) {
                return false;
            }
            try {
                return current.checkIssued(candidate) && current.verify(candidate.publicKey);
            } catch {
                return false;
            }
        });

        if (next === -1) {
            break;
        }

        used.add(next);
        current = issuers[next];
        path.push(current);
    }

    return path;
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

    // Built lazily on the first trust-anchor record and reused across records.
    // undefined = not yet attempted, null = no verifiable path exists.
    let verifiedPath;

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

            // For DANE-TA (usage 2) and PKIX-TA (usage 0), the record pins a trust
            // anchor, so the match must be against a certificate that actually
            // issued the presented leaf - not merely one the peer sent along.
            if (isTA) {
                if (!hasChain) {
                    errors.push(`TLSA record with usage ${usage} (${USAGE_LABELS[usage]}) requires certificate chain which is not available`);
                    continue;
                }

                if (verifiedPath === undefined) {
                    verifiedPath = buildVerifiedPath(cert, chain);
                }

                if (!verifiedPath) {
                    errors.push(
                        `TLSA record with usage ${usage} (${USAGE_LABELS[usage]}) could not be checked: no verified path from the server certificate through the supplied chain`
                    );
                    continue;
                }

                for (const pathCert of verifiedPath) {
                    const result = matchCert(pathCert, selector, matchingType, expectedData);
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
 * @returns {Function} checkServerIdentity(hostname, cert, chain) - Returns undefined on
 *   success or an Error on failure. The optional `chain` parameter is an array of
 *   X509Certificate objects representing the issuer chain, required for DANE-TA (usage 2)
 *   and PKIX-TA (usage 0) verification.
 */
function createDaneVerifier(tlsaRecords, options) {
    // Capture only the logger: the returned function is retained for the whole
    // connection, and holding the full options object would keep the caller's
    // resolveTlsa/checkDnssecSecure callbacks (and whatever they close over)
    // alive alongside it.
    const logOptions = { logger: (options && options.logger) || null };

    return function checkServerIdentity(hostname, cert, chain) {
        if (!tlsaRecords || tlsaRecords.length === 0) {
            return undefined;
        }

        try {
            const result = verifyCertAgainstTlsa(cert, tlsaRecords, chain);

            if (!result.valid && !result.noRecords) {
                logDane(logOptions, { msg: 'DANE verification failed', success: false, hostname, error: result.error });

                // RFC 7672 Section 2.2: fatal whenever usable TLSA records are present, no opt-out
                return daneError(`DANE verification failed for ${hostname}: ${result.error}`, 'DANE_VERIFICATION_FAILED');
            }

            if (result.valid && result.matchedRecord) {
                logDane(logOptions, {
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
            logDane(logOptions, { msg: 'DANE verification error', success: false, hostname, error: err.message });

            return daneError(`DANE verification error for ${hostname}: ${err.message}`, 'DANE_VERIFICATION_ERROR');
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
    isNoRecordsError,
    toBuffer
};
