'use strict';

const net = require('net');
const dnsErrors = require('./dns-errors');
const tools = require('./tools');

// Create categorized DNS error
function createDnsError(err, domain, defaultMessage) {
    const error = err || new Error(defaultMessage || 'No MX server found');
    error.message = `DNS error occurred while resolving the Mail Exchange (MX) server for the specified domain (${domain}). ${
        dnsErrors[error.code] || error.message
    }`;
    error.response = `DNS Error: ${error.message}`;
    error.code = error.code || 'ENOTFOUND';
    error.category = 'dns';
    if (err && !tools.isNotFoundError(err)) {
        error.temporary = true;
    }
    return error;
}

// Check if error is recoverable (should try next fallback)
function isRecoverableError(err) {
    return !err || tools.isNotFoundError(err);
}

async function resolveMX(delivery) {
    let firstError = null;
    let addressFound = false;
    const dnsOptions = delivery.dnsOptions || {
        ignoreIPv6: false
    };

    const filterAddress = ip => {
        const invalid = tools.isInvalid(delivery, ip);
        if (invalid) {
            if (!firstError) {
                firstError = new Error(
                    `Unable to deliver email to the IP address [${ip}] resolved for the Mail Exchange (MX) server of "${delivery.domain}"${
                        typeof invalid === 'string' ? `. ${invalid}` : ''
                    }`
                );
                firstError.response = `DNS Error: ${firstError.message}`;
                firstError.category = 'dns';
            }
        } else {
            addressFound = true;
        }
        return !invalid;
    };

    // Do not try to resolve the domain name if it is an IP address
    if (delivery.isIp) {
        if (!filterAddress(delivery.decodedDomain) && firstError) {
            throw firstError;
        }

        delivery.mx = [
            {
                priority: 0,
                exchange: delivery.decodedDomain,
                A: net.isIPv4(delivery.decodedDomain) ? [delivery.decodedDomain] : [],
                AAAA: net.isIPv6(delivery.decodedDomain) && !dnsOptions.ignoreIPv6 ? [delivery.decodedDomain] : []
            }
        ];
        return delivery;
    }

    const domain = delivery.decodedDomain;
    const dnsResolve = tools.getDnsResolver(dnsOptions.resolve);

    // Try MX records first
    try {
        const list = await dnsResolve(domain, 'MX');
        if (list && list.length) {
            delivery.mx = []
                .concat(list)
                .sort((a, b) => a.priority - b.priority)
                .map(entry => {
                    entry.mx = true;
                    entry.A = [];
                    entry.AAAA = [];
                    return entry;
                });
            return delivery;
        }
    } catch (err) {
        if (!isRecoverableError(err)) {
            throw createDnsError(err, domain);
        }
    }

    // Fallback to A records
    try {
        const list = await dnsResolve(domain);
        if (list && list.length) {
            delivery.mx = [].concat(list).map(entry => ({
                priority: 0,
                exchange: domain,
                mx: false,
                A: [entry].filter(filterAddress),
                AAAA: []
            }));
            if (!addressFound && firstError) {
                throw firstError;
            }
            return delivery;
        }
    } catch (err) {
        if (!isRecoverableError(err)) {
            throw createDnsError(err, domain);
        }
    }

    // Fallback to AAAA records (if not ignoreIPv6)
    if (!dnsOptions.ignoreIPv6) {
        try {
            const list = await dnsResolve(domain, 'AAAA');
            if (list && list.length) {
                delivery.mx = [].concat(list).map(entry => ({
                    priority: 0,
                    exchange: domain,
                    mx: false,
                    A: [],
                    AAAA: [entry].filter(filterAddress)
                }));
                if (!addressFound && firstError) {
                    throw firstError;
                }
                return delivery;
            }
        } catch (err) {
            if (!isRecoverableError(err)) {
                throw createDnsError(err, domain);
            }
            // Nothing found at all
            throw createDnsError(err, domain, 'No MX server found');
        }
    }

    // Nothing found
    throw createDnsError(null, domain, 'No MX server found');
}

module.exports = resolveMX;
