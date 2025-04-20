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
    let range;
    try {
        range = ipaddr.parse(ip).range();
    } catch (err) {
        return `Failed parsing IP address range.`;
    }
    let dnsOptions = delivery.dnsOptions || {};

    if (dnsOptions.blockLocalAddresses) {
        // check if exchange resolves to local IP range
        if (['loopback', 'private'].includes(range)) {
            return `This IP address falls within the prohibited "${range}" address range, which is not valid for external communication.`;
        }

        // check if exchange resolves to local interface
        if (module.exports.isLocal(ip)) {
            return `The resolved IP address corresponds to a local interface.`;
        }
    }

    // check if exchange resolves to invalid IP range
    if (['unspecified', 'broadcast'].includes(range)) {
        return `The IP address is within the disallowed "${range}" address range, which is not permitted for direct communication.`;
    }

    return false;
};
