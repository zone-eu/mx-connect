'use strict';

const dns = require('dns');
const net = require('net');
const dnsErrors = require('./dns-errors');
const tools = require('./tools');

// we do not reject on error to avoid issues where one failing MX record kills entire sending
function resolve4(mx, dnsResolve) {
    dnsResolve = dnsResolve || dns.resolve;

    return new Promise(resolve => {
        dnsResolve(mx.exchange, (err, list) => {
            if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
                mx.A = [].concat({ error: err, exchange: mx.exchange });
            } else {
                mx.A = [].concat(list || []);
            }
            resolve(mx);
        });
    });
}

function resolve6(mx, dnsResolve) {
    dnsResolve = dnsResolve || dns.resolve;

    return new Promise(resolve => {
        dnsResolve(mx.exchange, 'AAAA', (err, list) => {
            if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
                mx.AAAA = [].concat({ error: err, exchange: mx.exchange });
            } else {
                mx.AAAA = [].concat(list || []);
            }
            resolve(mx);
        });
    });
}

function resolveIP(delivery) {
    return new Promise((resolve, reject) => {
        let resolveAddresses = [];
        let firstError = false;
        let addressFound = false;

        let filterAddress = ip => {
            if (ip && ip.error) {
                if (!firstError) {
                    firstError = ip.error;
                    firstError.exchange = ip.exchange;
                    // This is not ENOTFOUND but an actual error, probably an issue with DNS server
                    // so we return 4xx
                    firstError.response = `DNS Error: Unable to resolve the IP address for the specified host [${
                        ip.exchange
                    }] of the Mail Exchange (MX) server for the domain "${delivery.domain}". ${dnsErrors[firstError.code] || firstError.message}`;
                    firstError.category = 'dns';
                    firstError.temporary = true;
                }
                return false;
            }
            let invalid = tools.isInvalid(delivery, ip);
            if (invalid) {
                if (!firstError) {
                    firstError = new Error(
                        `Unable to deliver email to the IP address [${ip}] resolved for the Mail Exchange (MX) server of "${delivery.domain}"${
                            typeof invalid === 'string' ? `.  ${invalid}` : ''
                        }`
                    );
                    // Invalid IP, so nothing to do here, return 5xx
                    firstError.code = 'InvalidIpAddress';
                    firstError.response = `DNS Error: ${firstError.message}`;
                    firstError.category = 'dns';
                }
            } else {
                addressFound = true;
            }
            return !invalid;
        };

        let dnsOptions = delivery.dnsOptions || {};
        delivery.mx.forEach(entry => {
            if (entry.exchange) {
                if (!net.isIP(entry.exchange)) {
                    resolveAddresses.push(resolve4(entry, dnsOptions.resolve));
                    if (!dnsOptions.ignoreIPv6) {
                        resolveAddresses.push(resolve6(entry, dnsOptions.resolve));
                    }
                } else if (net.isIPv4(entry.exchange)) {
                    entry.A = [].concat(entry.exchange || []);
                } else if (net.isIPv6(entry.exchange)) {
                    entry.AAAA = [].concat(entry.exchange || []);
                }
            }
        });

        Promise.all(resolveAddresses)
            .then(() => {
                // filter invalid IP addresses
                delivery.mx.forEach(entry => {
                    // filter invalid IP addresses
                    entry.A = entry.A.filter(filterAddress);
                    entry.AAAA = entry.AAAA.filter(filterAddress);
                });

                if (!addressFound) {
                    if (firstError) {
                        return reject(firstError);
                    }

                    // nothing found, we end up here with ENOTFOUND, so return 5xx
                    let error = new Error(`Failed to resolve any IP addresses for the Mail Exchange (MX) server associated with "${delivery.domain}"`);
                    error.code = 'ENOTFOUND';
                    error.response = `DNS Error: ${error.message}`;
                    error.category = 'dns';
                    return reject(error);
                }
                resolve(delivery);
            })
            .catch(err => {
                err.message = delivery.decodedDomain + ': ' + (dnsErrors[err.code] || err.message);
                err.step = 'dns';
                reject(err);
            });
    });
}

module.exports = resolveIP;
