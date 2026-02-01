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

module.exports.getDnsResolver = getDnsResolver;

/**
 * Check if a DNS error code indicates "not found" (recoverable for fallback attempts).
 * These errors mean "no records exist" rather than "DNS server failure".
 */
function isNotFoundError(err) {
    return err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND');
}

module.exports.isNotFoundError = isNotFoundError;

function returnLocalAddresses(interfaces) {
    let addresses = new Set();

    addresses.add('0.0.0.0');

    Object.keys(interfaces || {}).forEach(key => {
        let iface = interfaces[key];
        if (!iface) {
            return;
        }
        [].concat(iface || []).forEach(addr => {
            if (addr && addr.address) {
                addresses.add(addr.address);
            }
        });
    });

    return addresses;
}

module.exports.isLocal = address => localAddresses.has(address);

module.exports.isInvalid = (delivery, ip) => {
    let range;
    try {
        range = ipaddr.parse(ip).range();
    } catch {
        return `Failed parsing IP address range.`;
    }
    let dnsOptions = delivery.dnsOptions || {};

    if (dnsOptions.blockLocalAddresses) {
        // check if exchange resolves to local IP range
        if (['loopback', 'private'].includes(range)) {
            return `This IP address falls within the prohibited "${range}" address range, which is not valid for external communication.`;
        }

        // check if exchange resolves to local interface
        if (module.exports.isLocal(ip)) {
            return `The resolved IP address corresponds to a local interface.`;
        }
    }

    // check if exchange resolves to invalid IP range
    if (['unspecified', 'broadcast'].includes(range)) {
        return `The IP address is within the disallowed "${range}" address range, which is not permitted for direct communication.`;
    }

    return false;
};
