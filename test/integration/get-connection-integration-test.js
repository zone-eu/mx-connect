'use strict';

const getConnection = require('../../lib/get-connection');
const { closeSocketAfterData } = require('../test-utils');

module.exports.realConnection = test => {
    getConnection({
        domain: 'kreata.ee',
        decodedDomain: 'kreata.ee',
        mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }]
    })
        .then(delivery => {
            test.ok(delivery.socket);
            test.equal(delivery.host, '64.233.163.26');
            closeSocketAfterData(delivery.socket, () => test.done());
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.fallbackConnection = test => {
    getConnection({
        domain: 'kreata.ee',
        decodedDomain: 'kreata.ee',
        mx: [
            { exchange: 'randomaddress', priority: 1, A: ['999.999.999.999'], AAAA: [] },
            { exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }
        ]
    })
        .then(delivery => {
            test.ok(delivery.socket);
            test.equal(delivery.host, '64.233.163.26');
            closeSocketAfterData(delivery.socket, () => test.done());
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};
