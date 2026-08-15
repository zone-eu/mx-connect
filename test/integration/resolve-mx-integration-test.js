'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const resolveMx = require('../../lib/resolve-mx');

test('realDnsLookup', async () => {
    try {
        const delivery = await resolveMx({
            domain: 'kreata.ee',
            isIp: false,
            isPunycode: false,
            decodedDomain: 'kreata.ee'
        });
        assert.ok(delivery.mx.length > 1);
        assert.strictEqual(delivery.mx[0].exchange, 'aspmx.l.google.com');
    } catch (err) {
        assert.ifError(err);
    }
});
