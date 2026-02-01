'use strict';

const EventEmitter = require('events');

/**
 * Creates a mock DNS resolver for unit testing.
 *
 * @param {Object} responses - Map of domain:type or domain keys to response objects
 *   Each response can have:
 *   - data: Array of results to return
 *   - error: Error object to return
 */
function createMockDnsResolver(responses) {
    return function (domain, typeOrCallback, maybeCallback) {
        const callback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback;
        const type = typeof typeOrCallback === 'string' ? typeOrCallback : 'A';
        const key = `${domain}:${type}`;
        const response = responses[key] || responses[domain];

        if (!response) {
            const err = new Error('ENOTFOUND');
            err.code = 'ENOTFOUND';
            return setImmediate(() => callback(err));
        }
        if (response.error) {
            return setImmediate(() => callback(response.error));
        }
        return setImmediate(() => callback(null, response.data));
    };
}

/**
 * Creates a DNS error with the specified code.
 */
function createDnsError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
}

/**
 * Creates a mock socket for testing connection handling.
 */
function createMockSocket(options = {}) {
    const socket = new EventEmitter();
    socket.localAddress = options.localAddress || '192.168.1.1';
    socket.localPort = options.localPort || 54321;
    socket.remoteAddress = options.remoteAddress || '64.233.163.26';
    socket.end = function () {
        this.emit('end');
    };
    socket.write = function () {};
    socket.destroy = function () {};
    return socket;
}

/**
 * Creates a connectHook that provides a mock socket.
 */
function createMockConnectHook(socketOptions = {}) {
    return function (delivery, options, callback) {
        options.socket = createMockSocket(socketOptions);
        return callback();
    };
}

/**
 * Creates a connectHook that simulates connection failure.
 */
function createFailingConnectHook(error) {
    return function (delivery, options, callback) {
        return callback(error);
    };
}

/**
 * Creates a connectHook that tracks connection attempts and provides mock sockets.
 * Returns an object with the hook function and an array to collect connection data.
 */
function createTrackingConnectHook() {
    const connections = [];
    function hook(delivery, options, callback) {
        connections.push({ host: options.host, port: options.port });
        options.socket = createMockSocket({ remoteAddress: options.host });
        return callback();
    }
    return { hook, connections };
}

/**
 * Closes a socket connection after receiving data and calls done when ended.
 * Use this pattern for integration tests with real sockets.
 */
function closeSocketAfterData(socket, done) {
    socket.once('end', done);
    socket.once('data', () => socket.end());
}

module.exports = {
    createMockDnsResolver,
    createDnsError,
    createMockSocket,
    createMockConnectHook,
    createFailingConnectHook,
    createTrackingConnectHook,
    closeSocketAfterData
};
