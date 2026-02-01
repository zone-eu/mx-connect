/**
 * @fileoverview Resolves Mail Exchange (MX) records for a domain.
 * Implements a fallback chain: MX records -> A records -> AAAA records.
 * This allows direct delivery to hosts without MX records configured.
 * @module resolve-mx
 */

'use strict';

const net = require('net');
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
 * @param {string} [type] - Record type (MX, AAAA). Omit for A records.
 * @returns {Promise<{list: Array, error: Error|null}>} Resolution result with list and error
 * @private
 */
async function tryResolve(dnsResolve, domain, type) {
    try {
        const list = type !== undefined ? await dnsResolve(domain, type) : await dnsResolve(domain);
        return { list: list || [], error: null };
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
 * @param {Function} [delivery.dnsOptions.resolve] - Custom DNS resolver
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

    // Step 1: Try MX records (canonical mail server entries)
    const mxResult = await tryResolve(dnsResolve, domain, 'MX');
    if (mxResult.list.length) {
        // Sort by priority (lower number = higher priority) per RFC 5321
        delivery.mx = mxResult.list
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map(entry => ({ ...entry, mx: true, A: [], AAAA: [] }));
        return delivery;
    }
    // Non-recoverable DNS errors (SERVFAIL, etc.) should be thrown immediately
    if (mxResult.error && !isRecoverableError(mxResult.error)) {
        throw createDnsError(mxResult.error, domain);
    }

    // Step 2: Fallback to A records (RFC 5321 Section 5.1 implicit MX)
    const aResult = await tryResolve(dnsResolve, domain);
    if (aResult.list.length) {
        delivery.mx = aResult.list.map(entry => ({
            priority: 0,
            exchange: domain,
            mx: false, // Mark as implicit MX (not from MX record)
            A: [entry].filter(filterAddress),
            AAAA: []
        }));
        // If all addresses were filtered out as invalid, throw the captured error
        if (!addressFound && firstError) {
            throw firstError;
        }
        return delivery;
    }
    if (aResult.error && !isRecoverableError(aResult.error)) {
        throw createDnsError(aResult.error, domain);
    }

    // Step 3: Fallback to AAAA records (IPv6-only hosts)
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

    // No records found at all - domain has no mail handling capability
    throw createDnsError(null, domain, 'No MX server found');
}

module.exports = resolveMX;
