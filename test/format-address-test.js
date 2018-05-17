/* eslint no-console: 0*/

'use strict';

const formatAddress = require('../lib/format-address');

module.exports.basic = test => {
    formatAddress({ domain: 'kreata.ee' })
        .then(delivery => {
            test.equal(delivery.isIp, false);
            test.equal(delivery.isPunycode, false);
            test.equal(delivery.decodedDomain, 'kreata.ee');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.unicode = test => {
    formatAddress({ domain: 'jõgeva.ee' })
        .then(delivery => {
            test.equal(delivery.isIp, false);
            test.equal(delivery.isPunycode, true);
            test.equal(delivery.decodedDomain, 'xn--jgeva-dua.ee');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.ipv4 = test => {
    formatAddress({ domain: '127.0.0.1' })
        .then(delivery => {
            test.equal(delivery.isIp, true);
            test.equal(delivery.isPunycode, false);
            test.equal(delivery.decodedDomain, '127.0.0.1');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.ipv6 = test => {
    formatAddress({ domain: '2001:db8:1ff::a0b:dbd0' })
        .then(delivery => {
            test.equal(delivery.isIp, true);
            test.equal(delivery.isPunycode, false);
            test.equal(delivery.decodedDomain, '2001:db8:1ff::a0b:dbd0');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.ipv6Literal = test => {
    formatAddress({ domain: '[IPv6:2001:db8:1ff::a0b:dbd0]' })
        .then(delivery => {
            test.equal(delivery.isIp, true);
            test.equal(delivery.isPunycode, false);
            test.equal(delivery.decodedDomain, '2001:db8:1ff::a0b:dbd0');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.rejectIpv6Literal = test => {
    formatAddress({
        domain: '[IPv6:2001:db8:1ff::a0b:dbd0]',
        dnsOptions: {
            ignoreIPv6: true
        }
    })
        .then(delivery => {
            test.ok(!delivery);
            test.done();
        })
        .catch(err => {
            test.equal(err.category, 'dns');
            test.done();
        });
};
