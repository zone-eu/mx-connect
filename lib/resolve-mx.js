'use strict';

const dns = require('dns');
const net = require('net');
const dnsErrors = require('./dns-errors');
const tools = require('./tools');

async function resolveMX(delivery) {
    return new Promise((resolve, reject) => {
        let firstError = false;
        let addressFound = false;
        let dnsOptions = delivery.dnsOptions || {
            ignoreIPv6: false,
            resolve: dns.resolve
        };

        let filterAddress = ip => {
            let invalid = tools.isInvalid(delivery, ip);
            if (invalid) {
                if (!firstError) {
                    firstError = new Error(
                        `Unable to deliver email to the IP address [${ip}] resolved for the Mail Exchange (MX) server of "${delivery.domain}"${
                            typeof invalid === 'string' ? `. ${invalid}` : ''
                        }`
                    );
                    firstError.response = `DNS Error: ${firstError.message}`;
                    firstError.category = 'dns';
                }
            } else {
                addressFound = true;
            }
            return !invalid;
        };

        // Do not try to resolve the domain name if it is an IP address
        if (delivery.isIp) {
            if (!filterAddress(delivery.decodedDomain) && firstError) {
                return reject(firstError);
            }

            delivery.mx = [
                {
                    priority: 0,
                    exchange: delivery.decodedDomain,
                    A: net.isIPv4(delivery.decodedDomain) ? [delivery.decodedDomain] : [],
                    AAAA: net.isIPv6(delivery.decodedDomain) && !dnsOptions.ignoreIPv6 ? [delivery.decodedDomain] : []
                }
            ];
            return resolve(delivery);
        }

        let domain = delivery.decodedDomain;
        const dnsResolve = dnsOptions.resolve || dns.resolve;

        dnsResolve(domain, 'MX', (err, list) => {
            if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
                err.message = `DNS error occurred while resolving the Mail Exchange (MX) server for the specified domain (${domain}). ${
                    dnsErrors[err.code] || err.message
                }`;
                err.response = `DNS Error: ${err.message}`;
                err.temporary = true; // this might be a temporary issue with DNS
                err.category = 'dns';
                return reject(err);
            }

            if (!list || !list.length) {
                // fallback to A
                return dnsResolve(domain, (err, list) => {
                    if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
                        err.message = `DNS error occurred while resolving the Mail Exchange (MX) server for the specified domain (${domain}). ${
                            dnsErrors[err.code] || err.message
                        }`;
                        err.response = `DNS Error: ${err.message}`;
                        err.temporary = true; // this might be a temporary issue with DNS
                        err.category = 'dns';
                        return reject(err);
                    }

                    if (!list || (!list.length && !dnsOptions.ignoreIPv6)) {
                        // fallback to AAAA
                        return dnsResolve(domain, 'AAAA', (err, list) => {
                            if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
                                err.message = `DNS error occurred while resolving the Mail Exchange (MX) server for the specified domain (${domain}). ${
                                    dnsErrors[err.code] || err.message
                                }`;
                                err.response = `DNS Error: ${err.message}`;
                                err.temporary = true; // this might be a temporary issue with DNS
                                err.category = 'dns';
                                return reject(err);
                            }

                            if (!list || !list.length) {
                                // nothing found!
                                err = err || new Error('No MX server found');
                                err.message = `DNS error occurred while resolving the Mail Exchange (MX) server for the specified domain (${domain}). ${
                                    dnsErrors[err.code] || err.message
                                }`;
                                err.response = `DNS Error: ${err.message}`;
                                err.code = err.code || 'ENOTFOUND';
                                err.category = 'dns';
                                return reject(err);
                            }

                            delivery.mx = [].concat(list || []).map(entry => ({
                                priority: 0,
                                exchange: domain,
                                mx: false,
                                A: [],
                                AAAA: [entry].filter(filterAddress)
                            }));
                            if (!addressFound && firstError) {
                                return reject(firstError);
                            }
                            return resolve(delivery);
                        });
                    }

                    delivery.mx = [].concat(list || []).map(entry => ({
                        priority: 0,
                        exchange: domain,
                        mx: false,
                        A: [entry].filter(filterAddress),
                        AAAA: []
                    }));
                    if (!addressFound && firstError) {
                        return reject(firstError);
                    }
                    return resolve(delivery);
                });
            }

            delivery.mx = []
                .concat(list || [])
                .sort((a, b) => a.priority - b.priority)
                .map(entry => {
                    entry.mx = true;
                    entry.A = [];
                    entry.AAAA = [];
                    return entry;
                });
            return resolve(delivery);
        });
    });
}

module.exports = resolveMX;
