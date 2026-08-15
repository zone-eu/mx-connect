'use strict';

const net = require('net');
const resolveIp = require('../../lib/resolve-ip');

module.exports.realDnsLookup = async test => {
    try {
        const delivery = await resolveIp({
            domain: 'kreata.ee',
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10 }]
        });
        test.ok(net.isIPv4(delivery.mx[0].A[0]));
        test.ok(net.isIPv6(delivery.mx[0].AAAA[0]));
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};
