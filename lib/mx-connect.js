/**
 * @fileoverview Main entry point for mx-connect library.
 * Establishes TCP connections to Mail Exchange (MX) servers for a given domain or email address.
 * Supports both callback and promise APIs, MTA-STS policy validation, DANE/TLSA verification,
 * and customizable DNS resolvers.
 *
 * Pipeline flow:
 * formatAddress -> resolvePolicy -> [resolveMX] -> validateMxPolicy -> [resolveIP] -> [resolveDaneTlsa] -> getConnection
 *
 * @module mx-connect
 */

'use strict';

const formatAddress = require('./format-address');
const resolveMX = require('./resolve-mx');
const resolveIP = require('./resolve-ip');
const getConnection = require('./get-connection');
const dane = require('./dane');
const net = require('net');
const dns = require('dns');
const { getPolicy, validateMx } = require('mailauth/lib/mta-sts');
const util = require('util');

/**
 * Default no-op cache handler for MTA-STS policies.
 * Used when no cache is provided - policies will be fetched fresh each time.
 * @private
 */
const EMPTY_CACHE_HANDLER = {
    async get() {
        return false;
    },
    async set() {
        return false;
    }
};

/**
 * Fetches and caches MTA-STS policy for the domain (if MTA-STS is enabled).
 *
 * MTA-STS (RFC 8461) allows domains to publish security policies via HTTPS
 * that specify which MX hostnames are valid and require TLS.
 *
 * Uses the user-provided cache to avoid repeated HTTPS fetches.
 * If the policy is already cached and fresh, uses cached version.
 *
 * @param {Object} delivery - The delivery object
 * @param {Object} delivery.mtaSts - MTA-STS configuration
 * @param {boolean} delivery.mtaSts.enabled - Whether to check MTA-STS
 * @param {Object} delivery.mtaSts.cache - Cache handler with get/set methods
 * @returns {Promise<Object>} Delivery object with mtaSts.policy populated
 * @private
 */
async function resolvePolicy(delivery) {
    if (!delivery.mtaSts.enabled) {
        return delivery;
    }

    // Check cache first
    const knownPolicy = await delivery.mtaSts.cache.get(delivery.decodedDomain);
    // Promisify custom DNS resolver for mailauth compatibility
    const resolver = delivery.dnsOptions && delivery.dnsOptions.resolve ? util.promisify(delivery.dnsOptions.resolve) : undefined;
    const { policy, status } = await getPolicy(delivery.decodedDomain, knownPolicy, { resolver });

    // Cache newly fetched or updated policies
    if (status !== 'cached') {
        await delivery.mtaSts.cache.set(delivery.decodedDomain, policy);
    }

    delivery.mtaSts.policy = policy;
    return delivery;
}

/**
 * Validates resolved MX hostnames against the domain's MTA-STS policy.
 *
 * Each MX entry gets a policyMatch object indicating whether it's valid
 * according to the policy. Invalid MX entries in "enforce" mode will be
 * rejected during connection; in "testing" mode they're logged but allowed.
 *
 * @param {Object} delivery - The delivery object with resolved MX entries
 * @param {Array} delivery.mx - MX entries to validate
 * @param {Object} delivery.mtaSts.policy - The fetched MTA-STS policy
 * @returns {Promise<Object>} Delivery object with policyMatch added to each MX entry
 * @private
 */
async function validateMxPolicy(delivery) {
    if (!delivery.mtaSts.enabled) {
        return delivery;
    }

    // Validate each MX hostname against the policy
    for (const mx of delivery.mx) {
        mx.policyMatch = validateMx(mx.exchange, delivery.mtaSts.policy);
    }

    return delivery;
}

/**
 * Resolve TLSA records for all MX hosts (if DANE is enabled).
 *
 * DANE (RFC 6698) allows domains to publish TLSA records that specify
 * which TLS certificates are valid for their mail servers.
 *
 * @param {Object} delivery - The delivery object with resolved MX entries
 * @returns {Promise<Object>} Delivery object with tlsaRecords added to each MX entry
 * @private
 */
async function resolveDaneTlsa(delivery) {
    if (!delivery.dane || !delivery.dane.enabled) {
        return delivery;
    }

    const port = delivery.port || 25;

    // Resolve TLSA records for each MX host in parallel
    const tlsaPromises = delivery.mx.map(async mx => {
        // Skip if TLSA records are already provided
        if (mx.tlsaRecords && mx.tlsaRecords.length > 0) {
            return;
        }

        try {
            const records = await dane.resolveTlsaRecords(mx.exchange, port, delivery.dane);
            mx.tlsaRecords = records;

            if (records.length > 0 && delivery.dane.logger) {
                delivery.dane.logger({
                    msg: 'TLSA records found',
                    action: 'dane',
                    success: true,
                    hostname: mx.exchange,
                    domain: delivery.domain,
                    recordCount: records.length
                });
            }
        } catch (err) {
            // Issue #7: DNS errors (SERVFAIL, timeout) should not silently bypass DANE
            // when verify mode is enabled. NODATA/NXDOMAIN are acceptable (no DANE records).
            const isNoRecords = dane.isNoRecordsError && dane.isNoRecordsError(err.code);

            if (delivery.dane.logger) {
                delivery.dane.logger({
                    msg: 'TLSA lookup failed',
                    action: 'dane',
                    success: false,
                    hostname: mx.exchange,
                    domain: delivery.domain,
                    error: err.message,
                    code: err.code,
                    isNoRecords
                });
            }

            // If verify is enabled and this is a real DNS failure (not just "no records"),
            // mark the MX as having a DANE lookup failure so connection can handle it
            if (delivery.dane.verify !== false && !isNoRecords) {
                mx.tlsaRecords = [];
                mx.daneLookupFailed = true;
                mx.daneLookupError = err;
            } else {
                mx.tlsaRecords = [];
            }
        }
    });

    await Promise.all(tlsaPromises);

    return delivery;
}

/**
 * Normalizes user-provided MX entries to a consistent internal format.
 *
 * Accepts multiple input formats:
 * - String: treated as hostname or IP address with priority 0
 * - Object: { exchange, priority?, A?, AAAA?, tlsaRecords? }
 *
 * If the input is an IP address (string format), places it directly in
 * the appropriate A or AAAA array to skip DNS resolution.
 *
 * @param {string|Object} mx - User-provided MX entry
 * @returns {Object} Normalized entry: {exchange, priority, A: [], AAAA: [], mx: false, tlsaRecords: null}
 * @private
 */
function normalizeMxEntry(mx) {
    // String input - could be hostname or IP address
    if (typeof mx === 'string') {
        return {
            exchange: mx,
            priority: 0,
            A: net.isIPv4(mx) ? [mx] : [],
            AAAA: net.isIPv6(mx) ? [mx] : [],
            mx: false,
            tlsaRecords: null
        };
    }

    // Object input - extract and normalize properties
    const entry = {
        exchange: mx && mx.exchange,
        priority: Number(mx && mx.priority) || 0,
        A: [],
        AAAA: [],
        mx: false,
        tlsaRecords: (mx && mx.tlsaRecords) || null
    };

    // Copy pre-resolved addresses if provided
    if (mx && mx.A) {
        entry.A = [].concat(mx.A);
    }
    if (mx && mx.AAAA) {
        entry.AAAA = [].concat(mx.AAAA);
    }

    return entry;
}

/**
 * Extracts the domain from a target string.
 *
 * Handles both email addresses (user@domain.com) and bare domains (domain.com).
 * For email addresses, returns the portion after the @ sign.
 *
 * @param {string} target - Email address or domain name
 * @returns {string} The domain portion
 * @private
 */
function extractDomain(target) {
    const str = (target || '').toString().trim();
    const atPos = str.indexOf('@');
    return atPos >= 0 ? str.substring(atPos + 1) : str;
}

/**
 * Constructs the internal delivery object from user-provided options.
 *
 * The delivery object flows through the entire pipeline, accumulating
 * resolved data at each step. This function initializes it with user
 * configuration and sensible defaults.
 *
 * @param {Object} options - User-provided options
 * @param {string} options.target - Email address or domain to connect to
 * @param {Array} [options.mx] - Pre-resolved MX entries (skips DNS lookup)
 * @param {Object} [options.dnsOptions] - DNS configuration
 * @param {number} [options.port=25] - SMTP port
 * @param {number} [options.maxConnectTime] - Connection timeout per host (ms)
 * @param {string} [options.localAddress] - Local IP to bind to
 * @param {string} [options.localHostname] - Local hostname for HELO
 * @param {Function} [options.connectHook] - Pre-connection hook
 * @param {Function} [options.connectError] - Error notification callback
 * @param {Object} [options.mtaSts] - MTA-STS configuration
 * @param {Object} [options.dane] - DANE/TLSA configuration
 * @returns {Object} Initialized delivery object for pipeline processing
 * @private
 */
function buildDeliveryObject(options) {
    // Configure MTA-STS settings with defaults
    const mtaStsOptions = options.mtaSts || {};
    const mtaSts = {
        enabled: mtaStsOptions.enabled || false,
        logger: mtaStsOptions.logger || (() => false),
        cache: mtaStsOptions.cache || EMPTY_CACHE_HANDLER
    };

    // Configure DANE settings (requires explicit opt-in)
    const daneOptions = options.dane || {};
    const daneEnabled = daneOptions.enabled || false;

    const daneConfig = {
        enabled: daneEnabled,
        resolveTlsa: daneOptions.resolveTlsa || null,
        logger: daneOptions.logger || null,
        verify: daneOptions.verify !== undefined ? daneOptions.verify : true
    };

    return {
        // Target domain (extracted from email if needed)
        domain: extractDomain(options.target),
        // Pre-resolved MX entries (empty triggers DNS resolution)
        mx: (options.mx || []).map(normalizeMxEntry),

        // DNS resolution options
        dnsOptions: options.dnsOptions || {
            ignoreIPv6: false,
            preferIPv6: false,
            blockLocalAddresses: false,
            resolve: dns.resolve
        },

        // Connection settings
        port: options.port || 25,
        maxConnectTime: options.maxConnectTime,

        // Local address binding (supports separate IPv4/IPv6 addresses)
        localAddress: options.localAddress,
        localHostname: options.localHostname,
        localAddressIPv4: options.localAddressIPv4,
        localHostnameIPv4: options.localHostnameIPv4,
        localAddressIPv6: options.localAddressIPv6,
        localHostnameIPv6: options.localHostnameIPv6,

        // Callbacks
        connectHook: options.connectHook,
        connectError: options.connectError,

        // Host filtering
        ignoreMXHosts: options.ignoreMXHosts || [],
        mxLastError: options.mxLastError || false,

        // MTA-STS policy checking
        mtaSts,

        // DANE/TLSA verification
        dane: daneConfig
    };
}

/**
 * Builds the processing pipeline based on delivery state.
 *
 * The pipeline adapts based on user-provided data:
 * - If MX entries are pre-provided, skip resolveMX step
 * - If IP addresses are pre-resolved in MX entries, skip resolveIP step
 * - If DANE is enabled, add resolveDaneTlsa step
 *
 * This allows users to bypass DNS entirely for testing or special cases
 * (e.g., connecting through a proxy to a known IP).
 *
 * Full pipeline: formatAddress -> resolvePolicy -> resolveMX -> validateMxPolicy -> resolveIP -> resolveDaneTlsa -> getConnection
 * Minimal pipeline (MX+IP provided): formatAddress -> resolvePolicy -> validateMxPolicy -> [resolveDaneTlsa] -> getConnection
 *
 * @param {Object} delivery - The delivery object with current state
 * @returns {Array<Function>} Array of pipeline step functions
 * @private
 */
function buildPipeline(delivery) {
    const hasMx = delivery.mx.length > 0;
    // Check if any MX entry needs IP resolution (has hostname but no IPs)
    const needsIpResolution = hasMx && delivery.mx.some(mx => mx.exchange && !mx.A.length && !mx.AAAA.length);

    // Always start with address formatting and policy resolution
    const steps = [formatAddress, resolvePolicy];

    // Only resolve MX records if not pre-provided
    if (!hasMx) {
        steps.push(resolveMX);
    }

    // Always validate MX entries against MTA-STS policy (if enabled)
    steps.push(validateMxPolicy);

    // Only resolve IPs if MX entries need them
    if (!hasMx || needsIpResolution) {
        steps.push(resolveIP);
    }

    // Resolve DANE TLSA records if enabled
    if (delivery.dane && delivery.dane.enabled) {
        steps.push(resolveDaneTlsa);
    }

    // Always end with connection establishment
    steps.push(getConnection);

    return steps;
}

/**
 * Establishes a TCP connection to an MX server for the given target.
 *
 * Supports both callback and promise APIs:
 * - Promise: `const conn = await mxConnect(options)`
 * - Callback: `mxConnect(options, (err, conn) => { ... })`
 * - Hybrid: `mxConnect(options, callback).catch(globalHandler)`
 *
 * Always returns a Promise, even when callback is provided.
 *
 * @param {string|Object} options - Target domain/email or configuration object
 * @param {string} options.target - Email address or domain to connect to
 * @param {number} [options.port=25] - SMTP port to connect to
 * @param {number} [options.maxConnectTime] - Connection timeout per host (ms)
 * @param {string} [options.localAddress] - Local IP address to bind to
 * @param {string} [options.localHostname] - Local hostname for EHLO/HELO
 * @param {Object} [options.dnsOptions] - DNS resolution configuration
 * @param {boolean} [options.dnsOptions.ignoreIPv6=false] - Skip IPv6 addresses
 * @param {boolean} [options.dnsOptions.preferIPv6=false] - Try IPv6 before IPv4
 * @param {boolean} [options.dnsOptions.blockLocalAddresses=false] - Block private/loopback IPs
 * @param {Function} [options.dnsOptions.resolve] - Custom DNS resolver
 * @param {Array} [options.mx] - Pre-resolved MX entries (skips DNS MX lookup)
 * @param {Array} [options.ignoreMXHosts] - IP addresses to skip
 * @param {Function} [options.connectHook] - Pre-connection hook: (delivery, options, callback)
 * @param {Function} [options.connectError] - Error notification: (err, delivery, options)
 * @param {Object} [options.mtaSts] - MTA-STS configuration
 * @param {boolean} [options.mtaSts.enabled=false] - Enable MTA-STS policy checking
 * @param {Function} [options.mtaSts.logger] - MTA-STS event logger
 * @param {Object} [options.mtaSts.cache] - Policy cache with get/set methods
 * @param {Object} [options.dane] - DANE/TLSA configuration
 * @param {boolean} [options.dane.enabled] - Enable DANE verification (must be set to true explicitly)
 * @param {Function} [options.dane.resolveTlsa] - Custom TLSA resolver function
 * @param {Function} [options.dane.logger] - DANE event logger
 * @param {boolean} [options.dane.verify=true] - Enforce DANE verification (reject on failure)
 * @param {Function} [callback] - Node.js-style callback: (err, connection)
 * @returns {Promise<Object>} Connection result with socket and metadata
 * @returns {net.Socket} returns.socket - Connected TCP socket
 * @returns {string} returns.hostname - MX hostname
 * @returns {string} returns.host - IP address connected to
 * @returns {number} returns.port - Port connected to
 * @returns {string} returns.localAddress - Local IP address used
 * @returns {string} returns.localHostname - Local hostname
 * @returns {number} returns.localPort - Local port used
 * @returns {boolean} [returns.daneEnabled] - Whether DANE is active for this connection
 * @returns {Function} [returns.daneVerifier] - DANE certificate verification function
 * @returns {Array} [returns.tlsaRecords] - TLSA records for this MX host
 * @returns {boolean} [returns.requireTls] - Whether TLS is required (set when DANE records exist)
 *
 * @example
 * // Promise API with email address
 * const conn = await mxConnect('user@gmail.com');
 * conn.socket.write('EHLO example.com\r\n');
 *
 * @example
 * // Callback API with domain
 * mxConnect('gmail.com', (err, conn) => {
 *   if (err) return console.error(err);
 *   console.log(`Connected to ${conn.hostname}:${conn.port}`);
 * });
 *
 * @example
 * // Full configuration with DANE
 * const conn = await mxConnect({
 *   target: 'user@example.com',
 *   port: 25,
 *   maxConnectTime: 30000,
 *   localAddress: '192.0.2.1',
 *   dnsOptions: { preferIPv6: true },
 *   mtaSts: { enabled: true, cache: myCache },
 *   dane: {
 *     enabled: true,
 *     resolveTlsa: customResolveTlsa,
 *     logger: console.log
 *   }
 * });
 */
function mxConnect(options, callback) {
    // Accept string shorthand: mxConnect('domain.com')
    const opts = typeof options === 'string' ? { target: options } : options || {};
    const delivery = buildDeliveryObject(opts);

    // Build and execute the promise pipeline
    const pipeline = buildPipeline(delivery);
    const promise = pipeline.reduce((chain, fn) => chain.then(fn), Promise.resolve(delivery));

    // Wire up callback if provided (promise is still returned for hybrid usage)
    if (typeof callback === 'function') {
        promise.then(result => callback(null, result)).catch(callback);
    }

    return promise;
}

// Export the DANE module for direct access
mxConnect.dane = dane;

module.exports = mxConnect;
