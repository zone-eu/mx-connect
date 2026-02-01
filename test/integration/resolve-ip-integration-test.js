'use strict';

const net = require('net');
const resolveIp = require('../../lib/resolve-ip');

module.exports.realDnsLookup = test => {
    resolveIp({
        domain: 'kreata.ee',
        mx: [{ exchange: 'aspmx.l.google.com', priority: 10 }]
    })
        .then(delivery => {
            test.ok(net.isIPv4(delivery.mx[0].A[0]));
            test.ok(net.isIPv6(delivery.mx[0].AAAA[0]));
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};
