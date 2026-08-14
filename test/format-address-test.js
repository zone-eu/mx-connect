'use strict';

const formatAddress = require('../lib/format-address');

module.exports.basic = async test => {
    try {
        const delivery = await formatAddress({ domain: 'kreata.ee' });
        test.equal(delivery.isIp, false);
        test.equal(delivery.isPunycode, false);
        test.equal(delivery.decodedDomain, 'kreata.ee');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.unicode = async test => {
    try {
        const delivery = await formatAddress({ domain: 'jõgeva.ee' });
        test.equal(delivery.isIp, false);
        test.equal(delivery.isPunycode, true);
        test.equal(delivery.decodedDomain, 'xn--jgeva-dua.ee');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.ipv4 = async test => {
    try {
        const delivery = await formatAddress({ domain: '127.0.0.1' });
        test.equal(delivery.isIp, true);
        test.equal(delivery.isPunycode, false);
        test.equal(delivery.decodedDomain, '127.0.0.1');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.ipv6 = async test => {
    try {
        const delivery = await formatAddress({ domain: '2001:db8:1ff::a0b:dbd0' });
        test.equal(delivery.isIp, true);
        test.equal(delivery.isPunycode, false);
        test.equal(delivery.decodedDomain, '2001:db8:1ff::a0b:dbd0');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.ipv6Literal = async test => {
    try {
        const delivery = await formatAddress({ domain: '[IPv6:2001:db8:1ff::a0b:dbd0]' });
        test.equal(delivery.isIp, true);
        test.equal(delivery.isPunycode, false);
        test.equal(delivery.decodedDomain, '2001:db8:1ff::a0b:dbd0');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.ipv6LiteralParsedRegardlessOfIgnoreIPv6 = async test => {
    // Parsing the target and deciding whether its address may be used are separate jobs.
    // Refusing here too rejected deliveries whose target was never going to be the
    // destination, such as an IPv6 target with the mx option supplying the real host, so
    // ignoreIPv6 is left to tools.isInvalid, which every address reaches.
    try {
        const delivery = await formatAddress({
            domain: '[IPv6:2001:db8:1ff::a0b:dbd0]',
            dnsOptions: {
                ignoreIPv6: true
            }
        });
        test.equal(delivery.isIp, true);
        test.equal(delivery.decodedDomain, '2001:db8:1ff::a0b:dbd0');
    } catch (err) {
        test.ifError(err);
    }
    test.done();
};

module.exports.invalidIpLiteral = async test => {
    try {
        await formatAddress({ domain: '[not-an-ip]' });
        test.ok(false, 'Should have rejected');
    } catch (err) {
        test.equal(err.category, 'dns');
        test.ok(err.message.includes('properly formatted IP address'));
    }
    test.done();
};
