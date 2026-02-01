'use strict';

const os = require('os');
const ipaddr = require('ipaddr.js');
const { promises: dnsPromises } = require('dns');

const localAddresses = returnLocalAddresses(os.networkInterfaces());

/**
 * Get a promise-based DNS resolver.
 * Uses native dns.promises when no custom resolver is provided.
 * Wraps custom callback-style resolvers with promisification.
 */
function getDnsResolver(customResolver) {
    if (!customResolver) {
        // Use native promise-based DNS
        return (domain, type) => (type !== undefined ? dnsPromises.resolve(domain, type) : dnsPromises.resolve4(domain));
    }

    // Promisify custom callback-style resolver
    return (domain, type) =>
        new Promise((resolve, reject) => {
            const callback = (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            };
            if (type !== undefined) {
                customResolver(domain, type, callback);
            } else {
                customResolver(domain, callback);
            }
        });
}

/**
 * Check if a DNS error code indicates "not found" (recoverable for fallback attempts).
 * These errors mean "no records exist" rather than "DNS server failure".
 */
function isNotFoundError(err) {
    return err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND');
}

function returnLocalAddresses(interfaces) {
    const addresses = new Set(['0.0.0.0']);

    for (const iface of Object.values(interfaces || {})) {
        if (!iface) {
            continue;
        }
        for (const addr of iface) {
            if (addr && addr.address) {
                addresses.add(addr.address);
            }
        }
    }

    return addresses;
}

function isLocal(address) {
    return localAddresses.has(address);
}

function isInvalid(delivery, ip) {
    let range;
    try {
        range = ipaddr.parse(ip).range();
    } catch {
        return `Failed parsing IP address range.`;
    }
    const dnsOptions = delivery.dnsOptions || {};

    if (dnsOptions.blockLocalAddresses) {
        if (['loopback', 'private'].includes(range)) {
            return `This IP address falls within the prohibited "${range}" address range, which is not valid for external communication.`;
        }

        if (isLocal(ip)) {
            return `The resolved IP address corresponds to a local interface.`;
        }
    }

    if (['unspecified', 'broadcast'].includes(range)) {
        return `The IP address is within the disallowed "${range}" address range, which is not permitted for direct communication.`;
    }

    return false;
}

module.exports = {
    getDnsResolver,
    isNotFoundError,
    isLocal,
    isInvalid
};
