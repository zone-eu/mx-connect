/**
 * @fileoverview Resolves Mail Exchange (MX) records for a domain.
 * Implements a fallback chain: MX records -> A records -> AAAA records.
 * This allows direct delivery to hosts without MX records configured.
 * @module resolve-mx
 */

'use strict';

const dnsErrors = require('./dns-errors');
const tools = require('./tools');

/**
 * Creates a standardized DNS error with category and response properties.
 *
 * Marks errors as temporary if they indicate a server-side DNS failure
 * (like SERVFAIL) rather than a permanent "not found" condition.
 *
 * @param {Error|null} err - The original DNS error, or null to create a generic error
 * @param {string} domain - The domain being resolved (for error message)
 * @param {string} [defaultMessage='No MX server found'] - Message when err is null
 * @returns {Error} Standardized error with message, response, code, category, and temporary properties
 * @private
 */
function createDnsError(err, domain, defaultMessage) {
    const error = err || new Error(defaultMessage || 'No MX server found');
    const errorDescription = dnsErrors[error.code] || error.message;
    error.message = `DNS error occurred while resolving the Mail Exchange (MX) server for the specified domain (${domain}). ${errorDescription}`;
    error.response = `DNS Error: ${error.message}`;
    error.code = error.code || 'ENOTFOUND';
    error.category = 'dns';
    // DNS server failures (SERVFAIL, etc.) are temporary; "not found" is permanent
    if (err && !tools.isNotFoundError(err)) {
        error.temporary = true;
    }
    return error;
}

/**
 * Detects an RFC 7505 "null MX" record.
 *
 * A domain that does not accept mail publishes a single MX RR with preference 0 and a root
 * exchange ("0 ."). Node's resolver (dns.resolveMx, via c-ares) returns that root as an
 * empty string (verified: example.com -> exchange ""), which is the form seen in practice.
 * mx-connect also accepts a custom dnsOptions.resolve whose output is not guaranteed to
 * match c-ares, so the literal "." (the canonical root form) is normalized to a null MX
 * as well.
 *
 * @param {Object} entry - An MX record ({ exchange, priority })
 * @returns {boolean} True if the record is a null MX
 * @private
 */
function isNullMx(entry) {
    if (!entry) {
        return false;
    }
    const exchange = (entry.exchange || '').trim();
    return exchange === '' || exchange === '.';
}

/**
 * Creates a permanent error for an RFC 7505 null MX domain.
 *
 * Null MX is an explicit, authoritative statement that the domain accepts no mail, so the
 * error is permanent (temporary is left falsy) - it must never be deferred/retried. The
 * category is 'dns' so downstream MTAs classify it alongside other resolution failures.
 *
 * @param {string} domain - The domain that published the null MX
 * @returns {Error} Standardized permanent error
 * @private
 */
function createNullMxError(domain) {
    const error = new Error(`The recipient domain (${domain}) does not accept email; it publishes a null MX record (RFC 7505).`);
    error.response = `DNS Error: ${error.message}`;
    error.code = 'ENULLMX';
    error.category = 'dns';
    return error;
}

/**
 * Determines if a DNS error is recoverable (safe to try fallback record types).
 *
 * Returns true if:
 * - No error occurred (empty result, not an error)
 * - Error is ENODATA or ENOTFOUND (no records of this type exist)
 *
 * Returns false for actual DNS failures (SERVFAIL, REFUSED, etc.)
 * which should be thrown immediately rather than masked by fallback attempts.
 *
 * @param {Error|null} err - The DNS error to check
 * @returns {boolean} True if we should continue to fallback record types
 * @private
 */
function isRecoverableError(err) {
    return !err || tools.isNotFoundError(err);
}

/**
 * Wraps a DNS resolution call with error handling.
 *
 * Returns both the result list and any error, allowing the caller to decide
 * whether to throw, retry with fallback, or continue. This enables the
 * MX -> A -> AAAA fallback chain without nested try/catch blocks.
 *
 * @param {Function} dnsResolve - Promise-based DNS resolver function
 * @param {string} domain - Domain to resolve
 * @param {string} type - Record type (MX, A, AAAA)
 * @returns {Promise<{list: Array, error: Error|null}>} Resolution result with list and error
 * @private
 */
async function tryResolve(dnsResolve, domain, type) {
    try {
        // getDnsResolver already reduces any answer to an array with no falsy entries, so
        // reading .priority off a record below cannot throw on a broken custom resolver
        return { list: await dnsResolve(domain, type), error: null };
    } catch (err) {
        return { list: [], error: err };
    }
}

/**
 * Resolves MX records for a domain with fallback to A/AAAA records.
 *
 * Resolution strategy:
 * 1. If target is an IP address, use it directly (no DNS lookup)
 * 2. Try MX records first - these are the canonical mail server entries
 * 3. Fallback to A records - allows delivery to hosts without MX configured
 * 4. Fallback to AAAA records - IPv6-only hosts (unless ignoreIPv6=true)
 *
 * The fallback behavior follows RFC 5321 Section 5.1, which specifies that
 * if no MX records are found, the domain itself should be used as the mail host.
 *
 * @param {Object} delivery - The delivery object with parsed address info
 * @param {string} delivery.decodedDomain - The ASCII domain to resolve
 * @param {boolean} delivery.isIp - True if target is already an IP address
 * @param {Object} [delivery.dnsOptions] - DNS configuration options
 * @param {boolean} [delivery.dnsOptions.ignoreIPv6=false] - Skip AAAA record lookup
 * @param {Function} [delivery.dnsOptions.resolveRecords] - Promise-based DNS resolver
 * @param {Function} [delivery.dnsOptions.resolve] - Callback-based DNS resolver (legacy)
 * @returns {Promise<Object>} Delivery object with populated mx array
 * @throws {Error} If no valid MX servers can be resolved (error.category = 'dns')
 */
async function resolveMX(delivery) {
    // Track first error and whether any valid address was found
    // Used to provide meaningful errors when all addresses are filtered out
    let firstError = null;
    let addressFound = false;
    const dnsOptions = delivery.dnsOptions || { ignoreIPv6: false };

    /**
     * Filters IP addresses, rejecting invalid/local ones.
     * Captures the first error for later if all addresses are filtered out.
     * Sets addressFound=true when a valid address passes through.
     * @private
     */
    const filterAddress = ip => {
        const invalid = tools.checkAddress(delivery, delivery.decodedDomain, ip);
        if (invalid) {
            if (!firstError) {
                firstError = tools.createInvalidIpError(`the IP address [${ip}] resolved for the Mail Exchange (MX) server of "${delivery.domain}"`, invalid);
            }
            return false;
        }
        addressFound = true;
        return true;
    };

    // Handle IP address targets directly
    if (delivery.isIp) {
        const ip = delivery.decodedDomain;

        // Checked here rather than through filterAddress: an IP literal target was handed to
        // us rather than resolved for the domain, so blaming an MX lookup would send the
        // operator hunting through DNS for a record that does not exist
        const invalid = tools.checkAddress(delivery, ip, ip);
        if (invalid) {
            throw tools.createInvalidIpError(`the IP address [${ip}] given as the delivery target`, invalid);
        }

        delivery.mx = [
            {
                priority: 0,
                exchange: ip,
                ...tools.addressBuckets(ip)
            }
        ];
        return delivery;
    }

    const domain = delivery.decodedDomain;
    const dnsResolve = tools.getDnsResolver(dnsOptions);

    // Step 1: Try MX records (canonical mail server entries)
    const mxResult = await tryResolve(dnsResolve, domain, 'MX');
    const mxRecords = mxResult.list;
    if (mxRecords.length) {
        // RFC 7505 null MX: a "0 ." record signals the domain accepts no mail. Drop such
        // entries so "." is never treated as a hostname (which would otherwise fail as a
        // confusing resolution error).
        const usable = mxRecords.filter(entry => !isNullMx(entry));

        // Only a null MX on its own is an authoritative "no mail here". Fail permanently and
        // do NOT fall back to A/AAAA records.
        //
        // RFC 7505 Section 4.1 forbids publishing a null MX alongside other MX records, so a
        // mix is a misconfiguration rather than a refusal. Deliver via the remaining records
        // instead of bouncing a domain that plainly still accepts mail - the same leniency
        // keeps a single malformed entry (an empty exchange from a custom resolver) from
        // taking down an otherwise valid MX set.
        if (!usable.length) {
            throw createNullMxError(domain);
        }

        // Sort by priority (lower number = higher priority) per RFC 5321
        delivery.mx = usable.sort((a, b) => a.priority - b.priority).map(entry => ({ ...entry, mx: true, A: [], AAAA: [] }));
        return delivery;
    }
    // Non-recoverable DNS errors (SERVFAIL, etc.) should be thrown immediately
    if (mxResult.error && !isRecoverableError(mxResult.error)) {
        throw createDnsError(mxResult.error, domain);
    }

    // Steps 2 and 3: fall back to the domain's own addresses (RFC 5321 Section 5.1 implicit
    // MX), A first and then AAAA. The two lookups differ only in the record type and the
    // array the addresses land in, so they run as one loop.
    //
    // AAAA is asked for even under ignoreIPv6, where the addresses are then refused by the
    // filter. Skipping the lookup saved nothing, since reaching here already means the domain
    // published no MX and no A record, and it left an IPv6-only domain indistinguishable from
    // one with no mail service at all: the delivery bounced as "no MX server found" for what
    // is really a local setting, rather than waiting on a retryable error naming the address.
    for (const type of ['A', 'AAAA']) {
        const result = await tryResolve(dnsResolve, domain, type);

        if (result.list.length) {
            // RFC 5321 Section 5.1: the domain itself is a single implicit mail exchanger, so
            // all of its addresses belong to one entry. Giving each address an entry of its
            // own would leave a rejected address behind as an entry holding nothing, which the
            // IP step then resolves all over again and rejects a second time.
            delivery.mx = [
                {
                    priority: 0,
                    exchange: domain,
                    mx: false, // Mark as implicit MX (not from MX record)
                    A: [],
                    AAAA: [],
                    [type]: result.list.filter(filterAddress)
                }
            ];

            // If all addresses were filtered out as invalid, throw the captured error
            if (!addressFound && firstError) {
                throw firstError;
            }
            return delivery;
        }

        if (result.error && !isRecoverableError(result.error)) {
            throw createDnsError(result.error, domain);
        }
    }

    // No records found at all - domain has no mail handling capability
    throw createDnsError(null, domain, 'No MX server found');
}

module.exports = resolveMX;
