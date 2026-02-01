'use strict';

/**
 * Memory leak investigation test.
 *
 * Run with: node --expose-gc test/memory-leak-test.js
 *
 * This script:
 * 1. Takes a baseline heap snapshot
 * 2. Runs many mxConnect operations
 * 3. Forces garbage collection
 * 4. Takes another snapshot
 * 5. Reports on potential memory leaks
 */

const v8 = require('v8');
const mxConnect = require('../../lib/mx-connect');

// Check if --expose-gc flag is present
if (typeof global.gc !== 'function') {
    console.error('ERROR: Run with --expose-gc flag:');
    console.error('  node --expose-gc test/memory-leak-test.js');
    process.exit(1);
}

// Mock socket that simulates a real socket
function createMockSocket(remoteAddress) {
    const EventEmitter = require('events');
    const socket = new EventEmitter();
    socket.remoteAddress = remoteAddress;
    socket.localAddress = '127.0.0.1';
    socket.localPort = 12345 + Math.floor(Math.random() * 50000);
    socket.destroyed = false;
    socket.end = function () {
        this.destroyed = true;
        this.emit('close');
    };
    socket.destroy = function () {
        this.destroyed = true;
        this.emit('close');
    };
    socket.write = function () {
        return true;
    };
    socket.pipe = function () {
        return this;
    };
    socket.setEncoding = function () {};
    socket.setTimeout = function () {};
    return socket;
}

// Mock DNS resolver
function createMockResolver() {
    return function mockResolve(domain, typeOrCallback, callback) {
        const cb = typeof typeOrCallback === 'function' ? typeOrCallback : callback;
        const type = typeof typeOrCallback === 'string' ? typeOrCallback : null;

        setImmediate(() => {
            if (type === 'MX') {
                cb(null, [
                    { exchange: 'mx1.example.com', priority: 10 },
                    { exchange: 'mx2.example.com', priority: 20 }
                ]);
            } else if (type === 'AAAA') {
                cb(null, ['2001:db8::1']);
            } else {
                cb(null, ['192.0.2.1', '192.0.2.2']);
            }
        });
    };
}

// Get memory stats
function getMemoryStats() {
    global.gc();
    const heapStats = v8.getHeapStatistics();
    const memUsage = process.memoryUsage();
    return {
        heapUsed: heapStats.used_heap_size,
        heapTotal: heapStats.total_heap_size,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers,
        rss: memUsage.rss
    };
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes < 1024) {
        return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(2) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Track active handles and requests
function getActiveHandles() {
    return {
        handles: process._getActiveHandles().length,
        requests: process._getActiveRequests().length
    };
}

async function runSingleOperation(operationIndex) {
    const mockSocket = createMockSocket('192.0.2.1');

    try {
        const connection = await mxConnect({
            target: `test${operationIndex}.example.com`,
            dnsOptions: {
                resolve: createMockResolver(),
                blockLocalAddresses: false
            },
            connectHook: (delivery, options, callback) => {
                options.socket = mockSocket;
                setImmediate(callback);
            }
        });

        // Simulate using the socket briefly then closing
        if (connection.socket && !connection.socket.destroyed) {
            connection.socket.end();
        }

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function runFailingOperation(operationIndex) {
    try {
        await mxConnect({
            target: `fail${operationIndex}.example.com`,
            dnsOptions: {
                resolve: (domain, typeOrCallback, callback) => {
                    const cb = typeof typeOrCallback === 'function' ? typeOrCallback : callback;
                    setImmediate(() => {
                        const err = new Error('SERVFAIL');
                        err.code = 'ESERVFAIL';
                        cb(err);
                    });
                }
            }
        });
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function runConnectionFailureOperation(operationIndex) {
    try {
        await mxConnect({
            target: `connfail${operationIndex}.example.com`,
            maxConnectTime: 100, // Short timeout
            dnsOptions: {
                resolve: createMockResolver(),
                blockLocalAddresses: false
            },
            connectHook: (delivery, options, callback) => {
                // Simulate connection failure after a delay
                setImmediate(() => {
                    callback(new Error('Connection refused'));
                });
            }
        });
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function main() {
    const ITERATIONS = 1000;
    const WARMUP_ITERATIONS = 100;

    console.log('Memory Leak Investigation Test');
    console.log('==============================\n');

    // Warmup phase - let V8 optimize
    console.log(`Warmup phase (${WARMUP_ITERATIONS} iterations)...`);
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        await runSingleOperation(i);
        await runFailingOperation(i);
    }

    // Force GC and get baseline
    global.gc();
    global.gc();
    await new Promise(resolve => setTimeout(resolve, 100));
    global.gc();

    const baselineMemory = getMemoryStats();
    const baselineHandles = getActiveHandles();

    console.log('\nBaseline Memory:');
    console.log(`  Heap Used: ${formatBytes(baselineMemory.heapUsed)}`);
    console.log(`  Heap Total: ${formatBytes(baselineMemory.heapTotal)}`);
    console.log(`  External: ${formatBytes(baselineMemory.external)}`);
    console.log(`  RSS: ${formatBytes(baselineMemory.rss)}`);
    console.log(`  Active Handles: ${baselineHandles.handles}`);
    console.log(`  Active Requests: ${baselineHandles.requests}`);

    // Test phase - successful operations
    console.log(`\nRunning ${ITERATIONS} successful operations...`);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ITERATIONS; i++) {
        const result = await runSingleOperation(i);
        if (result.success) {
            successCount++;
        } else {
            failCount++;
        }

        if ((i + 1) % 200 === 0) {
            process.stdout.write(`  Progress: ${i + 1}/${ITERATIONS}\r`);
        }
    }
    console.log(`  Completed: ${successCount} success, ${failCount} failed`);

    // Test phase - failing operations (DNS errors)
    console.log(`\nRunning ${ITERATIONS} failing operations (DNS errors)...`);
    successCount = 0;
    failCount = 0;

    for (let i = 0; i < ITERATIONS; i++) {
        const result = await runFailingOperation(i);
        if (result.success) {
            successCount++;
        } else {
            failCount++;
        }

        if ((i + 1) % 200 === 0) {
            process.stdout.write(`  Progress: ${i + 1}/${ITERATIONS}\r`);
        }
    }
    console.log(`  Completed: ${successCount} success, ${failCount} failed (expected)`);

    // Test phase - connection failures
    console.log(`\nRunning ${ITERATIONS} connection failure operations...`);
    successCount = 0;
    failCount = 0;

    for (let i = 0; i < ITERATIONS; i++) {
        const result = await runConnectionFailureOperation(i);
        if (result.success) {
            successCount++;
        } else {
            failCount++;
        }

        if ((i + 1) % 200 === 0) {
            process.stdout.write(`  Progress: ${i + 1}/${ITERATIONS}\r`);
        }
    }
    console.log(`  Completed: ${successCount} success, ${failCount} failed (expected)`);

    // Force GC and measure
    console.log('\nForcing garbage collection...');
    global.gc();
    global.gc();
    await new Promise(resolve => setTimeout(resolve, 500));
    global.gc();

    const finalMemory = getMemoryStats();
    const finalHandles = getActiveHandles();

    console.log('\nFinal Memory:');
    console.log(`  Heap Used: ${formatBytes(finalMemory.heapUsed)}`);
    console.log(`  Heap Total: ${formatBytes(finalMemory.heapTotal)}`);
    console.log(`  External: ${formatBytes(finalMemory.external)}`);
    console.log(`  RSS: ${formatBytes(finalMemory.rss)}`);
    console.log(`  Active Handles: ${finalHandles.handles}`);
    console.log(`  Active Requests: ${finalHandles.requests}`);

    // Calculate differences
    const heapDiff = finalMemory.heapUsed - baselineMemory.heapUsed;
    const handleDiff = finalHandles.handles - baselineHandles.handles;
    const requestDiff = finalHandles.requests - baselineHandles.requests;

    console.log('\n==============================');
    console.log('Analysis:');
    console.log(`  Heap Change: ${heapDiff >= 0 ? '+' : ''}${formatBytes(heapDiff)}`);
    console.log(`  Handle Change: ${handleDiff >= 0 ? '+' : ''}${handleDiff}`);
    console.log(`  Request Change: ${requestDiff >= 0 ? '+' : ''}${requestDiff}`);

    // Memory leak threshold: if heap grew more than 1MB per 1000 ops, likely a leak
    const perOpGrowth = heapDiff / (ITERATIONS * 3);
    console.log(`  Per-operation heap growth: ${formatBytes(perOpGrowth)}`);

    if (heapDiff > 5 * 1024 * 1024) {
        // More than 5MB growth
        console.log('\n WARNING: Significant memory growth detected!');
        console.log('  This may indicate a memory leak.');
    } else if (heapDiff > 1 * 1024 * 1024) {
        // More than 1MB growth
        console.log('\n NOTICE: Moderate memory growth detected.');
        console.log('  May be normal for this number of operations.');
    } else {
        console.log('\n OK: Memory usage appears stable.');
    }

    if (handleDiff > 0) {
        console.log(`\n WARNING: ${handleDiff} handles were not cleaned up!`);
        console.log(
            '  Active handles:',
            process._getActiveHandles().map(h => h.constructor.name)
        );
    }

    if (requestDiff > 0) {
        console.log(`\n WARNING: ${requestDiff} requests were not cleaned up!`);
    }

    // Give time for any pending operations
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log('\nTest completed.');
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
