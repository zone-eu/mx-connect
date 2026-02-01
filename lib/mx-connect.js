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
    const resolver = delivery.dnsOptions && delivery.dnsOptions.resolve ? util.promisify(delivery.dnsOptions.resolve) : undefined;
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

    const entry = {
        exchange: mx && mx.exchange,
        priority: Number(mx && mx.priority) || 0,
        A: [],
        AAAA: [],
        mx: false
    };

    if (mx && mx.A) {
        entry.A = [].concat(mx.A);
    }
    if (mx && mx.AAAA) {
        entry.AAAA = [].concat(mx.AAAA);
    }

    return entry;
}

function extractDomain(target) {
    const str = (target || '').toString().trim();
    const atPos = str.indexOf('@');
    return atPos >= 0 ? str.substring(atPos + 1) : str;
}

function buildDeliveryObject(options) {
    const mtaStsOptions = options.mtaSts || {};
    const mtaSts = {
        enabled: mtaStsOptions.enabled || false,
        logger: mtaStsOptions.logger || (() => false),
        cache: mtaStsOptions.cache || EMPTY_CACHE_HANDLER
    };

    return {
        domain: extractDomain(options.target),
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
}

function buildPipeline(delivery) {
    const hasMx = delivery.mx.length > 0;
    const needsIpResolution = hasMx && delivery.mx.some(mx => mx.exchange && !mx.A.length && !mx.AAAA.length);

    const steps = [formatAddress, resolvePolicy];

    if (!hasMx) {
        steps.push(resolveMX);
    }

    steps.push(validateMxPolicy);

    if (!hasMx || needsIpResolution) {
        steps.push(resolveIP);
    }

    steps.push(getConnection);

    return steps;
}

module.exports = function mxConnect(options, callback) {
    const opts = typeof options === 'string' ? { target: options } : options || {};
    const delivery = buildDeliveryObject(opts);

    const pipeline = buildPipeline(delivery);
    const promise = pipeline.reduce((chain, fn) => chain.then(fn), Promise.resolve(delivery));

    if (typeof callback === 'function') {
        promise.then(result => callback(null, result)).catch(callback);
    }

    return promise;
};
