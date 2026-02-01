'use strict';

const net = require('net');
const dnsErrors = require('./dns-errors');
const tools = require('./tools');

function resolveRecordType(dnsResolve, exchange, type) {
    const resolvePromise = type ? dnsResolve(exchange, type) : dnsResolve(exchange);
    return resolvePromise.then(
        list => list || [],
        err => {
            if (tools.isNotFoundError(err)) {
                return [];
            }
            return [{ error: err, exchange }];
        }
    );
}

async function resolveIP(delivery) {
    let firstError = null;
    let addressFound = false;

    const filterAddress = ip => {
        // Handle DNS resolution errors embedded in the array
        if (ip && ip.error) {
            if (!firstError) {
                const err = ip.error;
                err.exchange = ip.exchange;
                err.response = `DNS Error: Unable to resolve the IP address for the specified host [${ip.exchange}] of the Mail Exchange (MX) server for the domain "${delivery.domain}". ${dnsErrors[err.code] || err.message}`;
                err.category = 'dns';
                err.temporary = true;
                firstError = err;
            }
            return false;
        }

        const invalid = tools.isInvalid(delivery, ip);
        if (invalid) {
            if (!firstError) {
                const detail = typeof invalid === 'string' ? `. ${invalid}` : '';
                firstError = new Error(
                    `Unable to deliver email to the IP address [${ip}] resolved for the Mail Exchange (MX) server of "${delivery.domain}"${detail}`
                );
                firstError.code = 'InvalidIpAddress';
                firstError.response = `DNS Error: ${firstError.message}`;
                firstError.category = 'dns';
            }
            return false;
        }

        addressFound = true;
        return true;
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

        const tasks = [resolveRecordType(dnsResolve, entry.exchange, null).then(list => (entry.A = list))];

        if (!dnsOptions.ignoreIPv6) {
            tasks.push(resolveRecordType(dnsResolve, entry.exchange, 'AAAA').then(list => (entry.AAAA = list)));
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

        const error = new Error(`Failed to resolve any IP addresses for the Mail Exchange (MX) server associated with "${delivery.domain}"`);
        error.code = 'ENOTFOUND';
        error.response = `DNS Error: ${error.message}`;
        error.category = 'dns';
        throw error;
    }

    return delivery;
}

module.exports = resolveIP;
