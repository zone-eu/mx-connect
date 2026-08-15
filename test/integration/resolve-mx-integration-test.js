'use strict';

const resolveMx = require('../../lib/resolve-mx');

module.exports.realDnsLookup = async test => {
    try {
        const delivery = await resolveMx({
            domain: 'kreata.ee',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'kreata.ee'
        });
        test.ok(delivery.mx.length > 1);
        test.equal(delivery.mx[0].exchange, 'aspmx.l.google.com');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};
