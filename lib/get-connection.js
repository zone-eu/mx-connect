'use strict';

const net = require('net');
const netErrors = require('./net-errors');

const MAX_CONNECT_TIME = 5 * 60 * 1000;

function callConnectHook(delivery, options) {
    if (typeof delivery.connectHook !== 'function') {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        delivery.connectHook(delivery, options, err => (err ? reject(err) : resolve()));
    });
}

function connectWithTimeout(options, maxTime) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeout;

        const settle = (handler, value) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            handler(value);
        };

        const socket = net.connect(options, () => {
            if (settled) {
                return socket.end();
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

        socket.once('error', err => settle(reject, err));
    });
}

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

    if (delivery.ignoreMXHosts && delivery.ignoreMXHosts.length) {
        return {
            mxHosts: mxHosts.filter(mx => !delivery.ignoreMXHosts.includes(mx.host)),
            mxHostsSeen
        };
    }

    return { mxHosts, mxHostsSeen };
}

function updateLocalAddressForTarget(delivery, mx) {
    const needsUpdate =
        !delivery.localAddress || (net.isIPv6(mx.host) && !net.isIPv6(delivery.localAddress)) || (net.isIPv4(mx.host) && !net.isIPv4(delivery.localAddress));

    if (!needsUpdate) {
        return;
    }

    if (net.isIPv6(mx.host)) {
        delivery.localAddress = delivery.localAddressIPv6;
        delivery.localHostname = delivery.localHostnameIPv6 || delivery.localHostname || false;
    } else {
        delivery.localAddress = delivery.localAddressIPv4;
        delivery.localHostname = delivery.localHostnameIPv4 || delivery.localHostname || false;
    }
}

function checkMtaStsPolicy(delivery, mx, emitConnectError) {
    if (!mx.policyMatch) {
        return null;
    }

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
        return { success: false, error, fatal: false };
    }

    return null;
}

function populateMxFromSocket(mx, socket, options) {
    mx.socket = socket;
    mx.localAddress = options.localAddress = socket.localAddress;
    mx.localHostname = options.localHostname;
    mx.localPort = options.localPort = socket.localPort;
    mx.hostname = mx.hostname || socket.remoteAddress;
}

function tryConnect(delivery, mx) {
    updateLocalAddressForTarget(delivery, mx);

    const options = {
        port: delivery.port || 25,
        host: mx.host,
        localHostname: delivery.localHostname || false
    };
    mx.port = options.port;

    if (delivery.localAddress !== mx.host) {
        options.localAddress = delivery.localAddress;
    }

    const emitConnectError = err => {
        if (typeof delivery.connectError === 'function') {
            delivery.connectError(err, delivery, options);
        }
    };

    const policyFailure = checkMtaStsPolicy(delivery, mx, emitConnectError);
    if (policyFailure) {
        return Promise.resolve(policyFailure);
    }

    let hookPhase = true;

    return callConnectHook(delivery, options)
        .then(() => {
            if (options.socket) {
                populateMxFromSocket(mx, options.socket, options);
                return { success: true, result: mx };
            }

            hookPhase = false;

            return connectWithTimeout(options, delivery.maxConnectTime).then(socket => {
                populateMxFromSocket(mx, socket, options);
                options.remoteAddress = socket.remoteAddress;
                return { success: true, result: mx };
            });
        })
        .catch(err => {
            if (hookPhase) {
                return { success: false, error: err, fatal: true };
            }

            const errorMessage = netErrors[err.code] || netErrors[err.errno] || err.message;
            err.message = `Network error when connecting to MX server ${mx.hostname}[${mx.host}] for ${delivery.domain}: ${errorMessage}`;
            err.response = err.response || `Network error: ${err.message}`;
            err.category = err.category || 'network';
            err.temporary = true;
            emitConnectError(err);
            return { success: false, error: err, fatal: false };
        });
}

function tryNextMX(delivery, mxHosts, index, firstError) {
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

        if (result.fatal) {
            return Promise.reject(result.error);
        }

        return tryNextMX(delivery, mxHosts, index + 1, firstError || result.error);
    });
}

const MAX_MX_HOSTS = 20;

function getConnection(delivery) {
    const { mxHosts: unsortedHosts, mxHostsSeen } = buildMxHostList(delivery);
    const dnsOptions = delivery.dnsOptions || {};

    // Sort by priority, optionally prefer IPv6
    const sortedHosts = unsortedHosts.sort((a, b) => {
        const priorityDiff = a.priority - b.priority;
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        return dnsOptions.preferIPv6 ? b.ipv6 - a.ipv6 : 0;
    });

    // Limit hosts to prevent issues with domains that have many unresponsive MX entries
    const mxHosts = sortedHosts.length > MAX_MX_HOSTS ? sortedHosts.slice(0, MAX_MX_HOSTS) : sortedHosts;

    if (!mxHosts.length) {
        let error;
        if (mxHostsSeen.size) {
            error = delivery.mxLastError || new Error(`Connection to the Mail Exchange (MX) server of "${delivery.domain}" failed`);
            error.response = error.response || `Network error: ${error.message}`;
            error.category = error.category || 'network';
            error.temporary = error.temporary !== false;
        } else {
            error = new Error(`No Mail Exchange (MX) servers were found for "${delivery.domain}"`);
            error.response = `DNS Error: ${error.message}`;
            error.category = 'dns';
        }
        return Promise.reject(error);
    }

    return tryNextMX(delivery, mxHosts, 0, null);
}

module.exports = getConnection;
