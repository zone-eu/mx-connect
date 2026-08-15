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
const tools = require('./tools');
const net = require('net');
const dns = require('dns');
const { getPolicy, validateMx } = require('mailauth/lib/mta-sts');

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
 * Builds the DNS resolver mailauth uses while fetching an MTA-STS policy.
 *
 * The policy fetch is an HTTPS request to whatever mta-sts.<domain> resolves to, made
 * before any MX record is looked at. Left to itself that request answers to nothing: a
 * domain can publish an _mta-sts TXT record and point its policy host at 127.0.0.1 or a
 * cloud metadata endpoint, and every delivery attempt would dutifully connect there. The
 * addresses therefore go through the same validation as MX addresses, so
 * blockLocalAddresses covers the policy fetch as well as the mail connection itself.
 *
 * Going through tools.getDnsResolver also keeps the documented custom-resolver contract:
 * mailauth asks for 'A' records explicitly, while a custom resolver is promised that A
 * lookups always arrive in the two-argument form.
 *
 * @param {Object} delivery - The delivery object
 * @returns {Function} Promise-based resolver for mailauth: (domain, type) => Promise<Array>
 * @private
 */
function createPolicyResolver(delivery) {
    const dnsOptions = delivery.dnsOptions || {};
    const dnsResolve = tools.getDnsResolver(dnsOptions);

    return async (domain, type) => {
        // mailauth falls back to AAAA when the A lookup comes back empty, which would
        // reach for IPv6 on a host that asked never to use it
        if (type === 'AAAA' && dnsOptions.ignoreIPv6) {
            return [];
        }

        const list = await dnsResolve(domain, type);

        // Only address lookups turn into a connection; a TXT answer is policy data
        if (type !== 'A' && type !== 'AAAA') {
            return list;
        }

        return (list || []).filter(ip => {
            const invalid = tools.checkAddress(delivery, domain, ip);
            if (!invalid) {
                return true;
            }

            delivery.mtaSts.logger({
                msg: 'Skipped MTA-STS policy host address',
                action: 'mta-sts',
                success: false,
                hostname: domain,
                host: ip,
                domain: delivery.domain,
                error: invalid
            });
            return false;
        });
    };
}

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
    const { policy, status } = await getPolicy(delivery.decodedDomain, knownPolicy, { resolver: createPolicyResolver(delivery) });

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

const VERIFY_DEPRECATION_MSG = 'The dane.verify option is deprecated and ignored - DANE verification is always enforced per RFC 7672';

let verifyDeprecationWarned = false;

/**
 * Warn that `dane.verify: false` no longer disables enforcement.
 *
 * The process warning fires once, since it goes to stderr and repeating it per
 * message would be noise. The logger entry is emitted every time: it is a
 * per-delivery structured record, and an operator looking at why one specific
 * delivery was rejected should find the reason on that delivery rather than
 * only on whichever one happened to come first.
 *
 * Callers who never wired a logger are the ones most likely to still be passing
 * `verify: false`, which is why the process warning exists at all.
 *
 * @param {Function|null} logger - Optional DANE logger
 * @private
 */
function warnVerifyDeprecated(logger) {
    if (!verifyDeprecationWarned) {
        verifyDeprecationWarned = true;
        process.emitWarning(VERIFY_DEPRECATION_MSG, 'DeprecationWarning', 'MXC_DANE_VERIFY_DEPRECATED');
    }

    if (logger) {
        logger({
            msg: VERIFY_DEPRECATION_MSG,
            action: 'dane',
            success: false
        });
    }
}

/**
 * Mark an MX host as unusable for DANE because a lookup it depends on failed.
 *
 * A failed lookup is not the same as "this host has no TLSA records" - the
 * DANE status is simply unknown, so the safe move is to fail closed. The
 * connection layer turns this into a temporary error, which keeps DANE
 * enforced when the message is retried instead of quietly downgrading to
 * opportunistic TLS.
 *
 * @param {Object} delivery - The delivery object
 * @param {Object} mx - The MX entry to mark
 * @param {Error} err - The lookup error
 * @param {string} msg - Log message describing which lookup failed
 * @private
 */
function markDaneLookupFailure(delivery, mx, err, msg) {
    mx.tlsaRecords = [];
    mx.daneLookupFailed = true;
    mx.daneLookupError = err;

    if (delivery.dane.logger) {
        delivery.dane.logger({
            msg,
            action: 'dane',
            success: false,
            hostname: mx.exchange,
            domain: delivery.domain,
            error: err.message,
            code: err.code
        });
    }
}

/**
 * Resolve TLSA records for a single MX host.
 *
 * @param {Object} delivery - The delivery object
 * @param {Object} mx - The MX entry to resolve records for
 * @param {number} port - The port TLSA records are published under
 * @returns {Promise<void>} Resolves once mx.tlsaRecords has been populated
 * @private
 */
async function resolveTlsaForMx(delivery, mx, port) {
    // Skip if TLSA records are already provided
    if (mx.tlsaRecords && mx.tlsaRecords.length > 0) {
        return;
    }

    //
    // RFC 7672 Section 2.2.2: Check DNSSEC status before TLSA lookup
    //
    // "the SMTP client MUST perform any A and/or AAAA queries for the
    //  destination before attempting to locate the associated TLSA records."
    //
    // "If address records are found but the DNSSEC validation status of
    //  the first query response is 'insecure' [...], the SMTP client
    //  SHOULD NOT proceed to search for any associated TLSA records."
    //
    if (typeof delivery.dane.checkDnssecSecure === 'function') {
        let secure;

        try {
            const result = await delivery.dane.checkDnssecSecure(mx.exchange);
            secure = Boolean(result && result.secure);
        } catch (err) {
            // A failed check leaves the zone status unknown, which is NOT an
            // "insecure" answer. Treating it as one would skip the TLSA lookup
            // and bypass DANE on any transient DNS error - a rate-limited
            // resolver on a queue retry was enough to downgrade the delivery.
            return markDaneLookupFailure(delivery, mx, err, 'DNSSEC status check failed');
        }

        if (!secure) {
            mx.tlsaRecords = [];
            if (delivery.dane.logger) {
                delivery.dane.logger({
                    msg: 'Skipping TLSA lookup for insecure (non-DNSSEC) MX host per RFC 7672 Section 2.2.2',
                    action: 'dane',
                    success: true,
                    hostname: mx.exchange,
                    domain: delivery.domain
                });
            }
            return;
        }
    }

    try {
        mx.tlsaRecords = await dane.resolveTlsaRecords(mx.exchange, port, delivery.dane);
    } catch (err) {
        // NODATA/NXDOMAIN are resolved inside dane.resolveTlsaRecords and come
        // back as an empty array, so anything thrown here is a real lookup
        // failure rather than an absence of records.
        return markDaneLookupFailure(delivery, mx, err, 'TLSA lookup failed');
    }

    if (mx.tlsaRecords.length > 0 && delivery.dane.logger) {
        delivery.dane.logger({
            msg: 'TLSA records found',
            action: 'dane',
            success: true,
            hostname: mx.exchange,
            domain: delivery.domain,
            recordCount: mx.tlsaRecords.length
        });
    }
}

/**
 * Resolve TLSA records for all MX hosts (if DANE is enabled).
 *
 * DANE (RFC 6698) allows domains to publish TLSA records that specify
 * which TLS certificates are valid for their mail servers.
 *
 * Per RFC 7672 Section 2.2.2, if a `checkDnssecSecure` callback is
 * provided, the DNSSEC validation status of the MX host's A/AAAA
 * records is checked first. TLSA lookups are skipped for hosts whose
 * zones are not DNSSEC-signed ("insecure"), preventing SERVFAIL errors
 * from misconfigured nameservers.
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
    await Promise.all(delivery.mx.map(mx => resolveTlsaForMx(delivery, mx, port)));

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
        // RFC 7672 Section 2.2.2: Optional callback to check DNSSEC status
        // of MX host A/AAAA records before attempting TLSA lookups.
        // Signature: async (hostname) => { secure: boolean }
        checkDnssecSecure: daneOptions.checkDnssecSecure || null,
        logger: daneOptions.logger || null
    };

    // `verify` used to allow log-only DANE, which RFC 7672 Section 2.2 does not
    // permit. Warn rather than change enforcement under the caller silently.
    if (daneEnabled && daneOptions.verify === false) {
        warnVerifyDeprecated(daneConfig.logger);
    }

    return {
        // Target domain (extracted from email if needed)
        domain: extractDomain(options.target),
        // Pre-resolved MX entries (empty triggers DNS resolution)
        mx: (options.mx || []).map(normalizeMxEntry),

        // Addresses dropped by the IP validation rules, for callers that need to tell a
        // policy decision apart from a network failure
        blockedAddresses: [],

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
 * Runs the delivery object through the processing pipeline.
 *
 * The pipeline adapts based on user-provided data:
 * - If MX entries are pre-provided, skip the resolveMX step
 * - If IP addresses are pre-resolved in MX entries, resolveIP validates them without
 *   looking anything up
 * - If DANE is enabled, run the resolveDaneTlsa step
 *
 * This allows users to bypass DNS entirely for testing or special cases
 * (e.g., connecting through a proxy to a known IP).
 *
 * Each step mutates the shared delivery object; the final getConnection step
 * resolves with the connection result.
 *
 * Full pipeline: formatAddress -> resolvePolicy -> resolveMX -> validateMxPolicy -> resolveIP -> resolveDaneTlsa -> getConnection
 * Minimal pipeline (MX+IP provided): formatAddress -> resolvePolicy -> validateMxPolicy -> resolveIP -> [resolveDaneTlsa] -> getConnection
 *
 * @param {Object} delivery - Initialized delivery object
 * @returns {Promise<Object>} Connection result from getConnection
 * @private
 */
async function runPipeline(delivery) {
    // Decide the optional steps up front, before any step mutates delivery.mx
    const hasMx = delivery.mx.length > 0;

    await formatAddress(delivery);
    await resolvePolicy(delivery);

    // Only resolve MX records if not pre-provided
    if (!hasMx) {
        await resolveMX(delivery);
    }

    // Always validate MX entries against MTA-STS policy (if enabled)
    await validateMxPolicy(delivery);

    // Always run the IP step, even when the caller supplied addresses: it leaves those
    // addresses alone but is the only place any address is validated, so skipping it
    // would make blockLocalAddresses silently inert for anything passed in the mx option
    await resolveIP(delivery);

    // Resolve DANE TLSA records if enabled
    if (delivery.dane && delivery.dane.enabled) {
        await resolveDaneTlsa(delivery);
    }

    // Always end with connection establishment
    return getConnection(delivery);
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
 * @param {boolean} [options.dnsOptions.blockReservedNetworks=false] - Block IANA special-purpose IPs
 * @param {Array<string>} [options.dnsOptions.nat64Prefixes] - NAT64 prefixes this network runs,
 *   in CIDR form, so the IPv4 address such an address carries is validated too
 * @param {Function} [options.dnsOptions.resolveAsync] - DNS resolver returning records, or a
 *   promise for them: (domain, type) => records
 * @param {Function} [options.dnsOptions.resolve] - Callback-based DNS resolver (legacy)
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
 * @param {Function} [options.dane.checkDnssecSecure] - RFC 7672 Section 2.2.2: async callback to check
 *   DNSSEC status of MX host. Signature: async (hostname) => { secure: boolean }.
 *   When provided and the zone is insecure, TLSA lookups are skipped.
 * @param {Function} [options.dane.logger] - DANE event logger
 * @param {boolean} [options.dane.verify] - Deprecated and ignored. DANE verification is always enforced
 *   per RFC 7672; passing `false` logs a deprecation notice through `options.dane.logger`
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

    const promise = runPipeline(delivery);

    // Wire up callback if provided (promise is still returned for hybrid usage).
    // setImmediate detaches the callback from the promise chain: an exception
    // thrown inside the callback surfaces as a normal uncaught exception instead
    // of re-invoking the callback with its own error or becoming an unhandled
    // rejection
    if (typeof callback === 'function') {
        promise.then(
            result => setImmediate(callback, null, result),
            err => setImmediate(callback, err)
        );
    }

    return promise;
}

// Export the DANE module for direct access
mxConnect.dane = dane;

module.exports = mxConnect;
