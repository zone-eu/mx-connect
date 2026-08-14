/**
 * @fileoverview Parses and validates target addresses for MX resolution.
 * Handles domain names, email addresses, IP addresses, and IP literals.
 * Converts Unicode domains to ASCII (punycode) for DNS lookups.
 * @module format-address
 */

'use strict';

const net = require('net');
const punycode = require('punycode/');

// Matches IP address literals like [127.0.0.1] or [IPv6:2001:db8::1]
const IP_LITERAL_REGEX = /^\[(ipv6:)?[^\]]+\]$/i;
// Strips the brackets and optional "ipv6:" prefix from IP literals
const IP_LITERAL_STRIP_REGEX = /^\[(ipv6:)?|\]$/gi;

/**
 * Parses and validates the target address from the delivery object.
 *
 * This is the first step in the MX connection pipeline. It determines whether
 * the target is an IP address (direct connection) or a domain name (requires
 * MX/DNS resolution), and handles Unicode domain conversion to ASCII (punycode).
 *
 * Sets the following properties on the delivery object:
 * - isIp: boolean indicating if target is an IP address
 * - isPunycode: boolean indicating if domain required punycode conversion
 * - decodedDomain: the ASCII-safe domain or raw IP address
 *
 * @param {Object} delivery - The delivery object to process
 * @param {string} delivery.domain - The target domain or IP address
 * @returns {Promise<Object>} The delivery object with parsed address info
 * @throws {Error} If an IP literal target is not a valid IP address
 *
 * @example
 * // Domain input
 * formatAddress({ domain: 'example.com' })
 * // Result: { domain: 'example.com', decodedDomain: 'example.com', isIp: false, isPunycode: false }
 *
 * @example
 * // IP literal input
 * formatAddress({ domain: '[192.168.1.1]' })
 * // Result: { domain: '[192.168.1.1]', decodedDomain: '192.168.1.1', isIp: true, isPunycode: false }
 */
async function formatAddress(delivery) {
    // Check if domain is an IP literal (e.g., [127.0.0.1] or [IPv6:2001:db8::1])
    // or a bare IP address (without brackets)
    delivery.isIp = IP_LITERAL_REGEX.test(delivery.domain) || Boolean(net.isIP(delivery.domain));
    delivery.isPunycode = false;

    if (delivery.isIp) {
        // Strip brackets and "IPv6:" prefix from IP literals
        delivery.decodedDomain = delivery.domain.replace(IP_LITERAL_STRIP_REGEX, '');

        if (!net.isIP(delivery.decodedDomain)) {
            const error = new Error(`${delivery.decodedDomain} does not appear to be a properly formatted IP address`);
            error.response = `DNS Error: ${error.message}`;
            error.category = 'dns';
            throw error;
        }

        // ignoreIPv6 is not applied here. This step only parses the target; whether an
        // address may be used is decided in tools.isInvalid, which every address reaches.
        // Refusing here as well rejected deliveries that were never going to use the target
        // as a destination, such as an IPv6 target with the mx option supplying the real
        // host, and did it with an error blaming an MX lookup for an address the caller
        // handed over directly.
        return delivery;
    }

    // Convert Unicode domain to ASCII (punycode) for DNS lookups
    // e.g., "example.xn--e1afmkfd" or "mailing.example" -> ASCII equivalent
    delivery.decodedDomain = punycode.toASCII(delivery.domain);
    delivery.isPunycode = delivery.decodedDomain !== delivery.domain;

    return delivery;
}

module.exports = formatAddress;
