/* eslint no-console: 0*/

'use strict';

const tools = require('../lib/tools');

module.exports.isInvalid = test => {
    test.equal(
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '127.0.0.1'
        ),
        false
    );

    test.equal(
        tools.isInvalid(
            {
                dnsOptions: {
                    blockLocalAddresses: true
                }
            },
            '64.233.161.27'
        ),
        false
    );

    test.ok(
        // IP address in disallowed loopback range
        tools.isInvalid(
            {
                dnsOptions: {
                    blockLocalAddresses: true
                }
            },
            '127.0.0.1'
        )
    );

    test.ok(
        // IP address in disallowed unspecified range
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '0.0.0.0'
        )
    );

    test.ok(
        // IP address in disallowed broadcast range
        tools.isInvalid(
            {
                dnsOptions: {}
            },
            '255.255.255.255'
        )
    );

    test.done();
};
