'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const mxConnect = require('../../lib/mx-connect');
const { createMockConnectHook, createTrackingConnectHook } = require('../test-utils');

// These drive the full pipeline against real DNS, and for the MTA-STS cases against a real
// policy fetch over HTTPS, which is what no unit test can cover. The connection itself is
// diverted through connectHook, so none of it needs outbound port 25; the socket layer is
// covered against a local listener in the unit suite.
//
// A failure here can also mean a published record changed rather than a code fault.

test('basic', async () => {
    const { hook, connections } = createTrackingConnectHook();
    try {
        const connection = await mxConnect({ target: 'kreata.ee', connectHook: hook });
        assert.ok(connection.socket);
        assert.ok(connections.length > 0, 'A host must have been resolved and attempted');
        assert.ok(connection.host, 'The connection must carry the resolved address');
    } catch (err) {
        assert.ifError(err);
    }
});

test('address', async () => {
    try {
        const connection = await mxConnect({ target: 'andris@kreata.ee', connectHook: createMockConnectHook() });
        assert.ok(connection.socket);
        assert.ok(connection.host);
    } catch (err) {
        assert.ifError(err);
    }
});

test('policyPass', async () => {
    // Real TXT lookup and real HTTPS policy fetch for a domain publishing MTA-STS
    try {
        const connection = await mxConnect({
            target: 'andris@zone.ee',
            mtaSts: { enabled: true },
            connectHook: createMockConnectHook()
        });
        assert.ok(connection.socket);
        assert.strictEqual(connection.policyMatch.valid, true);
    } catch (err) {
        assert.ifError(err);
    }
});

test('policyFail', async () => {
    // A host outside the published policy must be refused before any connection
    const { hook, connections } = createTrackingConnectHook();
    try {
        await mxConnect({
            target: 'andris@zone.ee',
            mtaSts: { enabled: true },
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }],
            connectHook: hook
        });
        assert.ok(false, 'Should have rejected');
    } catch (err) {
        assert.ok(err);
        assert.strictEqual(err.category, 'policy');
    }
    assert.deepStrictEqual(connections, [], 'No connection may be attempted for a host the policy rejects');
});

test('policySkip', async () => {
    try {
        const connection = await mxConnect({
            target: 'andris@zone.ee',
            mtaSts: { enabled: false },
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10, A: ['64.233.163.26'], AAAA: [] }],
            connectHook: createMockConnectHook()
        });
        assert.ok(connection.socket);
        assert.ok(!connection.policyMatch);
    } catch (err) {
        assert.ifError(err);
    }
});
