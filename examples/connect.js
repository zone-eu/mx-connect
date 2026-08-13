/* eslint no-console: 0 */
'use strict';

// usage: `node connect.js gmail.com 25`

const mxConnect = require('../lib/mx-connect');

async function main() {
    const mx = await mxConnect({
        target: process.argv[2] || 'gmail.com',
        port: Number(process.argv[3]) || 25
    });

    console.log(mx);
    console.log('Connection established to %s:%s', mx.hostname || mx.host, mx.port);

    mx.socket.once('end', () => process.stdin.end());
    mx.socket.pipe(process.stdout);
    process.stdin.pipe(mx.socket);
}

main().catch(err => {
    console.log(err);
    process.exit(1);
});
