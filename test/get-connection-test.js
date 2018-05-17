/* eslint no-console: 0*/

'use strict';

const getConnection = require('../lib/get-connection');

module.exports.basic = test => {
    getConnection({
        domain: 'kreata.ee',
        decodedDomain: 'kreata.ee',
        mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.165.26'], AAAA: [] }]
    })
        .then(delivery => {
            test.ok(delivery.socket);
            test.equal(delivery.host, '64.233.165.26');
            delivery.socket.once('end', () => test.done());
            delivery.socket.once('data', () => delivery.socket.end());
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.fallback = test => {
    getConnection({
        domain: 'kreata.ee',
        decodedDomain: 'kreata.ee',
        mx: [
            {
                exchange: 'randomaddress',
                priority: 1,
                A: ['999.999.999.999'],
                AAAA: []
            },
            {
                exchange: 'aspmx.l.google.com',
                priority: 10,
                A: ['64.233.165.26'],
                AAAA: []
            }
        ]
    })
        .then(delivery => {
            test.ok(delivery.socket);
            test.equal(delivery.host, '64.233.165.26');
            delivery.socket.once('end', () => test.done());
            delivery.socket.once('data', () => delivery.socket.end());
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};

module.exports.hook = test => {
    getConnection({
        domain: 'kreata.ee',
        decodedDomain: 'kreata.ee',
        mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.165.26'], AAAA: [] }],
        connectHook(delivery, options, callback) {
            // not a real socket, prevents from attemting a connection
            options.socket = {
                ok: true
            };
            return callback();
        }
    })
        .then(connection => {
            test.equal(connection.socket.ok, true);
            test.done();
        })
        .catch(err => {
            test.ifError(err);
            test.done();
        });
};
