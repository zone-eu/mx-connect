'use strict';

const mxConnect = require('../../lib/mx-connect');
const { closeSocketAfterData } = require('../test-utils');

module.exports.basic = test => {
    mxConnect('kreata.ee', (err, connection) => {
        test.ifError(err);
        test.ok(connection.socket);
        closeSocketAfterData(connection.socket, () => test.done());
    });
};

module.exports.address = test => {
    mxConnect('andris@kreata.ee', (err, connection) => {
        test.ifError(err);
        test.ok(connection.socket);
        closeSocketAfterData(connection.socket, () => test.done());
    });
};

module.exports.policyPass = test => {
    mxConnect(
        {
            target: 'andris@zone.ee',
            mtaSts: { enabled: true }
        },
        (err, connection) => {
            test.ifError(err);
            test.ok(connection.socket);
            test.equal(connection.policyMatch.valid, true);
            closeSocketAfterData(connection.socket, () => test.done());
        }
    );
};

module.exports.policyFail = test => {
    mxConnect(
        {
            target: 'andris@zone.ee',
            mtaSts: { enabled: true },
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }]
        },
        (err, connection) => {
            test.ok(err);
            test.ok(!connection);
            test.equal(err.category, 'policy');
            test.done();
        }
    );
};

module.exports.policySkip = test => {
    mxConnect(
        {
            target: 'andris@zone.ee',
            mtaSts: { enabled: false },
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }]
        },
        (err, connection) => {
            test.ifError(err);
            test.ok(connection.socket);
            test.ok(!connection.policyMatch);
            closeSocketAfterData(connection.socket, () => test.done());
        }
    );
};
