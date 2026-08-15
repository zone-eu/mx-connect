'use strict';

const getConnection = require('../../lib/get-connection');
const { startGreetingServer, closeServer, closeSocketAfterData } = require('../test-utils');

module.exports.realConnection = async test => {
    // A real socket, but against a listener of our own on a high port. What is under test
    // is this library's connection handling, and pointing it at someone else's MX made the
    // test depend on outbound port 25, which hosted CI runners block.
    const server = await startGreetingServer();
    const { port } = server.address();

    try {
        const delivery = await getConnection({
            domain: 'mx-connect.test',
            decodedDomain: 'mx-connect.test',
            port,
            mx: [{ exchange: 'mx-connect.test', priority: 10, A: ['127.0.0.1'], AAAA: [] }]
        });
        test.ok(delivery.socket);
        test.equal(delivery.host, '127.0.0.1');
        test.equal(delivery.port, port);
        test.equal(delivery.hostname, 'mx-connect.test');
        await new Promise(resolve => closeSocketAfterData(delivery.socket, resolve));
    } catch (err) {
        test.ifError(err);
    }

    await closeServer(server);
    test.done();
};

module.exports.fallbackConnection = async test => {
    // The first host does not answer, so delivery has to fall through to the second. All
    // hosts share the delivery port, so the two differ by address: 127.0.0.2 refuses
    // outright on Linux and goes unanswered on macOS, and maxConnectTime bounds both.
    const server = await startGreetingServer();
    const { port } = server.address();

    try {
        const delivery = await getConnection({
            domain: 'mx-connect.test',
            decodedDomain: 'mx-connect.test',
            port,
            maxConnectTime: 500,
            mx: [
                { exchange: 'dead.mx-connect.test', priority: 1, A: ['127.0.0.2'], AAAA: [] },
                { exchange: 'live.mx-connect.test', priority: 10, A: ['127.0.0.1'], AAAA: [] }
            ]
        });
        test.ok(delivery.socket);
        test.equal(delivery.host, '127.0.0.1', 'Delivery must fall through to the reachable host');
        test.equal(delivery.hostname, 'live.mx-connect.test');
        await new Promise(resolve => closeSocketAfterData(delivery.socket, resolve));
    } catch (err) {
        test.ifError(err);
    }

    await closeServer(server);
    test.done();
};

module.exports.allHostsUnreachable = async test => {
    // Every host failing must surface the first error rather than hanging or connecting
    try {
        await getConnection({
            domain: 'mx-connect.test',
            decodedDomain: 'mx-connect.test',
            port: 9,
            maxConnectTime: 500,
            mx: [{ exchange: 'dead.mx-connect.test', priority: 1, A: ['127.0.0.2'], AAAA: [] }]
        });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.ok(err);
        test.equal(err.category, 'network');
    }
    test.done();
};
