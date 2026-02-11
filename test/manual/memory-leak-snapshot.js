/* eslint no-console: 0*/

'use strict';

/**
 * Heap snapshot memory leak detection test.
 *
 * Compares V8 heap snapshots at the object level (baseline vs post-operation)
 * to find specific constructor types that grew disproportionately, then maps
 * them back to source code.
 *
 * Run with: node --expose-gc test/manual/memory-leak-snapshot.js
 */

const v8 = require('v8');
const fs = require('fs');
const path = require('path');
const os = require('os');
const mxConnect = require('../../lib/mx-connect');

if (typeof global.gc !== 'function') {
    console.error('ERROR: Run with --expose-gc flag:');
    console.error('  node --expose-gc test/manual/memory-leak-snapshot.js');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Mock infrastructure (self-contained, no test-utils dependency)
// ---------------------------------------------------------------------------

function createMockSocket(remoteAddress) {
    const { EventEmitter } = require('events');
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
    socket.write = () => true;
    socket.pipe = function () {
        return this;
    };
    socket.setEncoding = () => {};
    socket.setTimeout = () => {};
    return socket;
}

function createMockResolver() {
    return (domain, typeOrCallback, callback) => {
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

// ---------------------------------------------------------------------------
// Heap snapshot parsing
// ---------------------------------------------------------------------------

/**
 * Parse a .heapsnapshot JSON file and build a map of constructor name to
 * { count, totalSize, typeName }.
 *
 * Only includes nodes where typeName is "object" or "closure" (skips V8
 * internals: hidden, code, string, number, native, synthetic, etc.).
 */
function parseHeapSnapshot(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const snapshot = JSON.parse(raw);

    const meta = snapshot.snapshot.meta;
    const nodeFields = meta.node_fields;
    const nodeTypes = meta.node_types[0];
    const nodeFieldCount = nodeFields.length;

    const typeIndex = nodeFields.indexOf('type');
    const nameIndex = nodeFields.indexOf('name');
    const selfSizeIndex = nodeFields.indexOf('self_size');

    const strings = snapshot.strings;
    const nodes = snapshot.nodes;

    const constructorMap = {};

    for (let i = 0; i < nodes.length; i += nodeFieldCount) {
        const typeOrdinal = nodes[i + typeIndex];
        const typeName = nodeTypes[typeOrdinal];

        if (typeName !== 'object' && typeName !== 'closure') {
            continue;
        }

        const nameIdx = nodes[i + nameIndex];
        const name = strings[nameIdx];

        if (!name || name.charAt(0) === '(') {
            continue;
        }

        const selfSize = nodes[i + selfSizeIndex];

        if (!constructorMap[name]) {
            constructorMap[name] = { count: 0, totalSize: 0, typeName };
        }

        constructorMap[name].count += 1;
        constructorMap[name].totalSize += selfSize;
    }

    return constructorMap;
}

// ---------------------------------------------------------------------------
// Snapshot comparison
// ---------------------------------------------------------------------------

function compareSnapshots(baseline, final, totalIterations) {
    const suspicious = [];
    const allKeys = new Set([...Object.keys(baseline), ...Object.keys(final)]);

    for (const key of allKeys) {
        const base = baseline[key] || { count: 0, totalSize: 0, typeName: (final[key] && final[key].typeName) || 'object' };
        const fin = final[key] || { count: 0, totalSize: 0, typeName: base.typeName };

        const countDelta = fin.count - base.count;
        const sizeDelta = fin.totalSize - base.totalSize;

        if (countDelta > 10 && countDelta > totalIterations * 0.1) {
            suspicious.push({
                name: key,
                typeName: fin.typeName,
                baseCount: base.count,
                finalCount: fin.count,
                countDelta,
                baseSize: base.totalSize,
                finalSize: fin.totalSize,
                sizeDelta,
                ratio: countDelta / totalIterations
            });
        }
    }

    suspicious.sort((a, b) => b.countDelta - a.countDelta);
    return suspicious;
}

// ---------------------------------------------------------------------------
// Source location mapping
// ---------------------------------------------------------------------------

const KNOWN_OBJECT_SITES = [
    'lib/mx-connect.js  buildDeliveryObject()',
    'lib/mx-connect.js  normalizeMxEntry()',
    'lib/get-connection.js  tryConnect() options',
    'lib/get-connection.js  buildMxHostList() entries'
];

function findSourceLocations(suspiciousEntries) {
    const libDir = path.join(__dirname, '..', '..', 'lib');
    const libFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));

    const fileContents = {};
    for (const f of libFiles) {
        fileContents[f] = fs.readFileSync(path.join(libDir, f), 'utf8').split('\n');
    }

    for (const entry of suspiciousEntries) {
        const locations = [];

        if (entry.name === 'Object') {
            locations.push(...KNOWN_OBJECT_SITES);
        } else {
            for (const f of libFiles) {
                const lines = fileContents[f];
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    let matched = false;

                    if (entry.typeName === 'closure') {
                        if (line.indexOf('function ' + entry.name) !== -1) {
                            matched = true;
                        }
                    } else if (
                        line.indexOf('new ' + entry.name) !== -1 ||
                        line.indexOf('class ' + entry.name) !== -1 ||
                        line.indexOf('function ' + entry.name) !== -1
                    ) {
                        matched = true;
                    }

                    if (matched) {
                        locations.push('lib/' + f + ':' + (i + 1) + '  ' + line.trim());
                    }
                }
            }
        }

        entry.sourceLocations = locations;
    }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
    const abs = Math.abs(bytes);
    if (abs < 1024) {
        return bytes + ' B';
    }
    if (abs < 1024 * 1024) {
        return (bytes / 1024).toFixed(0) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---------------------------------------------------------------------------
// Operation scenarios
// ---------------------------------------------------------------------------

function runSuccessScenario(index) {
    const mockSocket = createMockSocket('192.0.2.1');
    return mxConnect({
        target: 'test' + index + '.example.com',
        dnsOptions: {
            resolve: createMockResolver(),
            blockLocalAddresses: false
        },
        connectHook(delivery, options, callback) {
            options.socket = mockSocket;
            setImmediate(callback);
        }
    }).then(connection => {
        if (connection.socket && !connection.socket.destroyed) {
            connection.socket.end();
        }
    });
}

function runDnsFailScenario(index) {
    return mxConnect({
        target: 'fail' + index + '.example.com',
        dnsOptions: {
            resolve(domain, typeOrCallback, callback) {
                const cb = typeof typeOrCallback === 'function' ? typeOrCallback : callback;
                setImmediate(() => {
                    const err = new Error('SERVFAIL');
                    err.code = 'ESERVFAIL';
                    cb(err);
                });
            }
        }
    }).then(
        () => {},
        () => {}
    );
}

function runHookFailScenario(index) {
    return mxConnect({
        target: 'hookfail' + index + '.example.com',
        dnsOptions: {
            resolve: createMockResolver(),
            blockLocalAddresses: false
        },
        connectHook(delivery, options, callback) {
            setImmediate(() => {
                callback(new Error('Hook failure'));
            });
        }
    }).then(
        () => {},
        () => {}
    );
}

function runDaneTlsaScenario(index) {
    const mockSocket = createMockSocket('192.0.2.1');
    const mockTlsaRecords = [
        {
            usage: 3,
            selector: 1,
            mtype: 1,
            cert: Buffer.alloc(32, 0xff),
            ttl: 3600
        }
    ];

    return mxConnect({
        target: 'dane' + index + '.example.com',
        mx: [
            {
                exchange: 'mail.example.com',
                priority: 10,
                A: ['192.0.2.1'],
                AAAA: []
            }
        ],
        dane: {
            enabled: true,
            resolveTlsa() {
                return Promise.resolve(mockTlsaRecords);
            },
            verify: false,
            logger() {}
        },
        connectHook(delivery, options, callback) {
            options.socket = mockSocket;
            setImmediate(callback);
        }
    }).then(connection => {
        if (connection.socket && !connection.socket.destroyed) {
            connection.socket.end();
        }
    });
}

function runDaneServfailScenario(index) {
    const mockSocket = createMockSocket('192.0.2.1');

    return mxConnect({
        target: 'daneservfail' + index + '.example.com',
        mx: [
            {
                exchange: 'mail.example.com',
                priority: 10,
                A: ['192.0.2.1'],
                AAAA: []
            }
        ],
        dane: {
            enabled: true,
            resolveTlsa() {
                const err = new Error('DNS lookup failed');
                err.code = 'ESERVFAIL';
                return Promise.reject(err);
            },
            verify: false,
            logger() {}
        },
        connectHook(delivery, options, callback) {
            options.socket = mockSocket;
            setImmediate(callback);
        }
    }).then(connection => {
        if (connection.socket && !connection.socket.destroyed) {
            connection.socket.end();
        }
    });
}

function runDaneEnodataScenario(index) {
    const mockSocket = createMockSocket('192.0.2.1');

    return mxConnect({
        target: 'daneenodata' + index + '.example.com',
        mx: [
            {
                exchange: 'mail.example.com',
                priority: 10,
                A: ['192.0.2.1'],
                AAAA: []
            }
        ],
        dane: {
            enabled: true,
            resolveTlsa() {
                const err = new Error('No data');
                err.code = 'ENODATA';
                return Promise.reject(err);
            },
            logger() {}
        },
        connectHook(delivery, options, callback) {
            options.socket = mockSocket;
            setImmediate(callback);
        }
    }).then(connection => {
        if (connection.socket && !connection.socket.destroyed) {
            connection.socket.end();
        }
    });
}

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

function runScenarioBatch(scenarioFn, count, label) {
    let completed = 0;
    let chain = Promise.resolve();
    for (let i = 0; i < count; i++) {
        const idx = i;
        chain = chain.then(() =>
            scenarioFn(idx).then(() => {
                completed++;
                if (completed % 100 === 0) {
                    process.stdout.write('  ' + label + ': ' + completed + '/' + count + '\r');
                }
            })
        );
    }
    return chain.then(() => {
        console.log('  ' + label + ': ' + completed + '/' + count);
    });
}

// ---------------------------------------------------------------------------
// Count object+closure entries in a constructor map
// ---------------------------------------------------------------------------

function countObjects(constructorMap) {
    let total = 0;
    for (const key in constructorMap) {
        total += constructorMap[key].count;
    }
    return total;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const ITERATIONS = 500;
    const WARMUP = 50;
    const TOTAL_OPS = ITERATIONS * 6;

    console.log('============================================================');
    console.log('HEAP SNAPSHOT MEMORY LEAK ANALYSIS');
    console.log('============================================================');
    console.log('');

    // Warmup
    console.log('Warmup phase (' + WARMUP + ' iterations of scenarios 1, 2, 4)...');
    await runScenarioBatch(runSuccessScenario, WARMUP, 'success');
    await runScenarioBatch(runDnsFailScenario, WARMUP, 'dns-fail');
    await runScenarioBatch(runDaneTlsaScenario, WARMUP, 'dane-tlsa');

    // Force GC x3 + pause
    global.gc();
    global.gc();
    global.gc();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Baseline snapshot
    const baselineFile = path.join(os.tmpdir(), 'mx-connect-baseline-' + Date.now() + '.heapsnapshot');
    console.log('\nWriting baseline snapshot...');
    v8.writeHeapSnapshot(baselineFile);
    console.log('  ' + baselineFile);

    // Run all 6 scenarios
    console.log('\nRunning ' + TOTAL_OPS + ' operations (' + ITERATIONS + ' each x 6 scenarios)...');
    await runScenarioBatch(runSuccessScenario, ITERATIONS, 'Scenario 1 (success)');
    await runScenarioBatch(runDnsFailScenario, ITERATIONS, 'Scenario 2 (dns fail)');
    await runScenarioBatch(runHookFailScenario, ITERATIONS, 'Scenario 3 (hook fail)');
    await runScenarioBatch(runDaneTlsaScenario, ITERATIONS, 'Scenario 4 (dane+tlsa)');
    await runScenarioBatch(runDaneServfailScenario, ITERATIONS, 'Scenario 5 (dane servfail)');
    await runScenarioBatch(runDaneEnodataScenario, ITERATIONS, 'Scenario 6 (dane enodata)');

    // Force GC x3 + pause
    global.gc();
    global.gc();
    global.gc();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Final snapshot
    const finalFile = path.join(os.tmpdir(), 'mx-connect-final-' + Date.now() + '.heapsnapshot');
    console.log('\nWriting final snapshot...');
    v8.writeHeapSnapshot(finalFile);
    console.log('  ' + finalFile);

    // Parse both snapshots
    console.log('\nParsing snapshots...');
    const baselineMap = parseHeapSnapshot(baselineFile);
    const finalMap = parseHeapSnapshot(finalFile);

    const baselineObjCount = countObjects(baselineMap);
    const finalObjCount = countObjects(finalMap);

    // Compare
    const suspicious = compareSnapshots(baselineMap, finalMap, TOTAL_OPS);

    // Source mapping
    findSourceLocations(suspicious);

    // Report
    console.log('');
    console.log('Snapshots: baseline vs final after ' + TOTAL_OPS + ' total operations');
    console.log('  Baseline objects (object+closure): ' + baselineObjCount);
    console.log('  Final objects (object+closure):    ' + finalObjCount);
    console.log('');

    if (suspicious.length === 0) {
        console.log('No suspicious object growth detected.');
        console.log('');
        console.log('VERDICT: PASS');
    } else {
        console.log('------------------------------------------------------------');
        console.log('SUSPICIOUS OBJECT GROWTH (count delta > 10, ratio > 0.10)');
        console.log('------------------------------------------------------------');
        console.log('');

        for (const entry of suspicious) {
            console.log('  ' + entry.name + ' [' + entry.typeName + ']');
            console.log(
                '    Count: ' +
                    entry.baseCount +
                    ' -> ' +
                    entry.finalCount +
                    ' (+' +
                    entry.countDelta +
                    ')' +
                    '   Size: ' +
                    formatBytes(entry.baseSize) +
                    ' -> ' +
                    formatBytes(entry.finalSize) +
                    ' (' +
                    (entry.sizeDelta >= 0 ? '+' : '') +
                    formatBytes(entry.sizeDelta) +
                    ')'
            );
            console.log('    Ratio: ' + entry.ratio.toFixed(3) + ' per operation');

            if (entry.sourceLocations && entry.sourceLocations.length > 0) {
                console.log('    Source:');
                for (const loc of entry.sourceLocations) {
                    console.log('      - ' + loc);
                }
            }
            console.log('');
        }

        console.log('------------------------------------------------------------');
        console.log('VERDICT: FAIL - ' + suspicious.length + ' constructor(s) with disproportionate growth');
    }

    // Cleanup snapshot files
    try {
        fs.unlinkSync(baselineFile);
    } catch {
        // ignore
    }
    try {
        fs.unlinkSync(finalFile);
    } catch {
        // ignore
    }

    // Exit code
    if (suspicious.length > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
