'use strict';

const EventEmitter = require('events');
const net = require('net');

/**
 * Starts a TCP server on a random loopback port for real-socket tests.
 * Incoming sockets are destroyed immediately so closeServer() never hangs.
 */
function startServer(onConnection = socket => socket.destroy()) {
    return new Promise(resolve => {
        const server = net.createServer(onConnection);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

/**
 * Starts a TCP server on a random loopback port that greets each connection the way an
 * SMTP server would, so a test can watch data actually arrive on the socket.
 *
 * This is what tests connect to instead of dialling someone else's mail server on port 25:
 * what they exercise is this library's connection handling, not the internet, and a real MX
 * makes them depend on a port that hosted CI runners block outright.
 */
function startGreetingServer() {
    return startServer(socket => {
        // The client hangs up as soon as it has read the greeting, so a write or reset
        // racing that is expected rather than a failure
        socket.on('error', () => false);
        socket.write('220 mx-connect.test ESMTP ready\r\n');
    });
}

function closeServer(server) {
    return new Promise(resolve => server.close(resolve));
}

/**
 * Returns a loopback port number with no listener on it.
 */
async function getFreePort() {
    const server = await startServer();
    const port = server.address().port;
    await closeServer(server);
    return port;
}

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
 * Creates a mock DNS resolver that also records how it was called.
 *
 * Returns { resolver, calls }, where each call is { domain, type, args }. `args` is the
 * argument count the resolver was invoked with, which is what tests asserting the
 * two-versus-three-argument contract need.
 *
 * @param {Object} responses - Same shape as createMockDnsResolver
 */
function createTrackingDnsResolver(responses) {
    const mockResolver = createMockDnsResolver(responses);
    const calls = [];

    const resolver = function (domain, typeOrCallback, maybeCallback) {
        const twoArgForm = typeof typeOrCallback === 'function';
        calls.push({ domain, type: twoArgForm ? 'A' : typeOrCallback, args: twoArgForm ? 2 : 3 });
        return mockResolver(domain, typeOrCallback, maybeCallback);
    };

    return { resolver, calls };
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
    socket.write = () => true;
    socket.end = function () {
        this.emit('end');
    };
    socket.destroy = function () {
        this.emit('close');
    };
    socket.pipe = function () {
        return this;
    };
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
 * Creates a connectHook that fails every connection attempt with the given error.
 * Returns the hook function and an array collecting the attempted targets,
 * mirroring the shape of createTrackingConnectHook.
 */
function createFailingConnectHook(error) {
    const attempts = [];
    function hook(delivery, options, callback) {
        attempts.push({ host: options.host, port: options.port });
        return callback(error);
    }
    return { hook, attempts };
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
    startServer,
    startGreetingServer,
    closeServer,
    getFreePort,
    createMockDnsResolver,
    createTrackingDnsResolver,
    createDnsError,
    createMockSocket,
    createMockConnectHook,
    createFailingConnectHook,
    createTrackingConnectHook,
    closeSocketAfterData
};
