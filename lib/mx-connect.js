'use strict';

const formatAddress = require('./format-address');
const resolveMX = require('./resolve-mx');
const resolveIP = require('./resolve-ip');
const getConnection = require('./get-connection');
const net = require('net');

module.exports = (options, callback) => {
    if (typeof options === 'string') {
        options = {
            target: options
        };
    }
    options = options || {};

    let target = (options.target || '').toString().trim();
    let atPos = target.indexOf('@');
    if (atPos >= 0) {
        target = target.substr(atPos + 1);
    }

    let delivery = {
        domain: target,

        mx: [].concat(options.mx || []).map(mx => ({
            exchange: typeof mx === 'string' ? mx : mx && mx.exchange,
            priority: (mx && Number(mx.priority)) || 0,
            A: [].concat(typeof mx === 'string' && net.isIPv4(mx) ? mx : (mx && mx.A) || []),
            AAAA: [].concat(typeof mx === 'string' && net.isIPv6(mx) ? mx : (mx && mx.AAAA) || []),
            mx: false
        })),

        dnsOptions: options.dnsOptions || {
            ignoreIPv6: false,
            preferIPv6: false,
            blockLocalAddresses: false
        },

        port: options.port || 25,

        //milliseconds to wait for the connection (per MX host)
        maxConnectTime: options.maxConnectTime,

        localAddress: options.localAddress,
        localHostname: options.localHostname,

        localAddressIPv4: options.localAddressIPv4,
        localHostnameIPv4: options.localHostnameIPv4,

        localAddressIPv6: options.localAddressIPv6,
        localHostnameIPv6: options.localHostnameIPv6,

        connectHook: options.connectHook,

        ignoreMXHosts: options.ignoreMXHosts || [],
        mxLastError: options.mxLastError || false
    };

    if (delivery.mx.length) {
        // delivery domain is already processed

        if (delivery.mx.find(mx => mx.exchange && !mx.A.length && !mx.AAAA.length)) {
            // IP not yet resolved
            return resolveIP(delivery)
                .then(getConnection)
                .then(mx => callback(null, mx))
                .catch(callback);
        }

        return getConnection(delivery)
            .then(mx => callback(null, mx))
            .catch(callback);
    }
    // resolve MX and A/AAAA addresses
    formatAddress(delivery)
        .then(resolveMX)
        .then(resolveIP)
        .then(getConnection)
        .then(mx => callback(null, mx))
        .catch(callback);
};
