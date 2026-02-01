'use strict';

const net = require('net');
const dnsErrors = require('./dns-errors');
const tools = require('./tools');

async function resolveIP(delivery) {
    let firstError = null;
    let addressFound = false;

    const filterAddress = ip => {
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
        const invalid = tools.isInvalid(delivery, ip);
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

    const dnsOptions = delivery.dnsOptions || {};
    const dnsResolve = tools.getDnsResolver(dnsOptions.resolve);

    // Resolve IP addresses for all MX entries in parallel
    const resolutionPromises = delivery.mx.flatMap(entry => {
        if (!entry.exchange) {
            return [];
        }

        // Handle entries that are already IP addresses
        if (net.isIP(entry.exchange)) {
            if (net.isIPv4(entry.exchange)) {
                entry.A = [entry.exchange];
            } else if (net.isIPv6(entry.exchange)) {
                entry.AAAA = [entry.exchange];
            }
            return [];
        }

        const tasks = [];

        // Resolve A records
        tasks.push(
            dnsResolve(entry.exchange).then(
                list => {
                    entry.A = list || [];
                },
                err => {
                    if (tools.isNotFoundError(err)) {
                        entry.A = [];
                    } else {
                        entry.A = [{ error: err, exchange: entry.exchange }];
                    }
                }
            )
        );

        // Resolve AAAA records (unless ignoreIPv6)
        if (!dnsOptions.ignoreIPv6) {
            tasks.push(
                dnsResolve(entry.exchange, 'AAAA').then(
                    list => {
                        entry.AAAA = list || [];
                    },
                    err => {
                        if (tools.isNotFoundError(err)) {
                            entry.AAAA = [];
                        } else {
                            entry.AAAA = [{ error: err, exchange: entry.exchange }];
                        }
                    }
                )
            );
        }

        return tasks;
    });

    await Promise.all(resolutionPromises);

    // Filter invalid IP addresses
    for (const entry of delivery.mx) {
        entry.A = entry.A.filter(filterAddress);
        entry.AAAA = entry.AAAA.filter(filterAddress);
    }

    if (!addressFound) {
        if (firstError) {
            throw firstError;
        }

        // nothing found, we end up here with ENOTFOUND, so return 5xx
        const error = new Error(`Failed to resolve any IP addresses for the Mail Exchange (MX) server associated with "${delivery.domain}"`);
        error.code = 'ENOTFOUND';
        error.response = `DNS Error: ${error.message}`;
        error.category = 'dns';
        throw error;
    }

    return delivery;
}

module.exports = resolveIP;
