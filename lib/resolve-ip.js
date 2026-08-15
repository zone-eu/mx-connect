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
 * @param {string} type - Record type ('A' or 'AAAA')
 * @returns {Promise<Array>} Array of IP addresses or [{error, exchange}] on failure
 * @private
 */
async function resolveRecordType(dnsResolve, exchange, type) {
    try {
        const list = await dnsResolve(exchange, type);
        return list || [];
    } catch (err) {
        // "Not found" is not an error - just means no records of this type
        if (tools.isNotFoundError(err)) {
            return [];
        }
        // Embed error in array for later handling during filtering
        return [{ error: err, exchange }];
    }
}

/**
 * Resolves one record type for an MX entry and stores the result on the entry
 * (entry.A for 'A' lookups, entry.AAAA for 'AAAA' lookups).
 *
 * @param {Function} dnsResolve - Promise-based DNS resolver
 * @param {Object} entry - MX entry to populate
 * @param {string} type - Record type ('A' or 'AAAA')
 * @returns {Promise<void>} Resolves once the entry property has been assigned
 * @private
 */
async function resolveEntryRecords(dnsResolve, entry, type) {
    entry[type] = await resolveRecordType(dnsResolve, entry.exchange, type);
}

/**
 * Resolves the AAAA records that ignoreIPv6 caused to be skipped, so a delivery that found
 * no usable address can report whether the host is reachable over IPv6 only.
 *
 * Each address is put through the same filter as any other, which refuses it for the
 * ignoreIPv6 reason, records it on the delivery, and produces a temporary error: the host
 * is perfectly deliverable the moment the setting changes, so the message should wait
 * rather than bounce.
 *
 * @param {Array<Object>} skipped - The entries whose AAAA lookup was skipped
 * @param {Function} dnsResolve - Promise-based DNS resolver
 * @param {Function} filterAddress - The filter used for resolved addresses
 * @returns {Promise<void>} Resolves once every outstanding host has been asked
 * @private
 */
async function diagnoseSkippedIPv6(skipped, dnsResolve, filterAddress) {
    await Promise.all(
        skipped.map(async entry => {
            const addresses = await resolveRecordType(dnsResolve, entry.exchange, 'AAAA');
            for (const ip of addresses) {
                // A lookup failure here says nothing useful: the delivery already failed for
                // its own reason, and this is only trying to explain it better
                if (ip && !ip.error) {
                    filterAddress(ip, entry.exchange);
                }
            }
        })
    );
}

/**
 * Resolves IP addresses for all MX entries in parallel.
 *
 * For each MX hostname, performs A record lookup (IPv4) and optionally
 * AAAA record lookup (IPv6 unless ignoreIPv6=true). All lookups run
 * concurrently via Promise.all for performance. Entries that already carry
 * addresses, either from the caller's mx option or from an IP literal target,
 * are left alone rather than looked up again.
 *
 * Every address then passes through validation, whatever its origin, and invalid
 * ones (local, private, broadcast) are filtered out according to the configured
 * options. Throws if no valid addresses remain.
 *
 * @param {Object} delivery - Delivery object with MX entries to resolve
 * @param {Array} delivery.mx - Array of MX entries with exchange hostnames
 * @param {Object} [delivery.dnsOptions] - DNS configuration options
 * @param {boolean} [delivery.dnsOptions.ignoreIPv6=false] - Skip AAAA lookups
 * @param {Function} [delivery.dnsOptions.resolveAsync] - Promise-based DNS resolver
 * @param {Function} [delivery.dnsOptions.resolve] - Callback-based DNS resolver (legacy)
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
    const filterAddress = (ip, exchange) => {
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
        const invalid = tools.checkAddress(delivery, exchange, ip);
        if (invalid) {
            if (!firstError) {
                firstError = tools.createInvalidIpError(`the IP address [${ip}] resolved for the Mail Exchange (MX) server of "${delivery.domain}"`, invalid);
            }
            return false;
        }

        addressFound = true;
        return true;
    };

    const dnsOptions = delivery.dnsOptions || {};
    const dnsResolve = tools.getDnsResolver(dnsOptions);

    // Hosts whose AAAA lookup ignoreIPv6 skipped, kept only to explain a failed delivery
    const skippedIPv6 = [];

    // Build array of resolution promises using flatMap for parallel execution
    // Each MX entry generates 1-2 promises (A and optionally AAAA)
    const resolutionPromises = delivery.mx.flatMap(entry => {
        // An entry need not arrive with these arrays: mx-connect always supplies them, but
        // this step is also driven directly, and the lookups below used to be what created
        // them. Both the check that follows and the filtering at the end read them.
        entry.A = entry.A || [];
        entry.AAAA = entry.AAAA || [];

        // Addresses supplied by the caller through the mx option are used as they are.
        // They still go through the filtering below, which is the only place any address
        // is validated - skipping this step entirely would let an mx option of
        // ['127.0.0.1'] connect to loopback with blockLocalAddresses enabled.
        if (entry.A.length || entry.AAAA.length) {
            return [];
        }

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
        const tasks = [resolveEntryRecords(dnsResolve, entry, 'A')];

        // Optionally resolve AAAA records (IPv6)
        if (dnsOptions.ignoreIPv6) {
            // Remember what went unasked, so a delivery that ends up with nothing can say
            // whether the host was reachable over IPv6 all along
            skippedIPv6.push(entry);
        } else {
            tasks.push(resolveEntryRecords(dnsResolve, entry, 'AAAA'));
        }

        return tasks;
    });

    // Execute all DNS lookups in parallel for performance
    await Promise.all(resolutionPromises);

    // Filter out invalid/local addresses from all entries
    for (const entry of delivery.mx) {
        const keep = ip => filterAddress(ip, entry.exchange);
        entry.A = entry.A.filter(keep);
        entry.AAAA = entry.AAAA.filter(keep);
    }

    // Throw error if no valid addresses remain
    if (!addressFound) {
        // ignoreIPv6 skipped the AAAA lookups above, so a host reachable only over IPv6 is
        // indistinguishable here from one with no addresses at all, and the delivery would
        // bounce as "nothing resolved" for what is really a local setting. Ask for those
        // records now, purely to say so. This runs only on a delivery that has already
        // failed, and turns it into an accurate, retryable error that names the addresses
        // that were passed over.
        if (!firstError && dnsOptions.ignoreIPv6) {
            await diagnoseSkippedIPv6(skippedIPv6, dnsResolve, filterAddress);
        }

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
