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
 * The returned resolver accepts an optional record type. An omitted type and an
 * explicit 'A' are equivalent: both resolve A records (IPv4). For custom
 * resolvers, A lookups always use the legacy two-argument form
 * (domain, callback), so resolvers that only implement that form keep working.
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
            if (type === undefined || type === 'A') {
                return dnsPromises.resolve4(domain);
            }
            return dnsPromises.resolve(domain, type);
        };
    }

    // Promisify custom callback-style resolver
    return (domain, type) =>
        new Promise((resolve, reject) => {
            const callback = (err, data) => (err ? reject(err) : resolve(data));
            if (type === undefined || type === 'A') {
                customResolver(domain, callback);
            } else {
                customResolver(domain, type, callback);
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
// Rejected regardless of any option: unspecified (0.0.0.0, ::), the limited broadcast
// address (255.255.255.255), multicast (224.0.0.0/4, ff00::/8), the RFC 6666 discard
// prefix (100::/64) and RFC 9602 segment routing identifiers (5f00::/16) - none can ever
// be a real mail host. Names are ipaddr.js range() categories.
const ALWAYS_INVALID_RANGES = new Set(['unspecified', 'broadcast', 'multicast', 'discard', 'segmentRouting']);

// Local / private-scope ranges. Rejected only when blockLocalAddresses is enabled, to
// prevent SSRF and DNS-rebinding via MX records that point at internal hosts. Covers
// IPv4 loopback (127.0.0.0/8), RFC1918 private, link-local (169.254.0.0/16) and
// carrier-grade NAT (100.64.0.0/10); IPv6 loopback (::1), unique-local (fc00::/7),
// link-local (fe80::/10) and deprecated site-local (fec0::/10).
const LOCAL_RANGES = new Set(['loopback', 'private', 'linkLocal', 'carrierGradeNat', 'uniqueLocal', 'deprecatedSiteLocal']);

// IANA special-purpose ranges that are routable in principle but are not real mail
// destinations: future-use 240.0.0.0/4, the RFC 5737 / RFC 3849 documentation ranges and
// IPv4 benchmarking (198.18.0.0/15), all of which ipaddr.js groups under "reserved", plus
// the IPv6 benchmarking (2001:2::/48) and AMT (2001:3::/32) ranges it names separately.
// Rejected only when blockReservedNetworks is enabled - off by default so the
// documentation ranges stay usable in tests and staging fixtures.
const RESERVED_RANGES = new Set(['reserved', 'benchmarking', 'amt']);

// IPv6 transition mechanisms carry an IPv4 address inside the IPv6 address, and the
// traffic really does end up at that IPv4 host: an AAAA record of 64:ff9b::7f00:1 reaches
// 127.0.0.1 on any NAT64 network even though the IPv6 range is not "loopback". Each
// prefix below keeps the embedded address at a fixed, documented offset, so it is
// extracted and validated on its own rather than judging the outer envelope. Blocking the
// whole prefix instead would break delivery on IPv6-only networks, where DNS64 synthesizes
// exactly these records for every IPv4-only mail host.
//
// The prefixes are matched explicitly instead of through ipaddr.js range names because a
// single name spans addresses that need different treatment: range() reports both
// 64:ff9b::/96 and 64:ff9b:1::/48 as "rfc6052", yet only the former has a fixed offset.
const NAT64_WELL_KNOWN_PREFIX = ipaddr.parseCIDR('64:ff9b::/96'); // RFC 6052 section 2.1
const IPV4_TRANSLATED_PREFIX = ipaddr.parseCIDR('::ffff:0:0:0/96'); // RFC 6145 section 2
const SIX_TO_FOUR_PREFIX = ipaddr.parseCIDR('2002::/16'); // RFC 3056 section 2
const TEREDO_PREFIX = ipaddr.parseCIDR('2001::/32'); // RFC 4380 section 4

// RFC 8215 reserves 64:ff9b:1::/48 for NAT64 prefixes chosen by the local network. The
// embedded IPv4 address sits at an offset that depends on the prefix length that network
// picked (RFC 6052 section 2.2 permits /32 through /96), so it cannot be recovered from
// the address alone. This is the one transition prefix that stays a blanket block.
const NAT64_LOCAL_USE_PREFIX = ipaddr.parseCIDR('64:ff9b:1::/48');

/**
 * Detects the deprecated RFC 4291 IPv4-compatible form (::a.b.c.d).
 *
 * ipaddr.js reports these as plain "unicast", and only rewrites the dotted spelling
 * (::127.0.0.1) into an IPv4-mapped address, so the hex spelling (::7f00:1) would
 * otherwise reach the embedded IPv4 host unchecked.
 *
 * @param {Object} addr - Parsed ipaddr.js IPv6 address
 * @returns {boolean} True if the address wraps an IPv4 address in ::/96
 * @private
 */
function isIPv4Compatible(addr) {
    if (addr.parts.slice(0, 6).some(part => part !== 0)) {
        return false;
    }
    // :: and ::1 are the unspecified and loopback addresses, not IPv4-compatible forms
    return addr.parts[6] !== 0 || addr.parts[7] > 1;
}

/**
 * Expands an address into every address the connection would actually reach.
 *
 * A plain address only yields itself. IPv6 forms that merely wrap an IPv4 address
 * (IPv4-mapped, IPv4-compatible, NAT64 well-known prefix, RFC 6145 translated) are
 * replaced by the IPv4 address they translate to, since the outer address has no meaning
 * of its own. Tunnel forms (6to4, Teredo) keep the outer address, which is a routable
 * IPv6 address in its own right, and add the IPv4 endpoints the packets are sent to.
 *
 * @param {Object} addr - Parsed ipaddr.js address
 * @returns {Array<{addr: Object, embedded: boolean}>} Addresses to validate, where
 *   embedded marks an IPv4 address recovered from an IPv6 one
 * @private
 */
function expandTargets(addr) {
    if (addr.kind() !== 'ipv6') {
        return [{ addr, embedded: false }];
    }

    const bytes = addr.toByteArray();

    // Envelope forms: the IPv6 address is only a wrapper around the IPv4 address the
    // connection ends up at, so it is judged solely as that IPv4 address
    if (addr.isIPv4MappedAddress()) {
        return [{ addr: addr.toIPv4Address(), embedded: true }];
    }

    if (isIPv4Compatible(addr) || addr.match(NAT64_WELL_KNOWN_PREFIX) || addr.match(IPV4_TRANSLATED_PREFIX)) {
        return [{ addr: ipaddr.fromByteArray(bytes.slice(12)), embedded: true }];
    }

    // Tunnel forms: the outer address routes normally, but the packets are encapsulated
    // towards the embedded IPv4 endpoint, so both have to hold up
    if (addr.match(SIX_TO_FOUR_PREFIX)) {
        // RFC 3056 section 2: 2002:<v4>::/48
        return [
            { addr, embedded: false },
            { addr: ipaddr.fromByteArray(bytes.slice(2, 6)), embedded: true }
        ];
    }

    if (addr.match(TEREDO_PREFIX)) {
        // RFC 4380 section 4: prefix | server IPv4 | flags | port | client IPv4, where the
        // client address is stored with every bit flipped, so subtracting each byte from
        // 255 recovers it
        return [
            { addr, embedded: false },
            { addr: ipaddr.fromByteArray(bytes.slice(4, 8)), embedded: true },
            { addr: ipaddr.fromByteArray(bytes.slice(12).map(byte => 255 - byte)), embedded: true }
        ];
    }

    return [{ addr, embedded: false }];
}

/**
 * Validates an IP address for use as an MX server destination.
 *
 * Checks against several invalid/problematic ranges:
 * - Always blocked (never valid unicast targets): 'unspecified' (0.0.0.0, ::),
 *   'broadcast', 'multicast', 'discard' (100::/64) and 'segmentRouting' (5f00::/16)
 * - Blocked when blockLocalAddresses=true: local/private-scope ranges ('loopback',
 *   'private', 'linkLocal', 'carrierGradeNat', 'uniqueLocal', 'deprecatedSiteLocal'), the
 *   RFC 8215 local-use NAT64 prefix, and any IP assigned to a local interface
 * - Blocked when blockReservedNetworks=true: 'reserved' (future-use and documentation
 *   ranges), 'benchmarking' and 'amt'
 *
 * This prevents connections to:
 * - Misconfigured domains pointing to invalid addresses
 * - Potential security issues (DNS rebinding, SSRF via MX records)
 * - Accidental localhost connections that could flood local services
 *
 * IPv6 addresses that carry an IPv4 address (IPv4-mapped, IPv4-compatible, NAT64, RFC 6145
 * translated, 6to4, Teredo) are validated as the IPv4 address the connection reaches, so
 * they can neither slip past the checks nor be blocked when the address they reach is a
 * perfectly ordinary public host. See expandTargets.
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

    const dnsOptions = delivery.dnsOptions || {};

    // The one transition prefix whose embedded IPv4 address cannot be recovered, so there
    // is nothing to validate and the address has to be taken on trust or refused
    if (dnsOptions.blockLocalAddresses && addr.kind() === 'ipv6' && addr.match(NAT64_LOCAL_USE_PREFIX)) {
        return 'This IP address uses the local-use NAT64 prefix (64:ff9b:1::/48), whose embedded IPv4 address depends on the local network configuration and cannot be read from the address, so it cannot be verified as an external mail host.';
    }

    for (const target of expandTargets(addr)) {
        const range = target.addr.range();
        const subject = target.embedded ? `The IPv4 address [${target.addr.toString()}] carried by this IPv6 address` : 'This IP address';

        // Optionally block local/private-scope ranges (prevents SSRF-like attacks via MX)
        if (dnsOptions.blockLocalAddresses) {
            if (LOCAL_RANGES.has(range)) {
                return `${subject} falls within the prohibited "${range}" address range, which is not valid for external communication.`;
            }

            // Check both forms: the interface list holds canonical addresses, while the input
            // may be an alternate notation of the same address (mapped, uppercase, uncompressed).
            if (isLocal(ip) || isLocal(target.addr.toString())) {
                return 'The resolved IP address corresponds to a local interface.';
            }
        }

        // Optionally block reserved ranges (future-use, documentation, benchmarking)
        if (dnsOptions.blockReservedNetworks && RESERVED_RANGES.has(range)) {
            return `${subject} is within the disallowed "${range}" address range, which is not permitted for direct communication.`;
        }

        // Always block ranges that are never valid unicast SMTP destinations
        if (ALWAYS_INVALID_RANGES.has(range)) {
            return `${subject} is within the disallowed "${range}" address range, which is not permitted for direct communication.`;
        }
    }

    return false;
}

/**
 * Records an address that was rejected by isInvalid on the delivery object.
 *
 * A rejected address is a policy decision the caller has no other way to see. When every
 * address of a host is rejected the resulting error explains itself, but when only some
 * are, delivery continues over whatever survived and the filtering leaves no trace at
 * all - a host left with only unreachable addresses then fails as a plain network error
 * that no amount of log reading ties back to blockLocalAddresses. The list is exposed on
 * the delivery object handed to the connectHook and connectError callbacks.
 *
 * @param {Object} delivery - The delivery object
 * @param {string} exchange - MX hostname the address was resolved for
 * @param {string} ip - The rejected address
 * @param {string} reason - Explanation from isInvalid
 * @private
 */
function recordBlockedAddress(delivery, exchange, ip, reason) {
    if (!delivery.blockedAddresses) {
        delivery.blockedAddresses = [];
    }
    delivery.blockedAddresses.push({ exchange, ip, reason });
}

module.exports = {
    getDnsResolver,
    isNotFoundError,
    isLocal,
    isInvalid,
    recordBlockedAddress
};
