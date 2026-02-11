/**
 * @fileoverview Establishes TCP connections to MX servers.
 * Iterates through resolved MX hosts in priority order, attempting connections
 * until one succeeds. Supports connection hooks, timeouts, and MTA-STS policy validation.
 * @module get-connection
 */

'use strict';

const net = require('net');
const netErrors = require('./net-errors');
const { createDaneVerifier } = require('./dane');

// Default connection timeout: 5 minutes per host
const MAX_CONNECT_TIME = 5 * 60 * 1000;

/**
 * Invokes the user-provided connection hook if present.
 *
 * The hook allows custom behavior before TCP connection, such as:
 * - Routing connections through a proxy (SOCKS, HTTP CONNECT)
 * - Diverting .onion addresses to Tor
 * - Custom logging or metrics collection
 *
 * If the hook sets options.socket, no TCP connection will be established
 * (the hook is expected to have created the socket itself).
 *
 * @param {Object} delivery - The delivery object
 * @param {Function} [delivery.connectHook] - Callback-style hook: (delivery, options, callback)
 * @param {Object} options - Connection options (host, port, localAddress)
 * @returns {Promise<void>} Resolves when hook completes, rejects on hook error
 * @private
 */
function callConnectHook(delivery, options) {
    if (typeof delivery.connectHook !== 'function') {
        return Promise.resolve();
    }
    // Promisify the callback-style hook for consistent async handling
    return new Promise((resolve, reject) => {
        delivery.connectHook(delivery, options, err => (err ? reject(err) : resolve()));
    });
}

/**
 * Establishes a TCP connection with timeout handling.
 *
 * Uses a "settled" flag pattern to handle race conditions between:
 * - Successful connection
 * - Connection timeout
 * - Socket errors
 *
 * Only the first event to occur will be processed; subsequent events
 * are ignored. If timeout wins the race, the socket is destroyed.
 *
 * @param {Object} options - net.connect() options (host, port, localAddress)
 * @param {number} [maxTime=MAX_CONNECT_TIME] - Connection timeout in milliseconds
 * @returns {Promise<net.Socket>} Resolves with connected socket, rejects on error/timeout
 * @private
 */
function connectWithTimeout(options, maxTime) {
    return new Promise((resolve, reject) => {
        // Settled flag prevents multiple handlers from firing
        let settled = false;
        let timeout;

        /**
         * Settles the promise with the first result (connection, timeout, or error).
         * Subsequent calls are ignored to prevent duplicate resolution.
         */
        const settle = (handler, value) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            handler(value);
        };

        const socket = net.connect(options, () => {
            // If already settled (e.g., by timeout), clean up the socket immediately
            if (settled) {
                // Use destroy() not end() to immediately release the handle
                return socket.destroy();
            }
            settle(resolve, socket);
        });

        timeout = setTimeout(() => {
            socket.destroy();
            const err = new Error('Connection timed out when connecting to MX server');
            err.response = `Network error: ${err.message}`;
            err.category = 'network';
            err.temporary = true;
            settle(reject, err);
        }, maxTime || MAX_CONNECT_TIME);

        socket.once('error', err => {
            // Destroy socket on error to release handle immediately
            socket.destroy();
            settle(reject, err);
        });
    });
}

/**
 * Flattens MX entries into a list of individual host connection targets.
 *
 * Each MX entry may have multiple A and AAAA records. This function expands
 * them into individual targets while tracking seen IPs to prevent duplicates
 * (some domains list the same IP under multiple MX hostnames).
 *
 * @param {Object} delivery - Delivery object with resolved MX entries
 * @param {Array} delivery.mx - MX entries with A/AAAA arrays
 * @param {Array} [delivery.ignoreMXHosts] - IP addresses to exclude
 * @returns {{mxHosts: Array, mxHostsSeen: Set}} Flattened host list and seen IPs
 * @private
 */
function buildMxHostList(delivery) {
    const mxHosts = [];
    const mxHostsSeen = new Set();

    for (const mx of delivery.mx) {
        // Base properties shared by all IPs under this MX
        const baseEntry = {
            hostname: mx.exchange,
            priority: mx.priority,
            isMX: mx.mx,
            policyMatch: mx.policyMatch,
            tlsaRecords: mx.tlsaRecords || null,
            daneLookupFailed: mx.daneLookupFailed || false,
            daneLookupError: mx.daneLookupError || null
        };

        // Add IPv4 addresses
        for (const ip of mx.A) {
            if (!mxHostsSeen.has(ip)) {
                mxHostsSeen.add(ip);
                mxHosts.push({ ...baseEntry, ipv4: true, host: ip });
            }
        }

        // Add IPv6 addresses
        for (const ip of mx.AAAA) {
            if (!mxHostsSeen.has(ip)) {
                mxHostsSeen.add(ip);
                mxHosts.push({ ...baseEntry, ipv6: true, host: ip });
            }
        }
    }

    // Filter out ignored hosts (e.g., known-bad IPs)
    if (delivery.ignoreMXHosts && delivery.ignoreMXHosts.length) {
        return {
            mxHosts: mxHosts.filter(mx => !delivery.ignoreMXHosts.includes(mx.host)),
            mxHostsSeen
        };
    }

    return { mxHosts, mxHostsSeen };
}

/**
 * Selects the appropriate local address based on target IP version.
 *
 * When connecting to IPv6 targets, uses localAddressIPv6/localHostnameIPv6.
 * When connecting to IPv4 targets, uses localAddressIPv4/localHostnameIPv4.
 * This allows servers with dual-stack connectivity to use different
 * source addresses for different target types.
 *
 * @param {Object} delivery - Delivery object with local address options
 * @param {Object} mx - Target MX host entry
 * @param {string} mx.host - Target IP address
 * @private
 */
function updateLocalAddressForTarget(delivery, mx) {
    // Check if we need to switch local address based on IP version mismatch
    const needsUpdate =
        !delivery.localAddress || (net.isIPv6(mx.host) && !net.isIPv6(delivery.localAddress)) || (net.isIPv4(mx.host) && !net.isIPv4(delivery.localAddress));

    if (!needsUpdate) {
        return;
    }

    // Select appropriate local address/hostname for target IP version
    if (net.isIPv6(mx.host)) {
        delivery.localAddress = delivery.localAddressIPv6;
        delivery.localHostname = delivery.localHostnameIPv6 || delivery.localHostname || false;
    } else {
        delivery.localAddress = delivery.localAddressIPv4;
        delivery.localHostname = delivery.localHostnameIPv4 || delivery.localHostname || false;
    }
}

/**
 * Validates MX host against MTA-STS policy.
 *
 * MTA-STS (RFC 8461) allows domains to publish policies requiring TLS and
 * specifying which MX hostnames are valid. If a policy is in "enforce" mode
 * and validation fails, the connection is rejected.
 *
 * In "testing" mode, failures are logged but connections proceed.
 *
 * @param {Object} delivery - Delivery object with MTA-STS configuration
 * @param {Object} mx - MX host entry with policyMatch from validateMx()
 * @param {Function} emitConnectError - Callback to emit connection errors
 * @returns {Object|null} Failure result {success: false, error, fatal: false} or null if OK
 * @private
 */
function checkMtaStsPolicy(delivery, mx, emitConnectError) {
    if (!mx.policyMatch) {
        return null;
    }

    // Log policy check result (success or failure)
    const logEntry = {
        msg: mx.policyMatch.valid ? 'MTA-STS policy check succeeded' : 'MTA-STS policy check failed',
        action: 'mta-sts',
        success: mx.policyMatch.valid,
        hostname: mx.hostname,
        host: mx.host,
        domain: delivery.domain,
        mode: mx.policyMatch.mode,
        testing: mx.policyMatch.testing || mx.policyMatch.valid
    };
    delivery.mtaSts.logger(logEntry);

    // Reject connection if policy is enforced (not testing) and validation failed
    if (!mx.policyMatch.valid && !mx.policyMatch.testing) {
        const error = new Error(`MTA-STS policy check failed for ${mx.hostname}[${mx.host}] for ${delivery.domain}`);
        error.response = `Policy error: ${error.message}`;
        error.category = 'policy';
        emitConnectError(error);
        return { success: false, error, fatal: false };
    }

    return null;
}

/**
 * Copies socket information to the MX result object.
 *
 * After successful connection, populates the result with actual socket
 * properties (local address, local port) which may differ from requested
 * values if the OS assigned them automatically.
 *
 * @param {Object} mx - MX host entry to populate
 * @param {net.Socket} socket - Connected socket
 * @param {Object} options - Connection options (receives localAddress/localPort)
 * @private
 */
function populateMxFromSocket(mx, socket, options) {
    mx.socket = socket;
    mx.localAddress = options.localAddress = socket.localAddress;
    mx.localHostname = options.localHostname;
    mx.localPort = options.localPort = socket.localPort;
    mx.hostname = mx.hostname || socket.remoteAddress;
}

/**
 * Attempts to connect to a single MX host.
 *
 * Connection flow:
 * 1. Update local address for target IP version (IPv4/IPv6)
 * 2. Check MTA-STS policy validation
 * 3. Call connection hook (if provided)
 * 4. If hook didn't provide socket, establish TCP connection
 *
 * Error handling uses "hookPhase" flag to distinguish:
 * - Hook errors: fatal=true (do not retry other hosts)
 * - Socket errors: fatal=false (try next host)
 *
 * @param {Object} delivery - Delivery object with connection options
 * @param {Object} mx - MX host entry to connect to
 * @returns {Promise<{success: boolean, result?: Object, error?: Error, fatal?: boolean}>}
 * @private
 */
function tryConnect(delivery, mx) {
    updateLocalAddressForTarget(delivery, mx);

    const options = {
        port: delivery.port || 25,
        host: mx.host,
        localHostname: delivery.localHostname || false
    };
    mx.port = options.port;

    // Don't bind to the target address (would fail)
    if (delivery.localAddress !== mx.host) {
        options.localAddress = delivery.localAddress;
    }

    /**
     * Emits connection error to user-provided error handler (fire-and-forget).
     * Used for logging/metrics, does not affect connection flow.
     */
    const emitConnectError = err => {
        if (typeof delivery.connectError === 'function') {
            delivery.connectError(err, delivery, options);
        }
    };

    // Check MTA-STS policy before attempting connection
    const policyFailure = checkMtaStsPolicy(delivery, mx, emitConnectError);
    if (policyFailure) {
        return Promise.resolve(policyFailure);
    }

    // Check for DANE lookup failures in verify mode
    if (delivery.dane && delivery.dane.enabled && mx.daneLookupFailed && delivery.dane.verify !== false) {
        const errMsg = (mx.daneLookupError && mx.daneLookupError.message) || 'unknown error';
        const error = new Error(`DANE TLSA lookup failed for ${mx.hostname}: ${errMsg}`);
        error.response = `DANE error: ${error.message}`;
        error.category = 'dane';
        error.temporary = true;
        if (delivery.dane.logger) {
            delivery.dane.logger({
                msg: 'Connection rejected due to DANE lookup failure',
                action: 'dane',
                success: false,
                hostname: mx.hostname,
                host: mx.host,
                domain: delivery.domain,
                error: errMsg
            });
        }
        emitConnectError(error);
        return Promise.resolve({ success: false, error, fatal: false });
    }

    // Track whether we're in hook phase or socket phase for error classification
    // Hook errors are fatal (user code failed); socket errors trigger retry
    let hookPhase = true;

    // Set up DANE verification if enabled and TLSA records exist
    if (delivery.dane && delivery.dane.enabled && mx.tlsaRecords && mx.tlsaRecords.length > 0) {
        mx.daneVerifier = createDaneVerifier(mx.tlsaRecords, delivery.dane);
        mx.daneEnabled = true;
        mx.requireTls = true; // DANE requires TLS

        if (delivery.dane.logger) {
            delivery.dane.logger({
                msg: 'DANE enabled for connection',
                action: 'dane',
                success: true,
                hostname: mx.hostname,
                host: mx.host,
                domain: delivery.domain,
                tlsaRecordCount: mx.tlsaRecords.length
            });
        }
    }

    return callConnectHook(delivery, options)
        .then(() => {
            // Hook may have created socket directly (e.g., proxy connection)
            if (options.socket) {
                populateMxFromSocket(mx, options.socket, options);
                return { success: true, result: mx };
            }

            // Transition to socket phase - errors from here are retryable
            hookPhase = false;

            return connectWithTimeout(options, delivery.maxConnectTime).then(socket => {
                populateMxFromSocket(mx, socket, options);
                options.remoteAddress = socket.remoteAddress;
                return { success: true, result: mx };
            });
        })
        .catch(err => {
            // Hook errors are fatal - don't retry other hosts
            if (hookPhase) {
                return { success: false, error: err, fatal: true };
            }

            // Socket errors are retryable - enhance error and try next host
            const errorMessage = netErrors[err.code] || netErrors[err.errno] || err.message;
            err.message = `Network error when connecting to MX server ${mx.hostname}[${mx.host}] for ${delivery.domain}: ${errorMessage}`;
            err.response = err.response || `Network error: ${err.message}`;
            err.category = err.category || 'network';
            err.temporary = true;
            emitConnectError(err);
            return { success: false, error: err, fatal: false };
        });
}

/**
 * Recursively tries MX hosts until one connects successfully.
 *
 * Uses tail recursion pattern to iterate through hosts without
 * building up the call stack. Each iteration either:
 * - Returns successfully with connected socket
 * - Returns fatal error (hook failure) immediately
 * - Recurses to next host on retryable error
 *
 * Preserves the first error encountered to provide meaningful
 * error message if all hosts fail.
 *
 * @param {Object} delivery - Delivery object
 * @param {Array} mxHosts - Sorted list of MX host entries to try
 * @param {number} index - Current index in mxHosts array
 * @param {Error|null} firstError - First error encountered (for final error message)
 * @returns {Promise<Object>} Connection result with socket
 * @throws {Error} If all hosts fail or a fatal error occurs
 * @private
 */
function tryNextMX(delivery, mxHosts, index, firstError) {
    // All hosts exhausted - throw the first error encountered
    if (index >= mxHosts.length) {
        const error = firstError || new Error(`Unable to establish a connection with any of the Mail Exchange (MX) servers listed for "${delivery.domain}"`);
        error.response = error.response || `Network error: ${error.message}`;
        error.category = error.category || 'network';
        return Promise.reject(error);
    }

    return tryConnect(delivery, mxHosts[index]).then(result => {
        if (result.success) {
            return result.result;
        }

        // Fatal errors (hook failures) should not retry
        if (result.fatal) {
            return Promise.reject(result.error);
        }

        // Retryable error - try next host, preserving first error
        return tryNextMX(delivery, mxHosts, index + 1, firstError || result.error);
    });
}

// Maximum hosts to try - prevents long delays on domains with many unresponsive MX entries
const MAX_MX_HOSTS = 20;

/**
 * Establishes a TCP connection to the highest priority available MX server.
 *
 * This is the final step in the MX connection pipeline. It:
 * 1. Flattens MX entries into individual host targets
 * 2. Sorts by priority (lower = higher priority)
 * 3. Optionally prefers IPv6 addresses (when preferIPv6=true)
 * 4. Limits to MAX_MX_HOSTS to prevent excessive connection attempts
 * 5. Tries each host in order until one succeeds
 *
 * @param {Object} delivery - Delivery object with resolved MX entries
 * @param {Array} delivery.mx - MX entries with resolved A/AAAA addresses
 * @param {number} [delivery.port=25] - Port to connect to
 * @param {number} [delivery.maxConnectTime] - Connection timeout per host (ms)
 * @param {Object} [delivery.dnsOptions] - DNS options including preferIPv6
 * @param {Function} [delivery.connectHook] - Pre-connection hook
 * @param {Function} [delivery.connectError] - Error notification callback
 * @returns {Promise<Object>} Connection result: {socket, hostname, host, port, localAddress, localHostname, localPort}
 * @throws {Error} If all connection attempts fail (error.category = 'network' or 'dns')
 */
function getConnection(delivery) {
    const { mxHosts: unsortedHosts, mxHostsSeen } = buildMxHostList(delivery);
    const dnsOptions = delivery.dnsOptions || {};

    // Sort by priority (lower number = higher priority per RFC 5321)
    // Within same priority, optionally prefer IPv6 addresses
    const sortedHosts = unsortedHosts.sort((a, b) => {
        const priorityDiff = a.priority - b.priority;
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        // When preferIPv6=true, sort IPv6 addresses before IPv4
        return dnsOptions.preferIPv6 ? b.ipv6 - a.ipv6 : 0;
    });

    // Limit hosts to prevent excessive connection attempts on domains
    // with many MX entries (some of which may be unresponsive)
    const mxHosts = sortedHosts.length > MAX_MX_HOSTS ? sortedHosts.slice(0, MAX_MX_HOSTS) : sortedHosts;

    // Handle case where no hosts remain after filtering
    if (!mxHosts.length) {
        let error;
        if (mxHostsSeen.size) {
            // Had hosts but all were filtered (by ignoreMXHosts)
            error = delivery.mxLastError || new Error(`Connection to the Mail Exchange (MX) server of "${delivery.domain}" failed`);
            error.response = error.response || `Network error: ${error.message}`;
            error.category = error.category || 'network';
            error.temporary = error.temporary !== false;
        } else {
            // No hosts resolved at all
            error = new Error(`No Mail Exchange (MX) servers were found for "${delivery.domain}"`);
            error.response = `DNS Error: ${error.message}`;
            error.category = 'dns';
        }
        return Promise.reject(error);
    }

    // Start recursive connection attempts
    return tryNextMX(delivery, mxHosts, 0, null);
}

module.exports = getConnection;
