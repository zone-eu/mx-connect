/**
 * @fileoverview Shared utility functions for DNS resolution and IP address validation.
 * Provides helpers for promisifying DNS resolvers, checking DNS error types, and
 * validating IP addresses against local/private/invalid ranges.
 * @module tools
 */

'use strict';

const os = require('os');
const ipaddr = require('ipaddr.js');
const { promises: dnsPromises } = require('dns');

// Collect all local IP addresses at module load time for fast lookup
const LOCAL_ADDRESSES = collectLocalAddresses(os.networkInterfaces());

/**
 * Creates a promise-based DNS resolver function.
 *
 * When no custom resolver is provided, uses native dns.promises for optimal performance.
 * When a custom callback-style resolver is provided (via dnsOptions.resolve), wraps it
 * with promisification to maintain a consistent async interface.
 *
 * The resolver handles the dual signature of dns.resolve:
 * - resolve(domain) - resolves A records (IPv4)
 * - resolve(domain, type) - resolves specified record type (MX, AAAA, etc.)
 *
 * @param {Function} [customResolver] - Optional callback-style DNS resolver with signature
 *   (domain, callback) or (domain, type, callback). If not provided, uses dns.promises.
 * @returns {Function} Promise-based resolver: (domain, type?) => Promise<Array>
 *
 * @example
 * // Using default resolver
 * const resolve = getDnsResolver();
 * const mxRecords = await resolve('example.com', 'MX');
 *
 * @example
 * // Using custom resolver
 * const resolve = getDnsResolver(myCustomDnsResolve);
 * const ipAddresses = await resolve('example.com');
 */
function getDnsResolver(customResolver) {
    // Use native dns.promises when no custom resolver - faster and avoids callback overhead
    if (!customResolver) {
        return (domain, type) => {
            if (type !== undefined) {
                return dnsPromises.resolve(domain, type);
            }
            // Default to A record resolution (IPv4)
            return dnsPromises.resolve4(domain);
        };
    }

    // Promisify custom callback-style resolver
    return (domain, type) =>
        new Promise((resolve, reject) => {
            const callback = (err, data) => (err ? reject(err) : resolve(data));
            if (type !== undefined) {
                customResolver(domain, type, callback);
            } else {
                customResolver(domain, callback);
            }
        });
}

/**
 * Checks if a DNS error indicates "record not found" (recoverable for fallback attempts).
 *
 * These errors mean "no records of this type exist" rather than "DNS server failure".
 * Used to determine if we should fall back to the next record type (MX -> A -> AAAA)
 * or if we should throw the error immediately (e.g., SERVFAIL, REFUSED).
 *
 * @param {Error|null} err - The DNS error to check
 * @returns {boolean} True if the error indicates no records found (safe to try fallback)
 *
 * @example
 * if (isNotFoundError(err)) {
 *   // No MX records, try A records next
 * } else {
 *   // DNS server error, throw immediately
 *   throw err;
 * }
 */
function isNotFoundError(err) {
    return err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND');
}

/**
 * Collects all IP addresses assigned to local network interfaces.
 *
 * Used to detect when an MX record resolves to a local machine, which could indicate
 * a misconfigured domain or potential security issue (e.g., DNS rebinding attack).
 *
 * @param {Object} interfaces - Network interfaces object from os.networkInterfaces()
 * @returns {Set<string>} Set of local IP addresses including '0.0.0.0'
 * @private
 */
function collectLocalAddresses(interfaces) {
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

/**
 * Checks if an IP address belongs to a local network interface.
 *
 * @param {string} address - The IP address to check
 * @returns {boolean} True if the address is assigned to a local interface
 */
function isLocal(address) {
    return LOCAL_ADDRESSES.has(address);
}

/**
 * Validates an IP address for use as an MX server destination.
 *
 * Checks against several invalid/problematic ranges:
 * - Always blocked: 'unspecified' (0.0.0.0) and 'broadcast' addresses
 * - Conditionally blocked (when blockLocalAddresses=true): 'loopback', 'private', and local interface IPs
 *
 * This prevents connections to:
 * - Misconfigured domains pointing to invalid addresses
 * - Potential security issues (DNS rebinding, SSRF via MX records)
 * - Accidental localhost connections that could flood local services
 *
 * @param {Object} delivery - The delivery object containing dnsOptions
 * @param {Object} [delivery.dnsOptions] - DNS configuration options
 * @param {boolean} [delivery.dnsOptions.blockLocalAddresses=false] - Block private/loopback IPs
 * @param {string} ip - The IP address to validate
 * @returns {string|false} Error message string if invalid, false if valid
 */
function isInvalid(delivery, ip) {
    let range;
    try {
        range = ipaddr.parse(ip).range();
    } catch {
        return 'Failed parsing IP address range.';
    }
    const dnsOptions = delivery.dnsOptions || {};

    // Optionally block private networks and loopback (prevents SSRF-like attacks via MX)
    if (dnsOptions.blockLocalAddresses) {
        if (range === 'loopback' || range === 'private') {
            return `This IP address falls within the prohibited "${range}" address range, which is not valid for external communication.`;
        }

        if (isLocal(ip)) {
            return 'The resolved IP address corresponds to a local interface.';
        }
    }

    // Always block unspecified (0.0.0.0) and broadcast addresses
    if (range === 'unspecified' || range === 'broadcast') {
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
