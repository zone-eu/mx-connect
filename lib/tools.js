/**
 * @fileoverview Shared utility functions for DNS resolution and IP address validation.
 * Provides helpers for promisifying DNS resolvers, checking DNS error types, and
 * validating IP addresses against local/private/invalid ranges.
 * @module tools
 */

'use strict';

const os = require('os');
const net = require('net');
const ipaddr = require('ipaddr.js');
const { promises: dnsPromises } = require('dns');

// Collect all local IP addresses at module load time for fast lookup
const LOCAL_ADDRESSES = collectLocalAddresses(os.networkInterfaces());

/**
 * Builds the promise-based DNS resolver the pipeline uses.
 *
 * Three sources, in order of preference:
 *
 * 1. `dnsOptions.resolveAsync`, which returns the records. It may return them directly or
 *    as a promise; awaiting covers both, so a resolver backed by a cache can answer
 *    synchronously without pretending to be asynchronous.
 * 2. `dnsOptions.resolve`, the older callback form, promisified here.
 * 3. Native `dns.promises`, which avoids the callback hop entirely.
 *
 * The record type is always passed on to `resolveAsync`, A records included. The callback
 * form keeps its quirk of omitting the type for A lookups, because resolvers written
 * against it may only accept the two-argument shape, and that is precisely the wart the
 * newer option exists to leave behind.
 *
 * @param {Object} [dnsOptions] - DNS configuration
 * @param {Function} [dnsOptions.resolveAsync] - (domain, type) => records or Promise<records>
 * @param {Function} [dnsOptions.resolve] - Callback resolver, (domain, type, callback) or
 *   (domain, callback) for A records
 * @returns {Function} Promise-based resolver: (domain, type?) => Promise<Array>
 *
 * @example
 * const resolve = getDnsResolver({ resolveAsync: (domain, type) => myCache.lookup(domain, type) });
 * const mxRecords = await resolve('example.com', 'MX');
 */
function getDnsResolver(dnsOptions) {
    const options = dnsOptions || {};

    if (typeof options.resolveAsync === 'function') {
        // async so a resolver that returns records directly, or throws synchronously, still
        // behaves like every other branch here
        return async (domain, type) => options.resolveAsync(domain, type || 'A');
    }

    if (typeof options.resolve === 'function') {
        return (domain, type) =>
            new Promise((resolve, reject) => {
                const callback = (err, data) => (err ? reject(err) : resolve(data));
                if (type === undefined || type === 'A') {
                    options.resolve(domain, callback);
                } else {
                    options.resolve(domain, type, callback);
                }
            });
    }

    // Native dns.promises - faster, and avoids the callback hop
    return (domain, type) => {
        if (type === undefined || type === 'A') {
            return dnsPromises.resolve4(domain);
        }
        return dnsPromises.resolve(domain, type);
    };
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
// The prefixes are spelled out rather than taken from ipaddr.js range() names, which group
// 64:ff9b::/96 together with 64:ff9b:1::/48 as "rfc6052" even though only the former has a
// fixed offset. ipaddr.subnetMatch would accept a table of our own, but it resolves
// overlaps by object key order, and the precedence here is worth reading off the control
// flow instead: the mapped prefix has to be tried before the ::/96 it sits inside.
const IPV4_MAPPED_PREFIX = ipaddr.parseCIDR('::ffff:0:0/96'); // RFC 4291 section 2.5.5.2
const IPV4_COMPATIBLE_PREFIX = ipaddr.parseCIDR('::/96'); // RFC 4291 section 2.5.5.1
const NAT64_WELL_KNOWN_PREFIX = ipaddr.parseCIDR('64:ff9b::/96'); // RFC 6052 section 2.1
const IPV4_TRANSLATED_PREFIX = ipaddr.parseCIDR('::ffff:0:0:0/96'); // RFC 6145 section 2
const SIX_TO_FOUR_PREFIX = ipaddr.parseCIDR('2002::/16'); // RFC 3056 section 2
const TEREDO_PREFIX = ipaddr.parseCIDR('2001::/32'); // RFC 4380 section 4

// The prefix lengths RFC 6052 section 2.2 defines for embedding an IPv4 address. They are
// all whole numbers of bytes, which is what lets the address be read off byte boundaries.
const NAT64_PREFIX_LENGTHS = new Set([32, 40, 48, 56, 64, 96]);

// The one refusal that says nothing about the address itself, only about how this sender is
// configured. It is kept as a constant so createInvalidIpError can recognise it and hold the
// message instead of bouncing it.
const IPV6_DISABLED_REASON = 'This is an IPv6 address, and sending over IPv6 is disabled by the ignoreIPv6 option.';

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
    if (!addr.match(IPV4_COMPATIBLE_PREFIX)) {
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
 * Anything other than the address itself is an IPv4 address recovered from an IPv6 one,
 * so callers can tell the two apart by identity.
 *
 * @param {Object} addr - Parsed ipaddr.js address
 * @param {Array<string>} [nat64Prefixes] - Locally configured NAT64 prefixes in CIDR form
 * @returns {Array<Object>} Parsed addresses to validate
 * @private
 */
function expandTargets(addr, nat64Prefixes) {
    if (addr.kind() !== 'ipv6') {
        return [addr];
    }

    // Envelope forms: the IPv6 address is only a wrapper around the IPv4 address the
    // connection ends up at, so it is judged solely as that IPv4 address. All four park the
    // address in the last 32 bits. The mapped prefix has to be tested before the ::/96 that
    // contains it.
    if (addr.match(IPV4_MAPPED_PREFIX) || isIPv4Compatible(addr) || addr.match(NAT64_WELL_KNOWN_PREFIX) || addr.match(IPV4_TRANSLATED_PREFIX)) {
        return [ipaddr.fromByteArray(addr.toByteArray().slice(12))];
    }

    // Tunnel forms: the outer address routes normally, but the packets are encapsulated
    // towards the embedded IPv4 endpoint, so both have to hold up
    if (addr.match(SIX_TO_FOUR_PREFIX)) {
        // RFC 3056 section 2: 2002:<v4>::/48
        return [addr, ipaddr.fromByteArray(addr.toByteArray().slice(2, 6))];
    }

    if (addr.match(TEREDO_PREFIX)) {
        // RFC 4380 section 4: prefix | server IPv4 | flags | port | client IPv4, where the
        // client address is stored with every bit flipped, so subtracting each byte from
        // 255 recovers it
        const bytes = addr.toByteArray();
        return [addr, ipaddr.fromByteArray(bytes.slice(4, 8)), ipaddr.fromByteArray(bytes.slice(12).map(byte => 255 - byte))];
    }

    // A network may run NAT64 on a prefix out of its own address space, which nothing in the
    // address marks as one. Only the operator knows, so this is checked last and only when
    // they have said so. The outer address is kept as well: unlike the well-known prefix,
    // this one lives in the network's own range, so it is a meaningful address in its own
    // right and a declared prefix must not become a way to stop it being judged as one.
    const embedded = extractFromLocalNat64(addr, nat64Prefixes);
    if (embedded) {
        return [addr, embedded];
    }

    return [addr];
}

/**
 * Recovers the IPv4 address embedded by a locally configured NAT64 prefix.
 *
 * RFC 6052 section 2.2 allows prefix lengths of 32, 40, 48, 56, 64 and 96, and spreads the
 * address across the bits following the prefix while always stepping over byte 8, which is
 * reserved. Taking four bytes from the end of the prefix while skipping that one covers
 * every allowed length.
 *
 * @param {Object} addr - Parsed ipaddr.js IPv6 address
 * @param {Array<string>} [nat64Prefixes] - Prefixes in CIDR form
 * @returns {Object|false} The embedded IPv4 address, or false if none applies
 * @private
 */
function extractFromLocalNat64(addr, nat64Prefixes) {
    // Anything but an array is a configuration mistake, and this is the one check every
    // address depends on, so it must not throw its way out of here for one
    if (!Array.isArray(nat64Prefixes) || !nat64Prefixes.length) {
        return false;
    }

    for (const prefix of nat64Prefixes) {
        let parsed;
        try {
            parsed = ipaddr.parseCIDR(prefix);
        } catch {
            // A prefix that cannot be parsed cannot match anything; ignoring it here keeps a
            // typo in configuration from throwing on every address that gets validated
            continue;
        }

        // Only the lengths RFC 6052 section 2.2 defines are meaningful, and only those land
        // the address on byte boundaries. Anything else has no defined embedding to read, so
        // a mistake in configuration is ignored rather than turned into a wrong address or
        // an exception thrown out of the one check every address depends on.
        if (parsed[0].kind() !== 'ipv6' || !NAT64_PREFIX_LENGTHS.has(parsed[1]) || !addr.match(parsed)) {
            continue;
        }

        const bytes = addr.toByteArray();
        const embedded = [];
        for (let i = parsed[1] / 8; embedded.length < 4 && i < bytes.length; i++) {
            if (i !== 8) {
                embedded.push(bytes[i]);
            }
        }

        if (embedded.length === 4) {
            return ipaddr.fromByteArray(embedded);
        }
    }

    return false;
}

/**
 * Describes an address for a rejection message.
 *
 * Called only when an address is actually rejected, so the common case of a deliverable
 * address builds no string at all.
 *
 * @param {Object} addr - The address that was validated
 * @param {Object} target - The address the rejection is about, which is either addr itself
 *   or an IPv4 address recovered from it
 * @returns {string} Sentence subject naming the address
 * @private
 */
function describeTarget(addr, target) {
    if (target === addr) {
        return 'This IP address';
    }
    return `The IPv4 address [${target.toString()}] carried by this IPv6 address`;
}

/**
 * Validates an IP address for use as an MX server destination.
 *
 * Three tiers, each defined by the range sets above: ranges that can never be a mail host
 * are always refused, local and private scope is refused under blockLocalAddresses along
 * with any address assigned to a local interface, and IANA special-purpose ranges are
 * refused under blockReservedNetworks.
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
 * @param {boolean} [delivery.dnsOptions.ignoreIPv6=false] - Refuse IPv6 addresses
 * @param {boolean} [delivery.dnsOptions.blockLocalAddresses=false] - Block local/private-scope IPs
 * @param {boolean} [delivery.dnsOptions.blockReservedNetworks=false] - Block multicast/reserved IPs
 * @param {Array<string>} [delivery.dnsOptions.nat64Prefixes] - Locally run NAT64 prefixes in
 *   CIDR form, so the IPv4 address they carry can be validated too
 * @param {string} ip - The IP address to validate
 * @returns {string|false} Error message string if invalid, false if valid
 */
function isInvalid(delivery, ip) {
    // Only a canonical literal may be judged. ipaddr.js accepts notations the platform
    // resolver reads differently - it takes a leading zero as octal, so it sees 0127.0.0.1
    // as the public 87.0.0.1, while getaddrinfo reads it as decimal and reaches 127.0.0.1.
    // Since net.connect only skips its own lookup for addresses net.isIP recognises,
    // requiring that here is what makes the address validated and the address connected to
    // the same one.
    if (!net.isIP(ip)) {
        return 'The IP address is not in a recognised notation, so the host it would reach cannot be verified.';
    }

    // Everything net.isIP accepts, ipaddr.js parses, zone identifiers included, so this
    // catch is unreachable today. It stays because the two parsers are separate libraries
    // and the whole point of the check above is that they can disagree: if they ever do
    // again, an unparseable address has to come back invalid rather than throw.
    let addr;
    try {
        addr = ipaddr.parse(ip);
    } catch {
        return 'Failed parsing IP address range.';
    }

    const dnsOptions = delivery.dnsOptions || {};

    // The one transition prefix whose embedded IPv4 address cannot be recovered, so there
    // is nothing to validate and the address has to be taken on trust or refused. Unless the
    // operator has declared the prefix, that is: RFC 8215 set this range aside for exactly
    // the locally chosen prefixes nat64Prefixes describes, and a declared one says where the
    // address sits, which is the only thing missing here.
    if (
        dnsOptions.blockLocalAddresses &&
        addr.kind() === 'ipv6' &&
        addr.match(NAT64_LOCAL_USE_PREFIX) &&
        !extractFromLocalNat64(addr, dnsOptions.nat64Prefixes)
    ) {
        return 'This IP address uses the local-use NAT64 prefix (64:ff9b:1::/48), whose embedded IPv4 address depends on the local network configuration and cannot be read from the address, so it cannot be verified as an external mail host.';
    }

    for (const target of expandTargets(addr, dnsOptions.nat64Prefixes)) {
        const range = target.range();

        // Optionally block local/private-scope ranges (prevents SSRF-like attacks via MX)
        if (dnsOptions.blockLocalAddresses) {
            if (LOCAL_RANGES.has(range)) {
                return `${describeTarget(addr, target)} falls within the prohibited "${range}" address range, which is not valid for external communication.`;
            }

            // Check both forms: the interface list holds canonical addresses, while the input
            // may be an alternate notation of the same address (mapped, uppercase, uncompressed).
            if (isLocal(ip) || isLocal(target.toString())) {
                return 'The resolved IP address corresponds to a local interface.';
            }
        }

        // Reserved ranges are refused only on request; the never-valid ones always are. The
        // two sets are disjoint, so one message covers both.
        if ((dnsOptions.blockReservedNetworks && RESERVED_RANGES.has(range)) || ALWAYS_INVALID_RANGES.has(range)) {
            return `${describeTarget(addr, target)} is within the disallowed "${range}" address range, which is not permitted for direct communication.`;
        }
    }

    // ignoreIPv6 is a statement about which addresses may be used, not merely about which
    // lookups are worth making. Deciding it here is what covers an address the caller handed
    // over through the mx option, which no lookup produced and nothing else would filter;
    // the skipped AAAA queries elsewhere sit on top of this as an optimisation, sparing a
    // lookup whose every answer would be refused anyway.
    //
    // It comes last so that an address which is wrong in its own right is reported as such:
    // an MX record of ::ffff:127.0.0.1 should be recorded as loopback, which is the shape an
    // attack takes, rather than filed under a disabled address family. It also sits outside
    // the unwrapping above on purpose. Those checks ask where the packets land, this one
    // asks which stack the socket uses, and a wrapped address is still put in AAAA and
    // connected to over IPv6.
    if (dnsOptions.ignoreIPv6 && addr.kind() === 'ipv6') {
        return IPV6_DISABLED_REASON;
    }

    return false;
}

/**
 * Builds the error for an address that isInvalid rejected.
 *
 * Shared by the MX and IP resolution steps so a rejection carries the same code,
 * category and response wherever it happens. Keeping the two copies in step by hand is
 * what let them drift apart before, leaving one path without a code to branch on.
 *
 * @param {string} description - How the address came to be used, naming the address
 * @param {string} reason - Explanation from isInvalid
 * @returns {Error} Categorized permanent DNS error
 * @private
 */
function createInvalidIpError(description, reason) {
    const error = new Error(`Unable to deliver email to ${description}. ${reason}`);
    error.code = 'InvalidIpAddress';
    error.response = `DNS Error: ${error.message}`;
    error.category = 'dns';

    // A host refused only because this sender does not use IPv6 is perfectly deliverable
    // again the moment that setting changes, so hold the message rather than bouncing it on
    // a local decision. Every other refusal here is a property of the destination - a
    // loopback or never-valid address stays undeliverable however often it is retried - and
    // those remain permanent.
    if (reason === IPV6_DISABLED_REASON) {
        error.temporary = true;
    }

    return error;
}

/**
 * Validates an address and records it on the delivery object if it is rejected.
 *
 * This is how the pipeline should ask, rather than calling isInvalid directly. A rejected
 * address is a policy decision the caller has no other way to see: when every address of a
 * host is rejected the resulting error explains itself, but when only some are, delivery
 * continues over whatever survived and the filtering would otherwise leave no trace at all,
 * so a host left with only unreachable addresses fails as a plain network error that no
 * amount of log reading ties back to blockLocalAddresses. Pairing the two steps here means
 * a new call site cannot validate an address and forget to record the rejection. The list
 * is exposed as delivery.blockedAddresses on the object handed to the connectHook and
 * connectError callbacks.
 *
 * @param {Object} delivery - The delivery object, carrying dnsOptions and blockedAddresses
 * @param {string} exchange - MX hostname the address belongs to
 * @param {string} ip - The address to validate
 * @returns {string|false} Rejection reason if the address may not be used, false if it may
 */
function checkAddress(delivery, exchange, ip) {
    const reason = isInvalid(delivery, ip);
    if (reason) {
        // buildDeliveryObject owns this field for anything coming through the public API,
        // which is what lets the README promise callbacks an array. The fallback is for the
        // resolution steps being unit tested directly against a hand-built delivery.
        if (!delivery.blockedAddresses) {
            delivery.blockedAddresses = [];
        }
        delivery.blockedAddresses.push({ exchange, ip, reason });
    }
    return reason;
}

module.exports = {
    getDnsResolver,
    isNotFoundError,
    isLocal,
    isInvalid,
    checkAddress,
    createInvalidIpError
};
