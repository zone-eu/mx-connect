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

async function resolvePolicy(delivery) {
    if (!delivery.mtaSts.enabled) {
        return delivery;
    }

    const knownPolicy = await delivery.mtaSts.cache.get(delivery.decodedDomain);
    const resolver = delivery.dnsOptions?.resolve && util.promisify(delivery.dnsOptions.resolve);
    const { policy, status } = await getPolicy(delivery.decodedDomain, knownPolicy, { resolver });

    if (status !== 'cached') {
        await delivery.mtaSts.cache.set(delivery.decodedDomain, policy);
    }

    delivery.mtaSts.policy = policy;
    return delivery;
}

async function validateMxPolicy(delivery) {
    if (!delivery.mtaSts.enabled) {
        return delivery;
    }

    for (const mx of delivery.mx) {
        mx.policyMatch = validateMx(mx.exchange, delivery.mtaSts.policy);
    }

    return delivery;
}

function normalizeMxEntry(mx) {
    if (typeof mx === 'string') {
        return {
            exchange: mx,
            priority: 0,
            A: net.isIPv4(mx) ? [mx] : [],
            AAAA: net.isIPv6(mx) ? [mx] : [],
            mx: false
        };
    }
    return {
        exchange: mx?.exchange,
        priority: Number(mx?.priority) || 0,
        A: mx?.A ? [].concat(mx.A) : [],
        AAAA: mx?.AAAA ? [].concat(mx.AAAA) : [],
        mx: false
    };
}

module.exports = function mxConnect(options, callback) {
    if (typeof options === 'string') {
        options = { target: options };
    }
    options = options || {};

    let target = (options.target || '').toString().trim();
    const atPos = target.indexOf('@');
    if (atPos >= 0) {
        target = target.substring(atPos + 1);
    }

    const mtaSts = {
        enabled: false,
        ...options.mtaSts,
        logger: options.mtaSts?.logger || (() => false),
        cache: options.mtaSts?.cache || EMPTY_CACHE_HANDLER
    };

    const delivery = {
        domain: target,
        mx: (options.mx || []).map(normalizeMxEntry),

        dnsOptions: options.dnsOptions || {
            ignoreIPv6: false,
            preferIPv6: false,
            blockLocalAddresses: false,
            resolve: dns.resolve
        },

        port: options.port || 25,
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
