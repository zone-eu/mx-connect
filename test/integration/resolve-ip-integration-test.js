'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const net = require('net');
const resolveIp = require('../../lib/resolve-ip');

test('realDnsLookup', async () => {
    try {
        const delivery = await resolveIp({
            domain: 'kreata.ee',
            mx: [{ exchange: 'aspmx.l.google.com', priority: 10 }]
        });
        assert.ok(net.isIPv4(delivery.mx[0].A[0]));
        assert.ok(net.isIPv6(delivery.mx[0].AAAA[0]));
    } catch (err) {
        assert.ifError(err);
    }
});
