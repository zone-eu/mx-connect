'use strict';

const resolveMx = require('../../lib/resolve-mx');

module.exports.realDnsLookup = test => {
    resolveMx({
        domain: 'kreata.ee',
        isIp: false,
        isPunycode: false,
        decodedDomain: 'kreata.ee'
    })
        .then(delivery => {
            test.ok(delivery.mx.length > 1);
            test.equal(delivery.mx[0].exchange, 'aspmx.l.google.com');
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};
