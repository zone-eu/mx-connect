'use strict';

const formatAddress = require('./format-address');
const resolveMX = require('./resolve-mx');
const resolveIP = require('./resolve-ip');
const getConnection = require('./get-connection');
const net = require('net');
const dns = require('dns');
const { getPolicy, validateMx } = require('mailauth/lib/mta-sts');
const util = require('util');

const EMPTY_CACHE_HANDLER = {
    async get() {
        return false;
    },
    async set() {
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
    mtaSts.cache = mtaSts.cache || EMPTY_CACHE_HANDLER;

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

    // Build the processing pipeline based on what data is already provided
    const hasMx = delivery.mx.length > 0;
    const needsIpResolution = hasMx && delivery.mx.some(mx => mx.exchange && !mx.A.length && !mx.AAAA.length);

    const pipeline = [formatAddress, resolvePolicy, !hasMx && resolveMX, validateMxPolicy, (!hasMx || needsIpResolution) && resolveIP, getConnection].filter(
        Boolean
    );

    const promise = pipeline.reduce((chain, fn) => chain.then(fn), Promise.resolve(delivery));

    // If callback provided, wire it up (backward compatible)
    if (typeof callback === 'function') {
        promise.then(result => callback(null, result)).catch(callback);
    }

    return promise;
};
