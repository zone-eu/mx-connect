/* eslint no-console: 0*/

'use strict';

const dns = require('dns');
const mxConnect = require('../lib/mx-connect');

module.exports.basic = test => {
    mxConnect('kreata.ee', (err, connection) => {
        test.ifError(err);
        test.ok(connection.socket);
        connection.socket.once('end', () => test.done());
        connection.socket.once('data', () => connection.socket.end());
    });
};

module.exports.address = test => {
    mxConnect('andris@kreata.ee', (err, connection) => {
        test.ifError(err);
        test.ok(connection.socket);
        connection.socket.once('end', () => test.done());
        connection.socket.once('data', () => connection.socket.end());
    });
};

module.exports.policyPass = test => {
    mxConnect(
        {
            target: 'andris@zone.ee',
            mtaSts: {
                enabled: true
            }
        },
        (err, connection) => {
            test.ifError(err);

            test.ok(connection.socket);

            test.equal(connection.policyMatch.valid, true);

            connection.socket.once('end', () => test.done());
            connection.socket.once('data', () => connection.socket.end());
        }
    );
};

module.exports.policyFail = test => {
    mxConnect(
        {
            target: 'andris@zone.ee',
            mtaSts: {
                enabled: true
            },
            mx: [
                {
                    exchange: 'aspmx.l.google.com',
                    priority: 10,
                    A: ['64.233.165.26'],
                    AAAA: []
                }
            ]
        },
        (err, connection) => {
            test.ifError(err);
            test.ok(connection.socket);

            test.equal(connection.policyMatch.valid, false);
            test.equal(connection.policyMatch.testing, true);

            connection.socket.once('end', () => test.done());
            connection.socket.once('data', () => connection.socket.end());
        }
    );
};

module.exports.policySkip = test => {
    mxConnect(
        {
            target: 'andris@zone.ee',
            mtaSts: {
                enabled: false
            },
            mx: [
                {
                    exchange: 'aspmx.l.google.com',
                    priority: 10,
                    A: ['64.233.165.26'],
                    AAAA: []
                }
            ]
        },
        (err, connection) => {
            test.ifError(err);
            test.ok(connection.socket);

            test.ok(!connection.policyMatch);

            connection.socket.once('end', () => test.done());
            connection.socket.once('data', () => connection.socket.end());
        }
    );
};
