'use strict';

const net = require('net');
const netErrors = require('./net-errors');

const MAX_CONNECT_TIME = 5 * 60 * 1000;

function getConnection(delivery) {
    // try through different IP addresses to get a connection to the MX port

    return new Promise((resolve, reject) => {
        // serialize available addresses
        let mxHosts = [];
        let mxHostsSeen = new Set();
        delivery.mx.forEach(mx => {
            mx.A.forEach(a => {
                if (mxHostsSeen.has(a)) {
                    return;
                }
                mxHostsSeen.add(a);

                mxHosts.push({
                    hostname: mx.exchange,
                    priority: mx.priority,
                    ipv4: true,
                    host: a,
                    isMX: mx.mx,
                    policyMatch: mx.policyMatch
                });
            });
            mx.AAAA.forEach(aaaa => {
                if (mxHostsSeen.has(aaaa)) {
                    return;
                }
                mxHostsSeen.add(aaaa);

                mxHosts.push({
                    hostname: mx.exchange,
                    priority: mx.priority,
                    ipv6: true,
                    host: aaaa,
                    isMX: mx.mx,
                    policyMatch: mx.policyMatch
                });
            });
        });

        // filter out hosts
        mxHosts = mxHosts.filter(mx => !delivery.ignoreMXHosts || !delivery.ignoreMXHosts.includes(mx.host));

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
                return reject(error);
            }
            let error = new Error(`No Mail Exchange (MX) servers were found for "${delivery.domain}"`);
            error.response = `DNS Error: ${error.message}`;
            error.category = 'dns';
            return reject(error);
        }

        let dnsOptions = delivery.dnsOptions || {};
        mxHosts = mxHosts.sort((a, b) => a.priority - b.priority || (dnsOptions.preferIPv6 ? b.ipv6 - a.ipv6 : 0));

        if (mxHosts.length > 20) {
            // keep the length of the hosts to check in reasonable length as there
            // are hosts with hundreds of unresponsive MX entries
            mxHosts = mxHosts.slice(0, 20);
        }

        let firstError = false;
        let tried = 0;
        let tryNextMX = () => {
            if (tried >= mxHosts.length) {
                let error =
                    firstError || new Error(`Unable to establish a connection with any of the Mail Exchange (MX) servers listed for "${delivery.domain}"`);
                error.response = error.response || `Network error: ${error.message}`;
                error.category = error.category || 'network';
                return reject(error);
            }

            let mx = mxHosts[tried++];

            let connected = false;
            let connectTimeout = false;

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

            let options = {
                port: delivery.port || 25,
                host: mx.host
            };
            mx.port = options.port;

            if (delivery.localAddress !== mx.host) {
                options.localAddress = delivery.localAddress;
            }
            options.localHostname = delivery.localHostname || false;

            let emitConnectHook = done => {
                if (typeof delivery.connectHook !== 'function') {
                    return done();
                }
                delivery.connectHook(delivery, options, done);
            };

            let emitConnectError = err => {
                if (typeof delivery.connectError === 'function') {
                    delivery.connectError(err, delivery, options);
                }
            };

            if (mx.policyMatch && !mx.policyMatch.valid) {
                if (mx.policyMatch.testing) {
                    // log only
                    delivery.mtaSts.logger({
                        msg: 'MTA-STS policy check failed',
                        action: 'mta-sts',
                        success: false,
                        hostname: mx.hostname,
                        host: mx.host,
                        domain: delivery.domain,
                        mode: mx.policyMatch.mode,
                        testing: true
                    });
                } else {
                    // reject connection
                    delivery.mtaSts.logger({
                        msg: 'MTA-STS policy check failed',
                        action: 'mta-sts',
                        success: false,
                        hostname: mx.hostname,
                        host: mx.host,
                        domain: delivery.domain,
                        mode: mx.policyMatch.mode,
                        testing: false
                    });
                    let error = new Error(`MTA-STS policy check failed for ${mx.hostname}[${mx.host}] for ${delivery.domain}`);
                    error.response = `Policy error: ${error.message}`;
                    error.category = 'policy';
                    emitConnectError(error);
                    if (!firstError) {
                        firstError = error;
                    }
                    return setImmediate(tryNextMX);
                }
            } else if (mx.policyMatch && mx.policyMatch.valid) {
                delivery.mtaSts.logger({
                    msg: 'MTA-STS policy check succeeded',
                    action: 'mta-sts',
                    success: true,
                    hostname: mx.hostname,
                    host: mx.host,
                    domain: delivery.domain,
                    mode: mx.policyMatch.mode,
                    testing: true
                });
            }

            //plugins.handler.runHooks('sender:connect', [delivery, options], err => {
            emitConnectHook(err => {
                if (err) {
                    return reject(err);
                }

                if (options.socket) {
                    // connection already established
                    mx.socket = options.socket;
                    mx.localAddress = options.localAddress = mx.socket.localAddress;
                    mx.localHostname = options.localHostname;
                    mx.localPort = options.localPort = mx.socket.localPort;
                    mx.hostname = mx.hostname || mx.socket.remoteAddress;
                    return resolve(mx);
                }

                let socket = net.connect(options, () => {
                    clearTimeout(connectTimeout);
                    if (connected) {
                        // something already happened, just skip this connection and hope for the best
                        return socket.end();
                    }
                    connected = true;
                    // we have a connection!
                    mx.socket = socket;
                    mx.localAddress = options.localAddress = socket.localAddress;
                    mx.localHostname = options.localHostname;
                    mx.localPort = options.localPort = socket.localPort;
                    mx.hostname = mx.hostname || socket.remoteAddress;
                    options.remoteAddress = socket.remoteAddress;
                    return resolve(mx);
                });
                socket.once('error', err => {
                    if (err) {
                        err.message = `Network error when connecting to MX server ${mx.hostname}[${mx.host}] for ${delivery.domain}: ${
                            netErrors[err.code] || netErrors[err.errno] || err.message
                        }`;
                        err.response = err.response || `Network error: ${err.message}`;
                        err.category = err.category || 'network';
                        err.temporary = true;
                        emitConnectError(err);
                        if (!firstError) {
                            firstError = err;
                        }
                    }
                    clearTimeout(connectTimeout);
                    if (!connected) {
                        connected = true;
                        return setImmediate(tryNextMX);
                    }
                });

                connectTimeout = setTimeout(() => {
                    // most probably we never hit this timer, it's a safety net for strange connections
                    clearTimeout(connectTimeout);
                    if (!connected) {
                        connected = true;

                        let error = new Error(`Connection timed out when connecting to MX server ${mx.hostname}[${mx.host}] for ${delivery.domain}`);
                        error.response = `Network error: ${error.message}`;
                        error.category = 'network';
                        error.temporary = true;

                        emitConnectError(error);
                        if (!firstError) {
                            firstError = error;
                        }
                        return setImmediate(tryNextMX);
                    }
                }, delivery.maxConnectTime || MAX_CONNECT_TIME);
            });
        };

        setImmediate(tryNextMX);
    });
}

module.exports = getConnection;
