'use strict';

const net = require('net');
const dnsErrors = require('./dns-errors');
const tools = require('./tools');

function createDnsError(err, domain, defaultMessage) {
    const error = err || new Error(defaultMessage || 'No MX server found');
    const errorDescription = dnsErrors[error.code] || error.message;
    error.message = `DNS error occurred while resolving the Mail Exchange (MX) server for the specified domain (${domain}). ${errorDescription}`;
    error.response = `DNS Error: ${error.message}`;
    error.code = error.code || 'ENOTFOUND';
    error.category = 'dns';
    if (err && !tools.isNotFoundError(err)) {
        error.temporary = true;
    }
    return error;
}

function isRecoverableError(err) {
    return !err || tools.isNotFoundError(err);
}

async function tryResolve(dnsResolve, domain, type) {
    try {
        const list = type !== undefined ? await dnsResolve(domain, type) : await dnsResolve(domain);
        return { list: list || [], error: null };
    } catch (err) {
        return { list: [], error: err };
    }
}

async function resolveMX(delivery) {
    let firstError = null;
    let addressFound = false;
    const dnsOptions = delivery.dnsOptions || { ignoreIPv6: false };

    const filterAddress = ip => {
        const invalid = tools.isInvalid(delivery, ip);
        if (invalid) {
            if (!firstError) {
                const detail = typeof invalid === 'string' ? `. ${invalid}` : '';
                firstError = new Error(
                    `Unable to deliver email to the IP address [${ip}] resolved for the Mail Exchange (MX) server of "${delivery.domain}"${detail}`
                );
                firstError.response = `DNS Error: ${firstError.message}`;
                firstError.category = 'dns';
            }
            return false;
        }
        addressFound = true;
        return true;
    };

    // Handle IP address targets directly
    if (delivery.isIp) {
        if (!filterAddress(delivery.decodedDomain) && firstError) {
            throw firstError;
        }

        const ip = delivery.decodedDomain;
        delivery.mx = [
            {
                priority: 0,
                exchange: ip,
                A: net.isIPv4(ip) ? [ip] : [],
                AAAA: net.isIPv6(ip) && !dnsOptions.ignoreIPv6 ? [ip] : []
            }
        ];
        return delivery;
    }

    const domain = delivery.decodedDomain;
    const dnsResolve = tools.getDnsResolver(dnsOptions.resolve);

    // Try MX records first
    const mxResult = await tryResolve(dnsResolve, domain, 'MX');
    if (mxResult.list.length) {
        delivery.mx = mxResult.list
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map(entry => ({ ...entry, mx: true, A: [], AAAA: [] }));
        return delivery;
    }
    if (mxResult.error && !isRecoverableError(mxResult.error)) {
        throw createDnsError(mxResult.error, domain);
    }

    // Fallback to A records
    const aResult = await tryResolve(dnsResolve, domain);
    if (aResult.list.length) {
        delivery.mx = aResult.list.map(entry => ({
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
    if (aResult.error && !isRecoverableError(aResult.error)) {
        throw createDnsError(aResult.error, domain);
    }

    // Fallback to AAAA records (if not ignoreIPv6)
    if (!dnsOptions.ignoreIPv6) {
        const aaaaResult = await tryResolve(dnsResolve, domain, 'AAAA');
        if (aaaaResult.list.length) {
            delivery.mx = aaaaResult.list.map(entry => ({
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
        if (aaaaResult.error && !isRecoverableError(aaaaResult.error)) {
            throw createDnsError(aaaaResult.error, domain);
        }
    }

    throw createDnsError(null, domain, 'No MX server found');
}

module.exports = resolveMX;
