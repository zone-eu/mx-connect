'use strict';

const net = require('net');
const punycode = require('punycode');

const IP_LITERAL_REGEX = /^\[(ipv6:)?[^\]]+\]$/i;
const IP_LITERAL_STRIP_REGEX = /^\[(ipv6:)?|\]$/gi;

function formatAddress(delivery) {
    const dnsOptions = delivery.dnsOptions || {};

    // Check if domain is an IP literal (e.g., [127.0.0.1] or [IPv6:2001:db8::1])
    delivery.isIp = IP_LITERAL_REGEX.test(delivery.domain) || Boolean(net.isIP(delivery.domain));
    delivery.isPunycode = false;

    if (delivery.isIp) {
        delivery.decodedDomain = delivery.domain.replace(IP_LITERAL_STRIP_REGEX, '');

        if (!net.isIP(delivery.decodedDomain)) {
            const error = new Error(`${delivery.decodedDomain} does not appear to be a properly formatted IP address`);
            error.response = `DNS Error: ${error.message}`;
            error.category = 'dns';
            return Promise.reject(error);
        }

        if (net.isIPv6(delivery.decodedDomain) && dnsOptions.ignoreIPv6) {
            const error = new Error(
                `The Mail Exchange (MX) resolved to an IPv6 address "${delivery.decodedDomain}". However, sending mail to IPv6 addresses is not supported in the current configuration`
            );
            error.response = `Network error: ${error.message}`;
            error.category = 'dns';
            return Promise.reject(error);
        }

        return Promise.resolve(delivery);
    }

    // Decode potential unicode in domain part (punycode conversion)
    delivery.decodedDomain = punycode.toASCII(delivery.domain);
    delivery.isPunycode = delivery.decodedDomain !== delivery.domain;

    return Promise.resolve(delivery);
}

module.exports = formatAddress;
