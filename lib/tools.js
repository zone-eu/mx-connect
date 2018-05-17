'use strict';

const os = require('os');
const ipaddr = require('ipaddr.js');

const localAddresses = returnLocalAddresses(os.networkInterfaces());

function returnLocalAddresses(interfaces) {
    let addresses = new Set();

    addresses.add('0.0.0.0');

    Object.keys(interfaces || {}).forEach(key => {
        let iface = interfaces[key];
        if (!iface) {
            return;
        }
        [].concat(iface || []).forEach(addr => {
            if (addr && addr.address) {
                addresses.add(addr.address);
            }
        });
    });

    return addresses;
}

module.exports.isLocal = address => localAddresses.has(address);

module.exports.isInvalid = (delivery, ip) => {
    let range = ipaddr.parse(ip).range();
    let dnsOptions = delivery.dnsOptions || {};

    if (dnsOptions.blockLocalAddresses) {
        // check if exchange resolves to local IP range
        if (['loopback', 'private'].includes(range)) {
            return 'IP address in disallowed ' + range + ' range';
        }

        // check if exchange resolves to local interface
        if (module.exports.isLocal(ip)) {
            return 'IP address in local interface';
        }
    }

    // check if exchange resolves to invalid IP range
    if (['unspecified', 'broadcast'].includes(range)) {
        return 'IP address in disallowed ' + range + ' range';
    }

    return false;
};
