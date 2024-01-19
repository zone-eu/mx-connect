'use strict';

const net = require('net');
const punycode = require('punycode');

function formatAddress(delivery) {
    // Check if the domain looks like an IP literal. IP addresses need to be enclosed in square brackets
    //     user@[127.0.0.1]
    //     user@[IPv6:2001:db8:1ff::a0b:dbd0]
    delivery.isIp = ((/^\[(ipv6:)?[^\]]+\]$/i.test(delivery.domain) || net.isIP(delivery.domain)) && true) || false;

    delivery.isPunycode = false;

    let dnsOptions = delivery.dnsOptions || {};

    if (delivery.isIp) {
        // remove the enclosing brackets
        delivery.decodedDomain = delivery.domain.replace(/^\[(ipv6:)?|\]$/gi, '');
        if (!net.isIP(delivery.decodedDomain)) {
            // the result does not seem to be either IPv4 or IPv6 address
            let error = new Error(delivery.decodedDomain + ' does not appear to be a properly formatted IP address');
            error.response = `DNS Error: ${error.message}`;
            error.category = 'dns';
            return Promise.reject(error);
        }
        if (net.isIPv6(delivery.decodedDomain) && dnsOptions.ignoreIPv6) {
            let error = new Error(
                `The Mail Exchange (MX) resolved to an IPv6 address "${delivery.decodedDomain}". However, sending mail to IPv6 addresses is not supported in the current configuration`
            );
            error.response = `Network error: ${error.message}`;
            error.category = 'dns';
            return Promise.reject(error);
        }
    } else {
        // decode potential unicode in domain part. If nothing was changed then the domain did not use unicode
        //     user@jõgeva.公司
        delivery.decodedDomain = punycode.toASCII(delivery.domain);
        delivery.isPunycode = delivery.decodedDomain !== delivery.domain;
    }

    return Promise.resolve(delivery);
}

module.exports = formatAddress;
