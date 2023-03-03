'use strict';

const formatAddress = require('./format-address');
const resolveMX = require('./resolve-mx');
const resolveIP = require('./resolve-ip');
const getConnection = require('./get-connection');
const net = require('net');
const dns = require('dns');
const { getPolicy, validateMx } = require('mailauth/lib/mta-sts');
const util = require('util');

const EMTPY_CACHE_HANDLER = {
    async get(/*domain*/) {
        return false;
    },
    async set(/*domain, policyObject*/) {
        return false;
    }
};

const resolvePolicy = async delivery => {
    if (!delivery.mtaSts.enabled) {
        return delivery;
    }

    const knownPolicy = await delivery.mtaSts.cache.get(delivery.decodedDomain);
    const { policy, status } = await getPolicy(delivery.decodedDomain, knownPolicy, {
        resolver: delivery.dnsOptions && delivery.dnsOptions.resolve && util.promisify(delivery.dnsOptions.resolve)
    });

    if (status !== 'cached') {
        await delivery.mtaSts.cache.set(delivery.decodedDomain, policy);
    }

    delivery.mtaSts.policy = policy;

    return delivery;
};

const validateMxPolicy = async delivery => {
    if (!delivery.mtaSts.enabled) {
        return delivery;
    }

    for (let mx of delivery.mx) {
        mx.policyMatch = validateMx(mx.exchange, delivery.mtaSts.policy);
    }

    return delivery;
};

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

    let mtaSts = Object.assign({ enabled: false }, options.mtaSts);
    mtaSts.logger = mtaSts.logger || (() => false);
    mtaSts.cache = mtaSts.cache || EMTPY_CACHE_HANDLER;

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
            blockLocalAddresses: false,
            resolve: dns.resolve
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
        connectError: options.connectError,

        ignoreMXHosts: options.ignoreMXHosts || [],
        mxLastError: options.mxLastError || false,

        mtaSts
    };

    if (delivery.mx.length) {
        // delivery domain is already processed

        if (delivery.mx.find(mx => mx.exchange && !mx.A.length && !mx.AAAA.length)) {
            // IP not yet resolved
            return formatAddress(delivery)
                .then(resolvePolicy)
                .then(validateMxPolicy)
                .then(resolveIP)
                .then(getConnection)
                .then(mx => callback(null, mx))
                .catch(callback);
        }

        return formatAddress(delivery)
            .then(resolvePolicy)
            .then(validateMxPolicy)
            .then(getConnection)
            .then(mx => callback(null, mx))
            .catch(callback);
    }

    // resolve MX and A/AAAA addresses
    formatAddress(delivery)
        .then(resolvePolicy)
        .then(resolveMX)
        .then(validateMxPolicy)
        .then(resolveIP)
        .then(getConnection)
        .then(mx => callback(null, mx))
        .catch(callback);
};
