'use strict';

const net = require('net');
const netErrors = require('./net-errors');

const MAX_CONNECT_TIME = 5 * 60 * 1000;

// Promisify the connect hook (callback-style externally, promise internally)
function callConnectHook(delivery, options) {
    if (typeof delivery.connectHook !== 'function') {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        delivery.connectHook(delivery, options, err => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// Connect with timeout
function connectWithTimeout(options, maxTime) {
    return new Promise((resolve, reject) => {
        let connected = false;
        let timeout;

        const socket = net.connect(options, () => {
            if (connected) {
                // something already happened, just skip this connection and hope for the best
                return socket.end();
            }
            connected = true;
            clearTimeout(timeout);
            resolve(socket);
        });

        timeout = setTimeout(() => {
            if (!connected) {
                connected = true;
                socket.destroy();
                const err = new Error(`Connection timed out when connecting to MX server`);
                err.response = `Network error: ${err.message}`;
                err.category = 'network';
                err.temporary = true;
                reject(err);
            }
        }, maxTime || MAX_CONNECT_TIME);

        socket.once('error', err => {
            clearTimeout(timeout);
            if (!connected) {
                connected = true;
                reject(err);
            }
        });
    });
}

// Build list of MX hosts to try
function buildMxHostList(delivery) {
    const mxHosts = [];
    const mxHostsSeen = new Set();

    for (const mx of delivery.mx) {
        const baseEntry = {
            hostname: mx.exchange,
            priority: mx.priority,
            isMX: mx.mx,
            policyMatch: mx.policyMatch
        };

        for (const ip of mx.A) {
            if (!mxHostsSeen.has(ip)) {
                mxHostsSeen.add(ip);
                mxHosts.push({ ...baseEntry, ipv4: true, host: ip });
            }
        }

        for (const ip of mx.AAAA) {
            if (!mxHostsSeen.has(ip)) {
                mxHostsSeen.add(ip);
                mxHosts.push({ ...baseEntry, ipv6: true, host: ip });
            }
        }
    }

    const filteredHosts = delivery.ignoreMXHosts?.length ? mxHosts.filter(mx => !delivery.ignoreMXHosts.includes(mx.host)) : mxHosts;

    return { mxHosts: filteredHosts, mxHostsSeen };
}

// Try to connect to a single MX host
// Returns: { success: true, result: mx } or { success: false, error: err, fatal: boolean }
function tryConnect(delivery, mx) {
    // Select local address or use existing one (assuming both local address and target use the same IP version)
    if (
        // no local address set
        !delivery.localAddress ||
        // mismatch between IP versions
        (net.isIPv6(mx.host) && !net.isIPv6(delivery.localAddress)) ||
        (net.isIPv4(mx.host) && !net.isIPv4(delivery.localAddress))
    ) {
        if (net.isIPv6(mx.host)) {
            delivery.localAddress = delivery.localAddressIPv6;
            delivery.localHostname = delivery.localHostnameIPv6 || delivery.localHostname || false;
        } else {
            delivery.localAddress = delivery.localAddressIPv4;
            delivery.localHostname = delivery.localHostnameIPv4 || delivery.localHostname || false;
        }
    }

    const options = {
        port: delivery.port || 25,
        host: mx.host
    };
    mx.port = options.port;

    if (delivery.localAddress !== mx.host) {
        options.localAddress = delivery.localAddress;
    }
    options.localHostname = delivery.localHostname || false;

    const emitConnectError = err => {
        if (typeof delivery.connectError === 'function') {
            delivery.connectError(err, delivery, options);
        }
    };

    // MTA-STS policy check
    if (mx.policyMatch) {
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

        if (!mx.policyMatch.valid && !mx.policyMatch.testing) {
            const error = new Error(`MTA-STS policy check failed for ${mx.hostname}[${mx.host}] for ${delivery.domain}`);
            error.response = `Policy error: ${error.message}`;
            error.category = 'policy';
            emitConnectError(error);
            return Promise.resolve({ success: false, error, fatal: false });
        }
    }

    // Call connect hook (callback-style externally, promisified internally)
    // Track whether we're in the hook phase or socket phase
    let hookPhase = true;

    return callConnectHook(delivery, options)
        .then(() => {
            if (options.socket) {
                // connection already established by hook
                mx.socket = options.socket;
                mx.localAddress = options.localAddress = mx.socket.localAddress;
                mx.localHostname = options.localHostname;
                mx.localPort = options.localPort = mx.socket.localPort;
                mx.hostname = mx.hostname || mx.socket.remoteAddress;
                return { success: true, result: mx };
            }

            // Entering socket phase
            hookPhase = false;

            // Attempt socket connection
            return connectWithTimeout(options, delivery.maxConnectTime).then(socket => {
                // we have a connection!
                mx.socket = socket;
                mx.localAddress = options.localAddress = socket.localAddress;
                mx.localHostname = options.localHostname;
                mx.localPort = options.localPort = socket.localPort;
                mx.hostname = mx.hostname || socket.remoteAddress;
                options.remoteAddress = socket.remoteAddress;
                return { success: true, result: mx };
            });
        })
        .catch(err => {
            // Hook errors are fatal, socket errors are retryable
            if (hookPhase) {
                return { success: false, error: err, fatal: true };
            }

            // Socket errors are retryable
            err.message = `Network error when connecting to MX server ${mx.hostname}[${mx.host}] for ${delivery.domain}: ${
                netErrors[err.code] || netErrors[err.errno] || err.message
            }`;
            err.response = err.response || `Network error: ${err.message}`;
            err.category = err.category || 'network';
            err.temporary = true;
            emitConnectError(err);
            return { success: false, error: err, fatal: false };
        });
}

// Recursive connection attempt that tries MX hosts sequentially
function tryNextMX(delivery, mxHosts, index, firstError) {
    if (index >= mxHosts.length) {
        const error = firstError || new Error(`Unable to establish a connection with any of the Mail Exchange (MX) servers listed for "${delivery.domain}"`);
        error.response = error.response || `Network error: ${error.message}`;
        error.category = error.category || 'network';
        return Promise.reject(error);
    }

    const mx = mxHosts[index];

    return tryConnect(delivery, mx).then(result => {
        if (result.success) {
            return result.result;
        }

        // Fatal errors (hook errors) should not retry
        if (result.fatal) {
            return Promise.reject(result.error);
        }

        // Try next MX host
        return tryNextMX(delivery, mxHosts, index + 1, firstError || result.error);
    });
}

function getConnection(delivery) {
    // try through different IP addresses to get a connection to the MX port

    const { mxHosts: initialMxHosts, mxHostsSeen } = buildMxHostList(delivery);
    const dnsOptions = delivery.dnsOptions || {};

    // Sort by priority and optionally prefer IPv6
    let mxHosts = initialMxHosts.sort((a, b) => a.priority - b.priority || (dnsOptions.preferIPv6 ? b.ipv6 - a.ipv6 : 0));

    // keep the length of the hosts to check in reasonable length as there
    // are hosts with hundreds of unresponsive MX entries
    if (mxHosts.length > 20) {
        mxHosts = mxHosts.slice(0, 20);
    }

    if (!mxHosts.length) {
        if (mxHostsSeen.size) {
            // we did have some hosts listed but these were filtered out
            let error;
            if (delivery.mxLastError) {
                error = delivery.mxLastError;
            } else {
                error = new Error(`Connection to the Mail Exchange (MX) server of "${delivery.domain}" failed`);
                error.response = `Network error: ${error.message}`;
                error.category = 'network';
                error.temporary = true;
            }
            return Promise.reject(error);
        }
        const error = new Error(`No Mail Exchange (MX) servers were found for "${delivery.domain}"`);
        error.response = `DNS Error: ${error.message}`;
        error.category = 'dns';
        return Promise.reject(error);
    }

    return tryNextMX(delivery, mxHosts, 0, null);
}

module.exports = getConnection;
