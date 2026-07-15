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

// Ranges that are never valid unicast destinations for an outbound SMTP connection.
// Rejected regardless of any option: unspecified (0.0.0.0), the limited broadcast address
// (255.255.255.255), and multicast (224.0.0.0/4, ff00::/8) - none can ever be a real mail
// host. Names are ipaddr.js range() categories.
const ALWAYS_INVALID_RANGES = new Set(['unspecified', 'broadcast', 'multicast']);

// Local / private-scope ranges. Rejected only when blockLocalAddresses is enabled, to
// prevent SSRF and DNS-rebinding via MX records that point at internal hosts. Covers
// IPv4 loopback (127.0.0.0/8), RFC1918 private, link-local (169.254.0.0/16) and
// carrier-grade NAT (100.64.0.0/10); IPv6 loopback (::1), unique-local (fc00::/7) and
// link-local (fe80::/10).
const LOCAL_RANGES = new Set(['loopback', 'private', 'linkLocal', 'carrierGradeNat', 'uniqueLocal']);

// IANA "reserved" range: future-use 240.0.0.0/4 plus the RFC 5737 / RFC 3849 documentation
// ranges. Rejected only when blockReservedNetworks is enabled - off by default so those
// documentation ranges stay usable in tests and staging fixtures.
const RESERVED_RANGES = new Set(['reserved']);

/**
 * Validates an IP address for use as an MX server destination.
 *
 * Checks against several invalid/problematic ranges:
 * - Always blocked (never valid unicast targets): 'unspecified' (0.0.0.0), 'broadcast'
 *   and 'multicast'
 * - Blocked when blockLocalAddresses=true: local/private-scope ranges ('loopback',
 *   'private', 'linkLocal', 'carrierGradeNat', 'uniqueLocal') and any IP assigned to a
 *   local interface
 * - Blocked when blockReservedNetworks=true: 'reserved' (future-use and documentation ranges)
 *
 * This prevents connections to:
 * - Misconfigured domains pointing to invalid addresses
 * - Potential security issues (DNS rebinding, SSRF via MX records)
 * - Accidental localhost connections that could flood local services
 *
 * IPv4-mapped IPv6 addresses are unwrapped before validation, see below.
 *
 * @param {Object} delivery - The delivery object containing dnsOptions
 * @param {Object} [delivery.dnsOptions] - DNS configuration options
 * @param {boolean} [delivery.dnsOptions.blockLocalAddresses=false] - Block local/private-scope IPs
 * @param {boolean} [delivery.dnsOptions.blockReservedNetworks=false] - Block multicast/reserved IPs
 * @param {string} ip - The IP address to validate
 * @returns {string|false} Error message string if invalid, false if valid
 */
function isInvalid(delivery, ip) {
    let addr;
    try {
        addr = ipaddr.parse(ip);
    } catch {
        return 'Failed parsing IP address range.';
    }

    // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) reports its own "ipv4Mapped" range, so
    // it would match none of the IPv4 ranges below while still connecting straight to the
    // embedded IPv4 host. Unwrap it so it is validated as the IPv4 address it reaches.
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
        addr = addr.toIPv4Address();
    }

    const range = addr.range();
    const normalizedIp = addr.toString();
    const dnsOptions = delivery.dnsOptions || {};

    // Optionally block local/private-scope ranges (prevents SSRF-like attacks via MX)
    if (dnsOptions.blockLocalAddresses) {
        if (LOCAL_RANGES.has(range)) {
            return `This IP address falls within the prohibited "${range}" address range, which is not valid for external communication.`;
        }

        // Check both forms: the interface list holds canonical addresses, while the input may
        // be an alternate notation of the same address (mapped, uppercase, uncompressed).
        if (isLocal(ip) || isLocal(normalizedIp)) {
            return 'The resolved IP address corresponds to a local interface.';
        }
    }

    // Optionally block reserved ranges (future-use, documentation)
    if (dnsOptions.blockReservedNetworks && RESERVED_RANGES.has(range)) {
        return `The IP address is within the disallowed "${range}" address range, which is not permitted for direct communication.`;
    }

    // Always block ranges that are never valid unicast SMTP destinations
    if (ALWAYS_INVALID_RANGES.has(range)) {
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
