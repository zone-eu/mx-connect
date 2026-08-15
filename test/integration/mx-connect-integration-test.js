'use strict';

const mxConnect = require('../../lib/mx-connect');
const { startGreetingServer, closeServer, createMockSocket, closeSocketAfterData } = require('../test-utils');

// These exercise the full pipeline against real DNS, and for the MTA-STS cases against a
// real policy fetch over HTTPS. The connection itself is diverted through connectHook, so
// nothing here needs outbound port 25: what is worth testing against the network is
// resolution and policy handling, and the socket layer is covered against a local listener
// in get-connection-integration-test.js and end to end below.
const divert = attempts => (delivery, options, callback) => {
    attempts.push({ host: options.host, hostname: options.hostname });
    options.socket = createMockSocket({ remoteAddress: options.host });
    return callback();
};

module.exports.basic = async test => {
    const attempts = [];
    try {
        const connection = await mxConnect({ target: 'kreata.ee', connectHook: divert(attempts) });
        test.ok(connection.socket);
        test.ok(attempts.length > 0, 'A host must have been resolved and attempted');
        test.ok(connection.host, 'The connection must carry the resolved address');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.address = async test => {
    const attempts = [];
    try {
        const connection = await mxConnect({ target: 'andris@kreata.ee', connectHook: divert(attempts) });
        test.ok(connection.socket);
        test.ok(connection.host);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.policyPass = async test => {
    // Real TXT lookup and real HTTPS policy fetch for a domain publishing MTA-STS
    try {
        const connection = await mxConnect({
            target: 'andris@zone.ee',
            mtaSts: { enabled: true },
            connectHook: divert([])
        });
        test.ok(connection.socket);
        test.equal(connection.policyMatch.valid, true);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.policyFail = async test => {
    // A host outside the published policy must be refused before any connection
    const attempts = [];
    try {
        await mxConnect({
            target: 'andris@zone.ee',
            mtaSts: { enabled: true },
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }],
            connectHook: divert(attempts)
        });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.ok(err);
        test.equal(err.category, 'policy');
    }
    test.deepEqual(attempts, [], 'No connection may be attempted for a host the policy rejects');
    test.done();
};

module.exports.policySkip = async test => {
    try {
        const connection = await mxConnect({
            target: 'andris@zone.ee',
            mtaSts: { enabled: false },
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }],
            connectHook: divert([])
        });
        test.ok(connection.socket);
        test.ok(!connection.policyMatch);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.endToEndOverRealSocket = async test => {
    // The whole public API against a real socket, with no network beyond loopback
    const server = await startGreetingServer();
    const { port } = server.address();

    try {
        const connection = await mxConnect({ target: 'mx-connect.test', mx: ['127.0.0.1'], port });
        test.ok(connection.socket);
        test.equal(connection.host, '127.0.0.1');
        test.equal(connection.port, port);
        await new Promise(resolve => closeSocketAfterData(connection.socket, resolve));
    } catch (err) {
        test.ifError(err);
    }

    await closeServer(server);
    test.done();
};
