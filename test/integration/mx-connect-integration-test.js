'use strict';

const mxConnect = require('../../lib/mx-connect');
const { createMockConnectHook, createTrackingConnectHook } = require('../test-utils');

// These drive the full pipeline against real DNS, and for the MTA-STS cases against a real
// policy fetch over HTTPS, which is what no unit test can cover. The connection itself is
// diverted through connectHook, so none of it needs outbound port 25; the socket layer is
// covered against a local listener in the unit suite.
//
// A failure here can also mean a published record changed rather than a code fault.

module.exports.basic = async test => {
    const { hook, connections } = createTrackingConnectHook();
    try {
        const connection = await mxConnect({ target: 'kreata.ee', connectHook: hook });
        test.ok(connection.socket);
        test.ok(connections.length > 0, 'A host must have been resolved and attempted');
        test.ok(connection.host, 'The connection must carry the resolved address');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.address = async test => {
    try {
        const connection = await mxConnect({ target: 'andris@kreata.ee', connectHook: createMockConnectHook() });
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
            connectHook: createMockConnectHook()
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
    const { hook, connections } = createTrackingConnectHook();
    try {
        await mxConnect({
            target: 'andris@zone.ee',
            mtaSts: { enabled: true },
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }],
            connectHook: hook
        });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.ok(err);
        test.equal(err.category, 'policy');
    }
    test.deepEqual(connections, [], 'No connection may be attempted for a host the policy rejects');
    test.done();
};

module.exports.policySkip = async test => {
    try {
        const connection = await mxConnect({
            target: 'andris@zone.ee',
            mtaSts: { enabled: false },
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }],
            connectHook: createMockConnectHook()
        });
        test.ok(connection.socket);
        test.ok(!connection.policyMatch);
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};
