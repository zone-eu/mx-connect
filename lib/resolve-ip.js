/**
 * @fileoverview Resolves MX hostnames to IP addresses.
 * Performs parallel A and AAAA record lookups for all MX entries,
 * then filters out invalid/local addresses based on configuration.
 * @module resolve-ip
 */

'use strict';

const net = require('net');
const dnsErrors = require('./dns-errors');
const tools = require('./tools');

/**
 * Resolves a specific DNS record type for an MX hostname.
 *
 * Returns an empty array for "not found" errors (ENODATA, ENOTFOUND),
 * allowing the connection to proceed with other record types.
 * For actual DNS failures, embeds the error in the result array
 * to be handled during filtering.
 *
 * @param {Function} dnsResolve - Promise-based DNS resolver
 * @param {string} exchange - MX hostname to resolve
 * @param {string|null} type - Record type ('AAAA') or null for A records
 * @returns {Promise<Array>} Array of IP addresses or [{error, exchange}] on failure
 * @private
 */
function resolveRecordType(dnsResolve, exchange, type) {
    const resolvePromise = type ? dnsResolve(exchange, type) : dnsResolve(exchange);
    return resolvePromise.then(
        list => list || [],
        err => {
            // "Not found" is not an error - just means no records of this type
            if (tools.isNotFoundError(err)) {
                return [];
            }
            // Embed error in array for later handling during filtering
            return [{ error: err, exchange }];
        }
    );
}

/**
 * Resolves IP addresses for all MX entries in parallel.
 *
 * For each MX hostname, performs A record lookup (IPv4) and optionally
 * AAAA record lookup (IPv6 unless ignoreIPv6=true). All lookups run
 * concurrently via Promise.all for performance.
 *
 * After resolution, filters out invalid addresses (local, private, broadcast)
 * based on configuration. Throws if no valid addresses remain.
 *
 * @param {Object} delivery - Delivery object with MX entries to resolve
 * @param {Array} delivery.mx - Array of MX entries with exchange hostnames
 * @param {Object} [delivery.dnsOptions] - DNS configuration options
 * @param {boolean} [delivery.dnsOptions.ignoreIPv6=false] - Skip AAAA lookups
 * @param {Function} [delivery.dnsOptions.resolve] - Custom DNS resolver
 * @returns {Promise<Object>} Delivery object with populated A/AAAA arrays
 * @throws {Error} If no valid IP addresses can be resolved (error.category = 'dns')
 */
async function resolveIP(delivery) {
    // Track first error and whether any valid address was found
    let firstError = null;
    let addressFound = false;

    /**
     * Filters IP addresses and embedded errors from resolution results.
     * Captures the first error encountered for later if all addresses fail.
     * @private
     */
    const filterAddress = ip => {
        // Handle DNS resolution errors embedded in the array by resolveRecordType
        if (ip && ip.error) {
            if (!firstError) {
                const err = ip.error;
                err.exchange = ip.exchange;
                err.response = `DNS Error: Unable to resolve the IP address for the specified host [${ip.exchange}] of the Mail Exchange (MX) server for the domain "${delivery.domain}". ${dnsErrors[err.code] || err.message}`;
                err.category = 'dns';
                err.temporary = true;
                firstError = err;
            }
            return false;
        }

        // Check if IP is invalid (local, private, broadcast, etc.)
        const invalid = tools.isInvalid(delivery, ip);
        if (invalid) {
            if (!firstError) {
                const detail = typeof invalid === 'string' ? `. ${invalid}` : '';
                firstError = new Error(
                    `Unable to deliver email to the IP address [${ip}] resolved for the Mail Exchange (MX) server of "${delivery.domain}"${detail}`
                );
                firstError.code = 'InvalidIpAddress';
                firstError.response = `DNS Error: ${firstError.message}`;
                firstError.category = 'dns';
            }
            return false;
        }

        addressFound = true;
        return true;
    };

    const dnsOptions = delivery.dnsOptions || {};
    const dnsResolve = tools.getDnsResolver(dnsOptions.resolve);

    // Build array of resolution promises using flatMap for parallel execution
    // Each MX entry generates 1-2 promises (A and optionally AAAA)
    const resolutionPromises = delivery.mx.flatMap(entry => {
        if (!entry.exchange) {
            return [];
        }

        // Skip DNS lookup if exchange is already an IP address
        if (net.isIP(entry.exchange)) {
            if (net.isIPv4(entry.exchange)) {
                entry.A = [entry.exchange];
            } else if (net.isIPv6(entry.exchange)) {
                entry.AAAA = [entry.exchange];
            }
            return [];
        }

        // Always resolve A records (IPv4)
        const tasks = [resolveRecordType(dnsResolve, entry.exchange, null).then(list => (entry.A = list))];

        // Optionally resolve AAAA records (IPv6)
        if (!dnsOptions.ignoreIPv6) {
            tasks.push(resolveRecordType(dnsResolve, entry.exchange, 'AAAA').then(list => (entry.AAAA = list)));
        }

        return tasks;
    });

    // Execute all DNS lookups in parallel for performance
    await Promise.all(resolutionPromises);

    // Filter out invalid/local addresses from all entries
    for (const entry of delivery.mx) {
        entry.A = entry.A.filter(filterAddress);
        entry.AAAA = entry.AAAA.filter(filterAddress);
    }

    // Throw error if no valid addresses remain
    if (!addressFound) {
        if (firstError) {
            throw firstError;
        }

        const error = new Error(`Failed to resolve any IP addresses for the Mail Exchange (MX) server associated with "${delivery.domain}"`);
        error.code = 'ENOTFOUND';
        error.response = `DNS Error: ${error.message}`;
        error.category = 'dns';
        throw error;
    }

    return delivery;
}

module.exports = resolveIP;
