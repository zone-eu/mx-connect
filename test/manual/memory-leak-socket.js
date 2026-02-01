'use strict';

/**
 * Socket-specific memory leak test.
 *
 * Tests actual socket creation, timeout handling, and cleanup.
 * Run with: node --expose-gc test/memory-leak-socket-test.js
 */

const v8 = require('v8');
const net = require('net');

// Import the internal module directly to test socket handling
const getConnectionModule = require('../../lib/get-connection');

if (typeof global.gc !== 'function') {
    console.error('ERROR: Run with --expose-gc flag:');
    console.error('  node --expose-gc test/memory-leak-socket-test.js');
    process.exit(1);
}

function getMemoryStats() {
    global.gc();
    const heapStats = v8.getHeapStatistics();
    return {
        heapUsed: heapStats.used_heap_size,
        external: process.memoryUsage().external
    };
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(2) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Create a test server that accepts and immediately closes connections
function createTestServer() {
    return new Promise(resolve => {
        const server = net.createServer(socket => {
            // Immediately close the connection
            socket.end();
        });
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({ server, port });
        });
    });
}

// Create a test server that never responds (for timeout testing)
// Tracks connected sockets for cleanup
function createBlackHoleServer() {
    return new Promise(resolve => {
        const connectedSockets = [];
        const server = net.createServer(socket => {
            // Track sockets for cleanup
            connectedSockets.push(socket);
            // Never respond, just hold the connection
        });
        server.connectedSockets = connectedSockets;
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({ server, port });
        });
    });
}

// Test 1: Successful connections with immediate close
async function testSuccessfulConnections(port, iterations) {
    console.log(`\nTest 1: ${iterations} successful connections (server closes immediately)`);

    const baseline = getMemoryStats();
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < iterations; i++) {
        try {
            const result = await getConnectionModule({
                domain: 'test.local',
                mx: [
                    {
                        exchange: 'localhost',
                        priority: 0,
                        A: ['127.0.0.1'],
                        AAAA: []
                    }
                ],
                port,
                maxConnectTime: 5000
            });

            if (result.socket) {
                // The server already closed it, but ensure cleanup
                if (!result.socket.destroyed) {
                    result.socket.destroy();
                }
            }
            successCount++;
        } catch {
            errorCount++;
        }

        if ((i + 1) % 100 === 0) {
            process.stdout.write(`  Progress: ${i + 1}/${iterations}\r`);
        }
    }

    global.gc();
    global.gc();
    await new Promise(r => setTimeout(r, 100));
    global.gc();

    const final = getMemoryStats();
    const heapDiff = final.heapUsed - baseline.heapUsed;

    console.log(`  Success: ${successCount}, Errors: ${errorCount}`);
    console.log(`  Heap change: ${heapDiff >= 0 ? '+' : ''}${formatBytes(heapDiff)}`);
    console.log(`  Per-connection: ${formatBytes(heapDiff / iterations)}`);

    return { heapDiff, perOp: heapDiff / iterations };
}

// Test 2: Connection refused scenarios
async function testConnectionRefused(iterations) {
    console.log(`\nTest 2: ${iterations} connection refused errors`);

    const baseline = getMemoryStats();
    let errorCount = 0;

    for (let i = 0; i < iterations; i++) {
        try {
            await getConnectionModule({
                domain: 'test.local',
                mx: [
                    {
                        exchange: 'localhost',
                        priority: 0,
                        A: ['127.0.0.1'],
                        AAAA: []
                    }
                ],
                port: 59999, // Port that should be closed
                maxConnectTime: 1000
            });
        } catch {
            errorCount++;
        }

        if ((i + 1) % 100 === 0) {
            process.stdout.write(`  Progress: ${i + 1}/${iterations}\r`);
        }
    }

    global.gc();
    global.gc();
    await new Promise(r => setTimeout(r, 100));
    global.gc();

    const final = getMemoryStats();
    const heapDiff = final.heapUsed - baseline.heapUsed;

    console.log(`  Errors (expected): ${errorCount}`);
    console.log(`  Heap change: ${heapDiff >= 0 ? '+' : ''}${formatBytes(heapDiff)}`);
    console.log(`  Per-connection: ${formatBytes(heapDiff / iterations)}`);

    return { heapDiff, perOp: heapDiff / iterations };
}

// Test 3: Connection timeout scenarios
async function testConnectionTimeout(port, iterations) {
    console.log(`\nTest 3: ${iterations} connection timeouts`);

    const baseline = getMemoryStats();
    let errorCount = 0;
    let successCount = 0;

    for (let i = 0; i < iterations; i++) {
        try {
            const result = await getConnectionModule({
                domain: 'test.local',
                mx: [
                    {
                        exchange: 'localhost',
                        priority: 0,
                        A: ['127.0.0.1'],
                        AAAA: []
                    }
                ],
                port,
                maxConnectTime: 50 // Very short timeout
            });
            // If connection succeeds (server accepts fast), destroy the socket
            if (result.socket && !result.socket.destroyed) {
                result.socket.destroy();
            }
            successCount++;
        } catch {
            errorCount++;
        }

        if ((i + 1) % 50 === 0) {
            process.stdout.write(`  Progress: ${i + 1}/${iterations}\r`);
        }
    }

    global.gc();
    global.gc();
    await new Promise(r => setTimeout(r, 500));
    global.gc();

    const final = getMemoryStats();
    const heapDiff = final.heapUsed - baseline.heapUsed;

    console.log(`  Success: ${successCount}, Timeouts: ${errorCount}`);
    console.log(`  Heap change: ${heapDiff >= 0 ? '+' : ''}${formatBytes(heapDiff)}`);
    console.log(`  Per-connection: ${formatBytes(heapDiff / iterations)}`);

    return { heapDiff, perOp: heapDiff / iterations };
}

// Test 4: Multiple MX fallback with failures
async function testMxFallback(successPort, iterations) {
    console.log(`\nTest 4: ${iterations} MX fallback scenarios (2 failures then success)`);

    const baseline = getMemoryStats();
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < iterations; i++) {
        try {
            const result = await getConnectionModule({
                domain: 'test.local',
                mx: [
                    { exchange: 'fail1.local', priority: 10, A: ['127.0.0.1'], AAAA: [] },
                    { exchange: 'fail2.local', priority: 20, A: ['127.0.0.1'], AAAA: [] },
                    { exchange: 'success.local', priority: 30, A: ['127.0.0.1'], AAAA: [] }
                ],
                port: successPort,
                maxConnectTime: 5000,
                connectError: () => {} // Suppress error logging
            });

            if (result.socket && !result.socket.destroyed) {
                result.socket.destroy();
            }
            successCount++;
        } catch {
            errorCount++;
        }

        if ((i + 1) % 100 === 0) {
            process.stdout.write(`  Progress: ${i + 1}/${iterations}\r`);
        }
    }

    global.gc();
    global.gc();
    await new Promise(r => setTimeout(r, 100));
    global.gc();

    const final = getMemoryStats();
    const heapDiff = final.heapUsed - baseline.heapUsed;

    console.log(`  Success: ${successCount}, Errors: ${errorCount}`);
    console.log(`  Heap change: ${heapDiff >= 0 ? '+' : ''}${formatBytes(heapDiff)}`);
    console.log(`  Per-operation: ${formatBytes(heapDiff / iterations)}`);

    return { heapDiff, perOp: heapDiff / iterations };
}

async function main() {
    console.log('Socket Memory Leak Test');
    console.log('=======================\n');

    // Create test servers
    console.log('Setting up test servers...');
    const { server: normalServer, port: normalPort } = await createTestServer();
    const { server: blackHoleServer, port: blackHolePort } = await createBlackHoleServer();
    console.log(`  Normal server on port ${normalPort}`);
    console.log(`  Black hole server on port ${blackHolePort}`);

    // Warmup
    console.log('\nWarmup phase...');
    for (let i = 0; i < 50; i++) {
        try {
            const result = await getConnectionModule({
                domain: 'warmup.local',
                mx: [{ exchange: 'localhost', priority: 0, A: ['127.0.0.1'], AAAA: [] }],
                port: normalPort,
                maxConnectTime: 5000
            });
            if (result.socket && !result.socket.destroyed) {
                result.socket.destroy();
            }
        } catch {
            // Ignore warmup errors
        }
    }

    global.gc();
    global.gc();
    await new Promise(r => setTimeout(r, 200));
    global.gc();

    const baselineHandles = process._getActiveHandles().length;
    console.log(`Baseline active handles: ${baselineHandles}`);

    // Run tests
    const results = [];

    results.push({
        name: 'Successful connections',
        ...(await testSuccessfulConnections(normalPort, 500))
    });

    results.push({
        name: 'Connection refused',
        ...(await testConnectionRefused(500))
    });

    results.push({
        name: 'Connection timeout',
        ...(await testConnectionTimeout(blackHolePort, 100))
    });

    results.push({
        name: 'MX fallback',
        ...(await testMxFallback(normalPort, 200))
    });

    // Final cleanup - destroy server-side sockets before closing
    if (blackHoleServer.connectedSockets) {
        for (const socket of blackHoleServer.connectedSockets) {
            if (!socket.destroyed) {
                socket.destroy();
            }
        }
    }
    normalServer.close();
    blackHoleServer.close();

    await new Promise(r => setTimeout(r, 500));
    global.gc();
    global.gc();

    const finalHandles = process._getActiveHandles().length;

    // Summary
    console.log('\n=======================');
    console.log('Summary:');
    console.log('=======================');

    let hasIssues = false;

    for (const result of results) {
        const status = Math.abs(result.perOp) < 1024 ? 'OK' : 'WARN';
        if (status === 'WARN') {
            hasIssues = true;
        }
        console.log(`  ${result.name}: ${formatBytes(result.perOp)}/op [${status}]`);
    }

    const handleDiff = finalHandles - baselineHandles;
    console.log(`\n  Handle change: ${handleDiff >= 0 ? '+' : ''}${handleDiff}`);

    if (handleDiff > 0) {
        hasIssues = true;
        console.log('  WARNING: Handles not cleaned up!');
        console.log(
            '  Active handles:',
            process._getActiveHandles().map(h => h.constructor.name)
        );
    }

    if (hasIssues) {
        console.log('\n POTENTIAL MEMORY ISSUES DETECTED');
        process.exitCode = 1;
    } else {
        console.log('\n ALL TESTS PASSED - No memory leaks detected');
    }
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
