/* eslint no-console: 0 */
'use strict';

// usage: `node connect.js gmail.com 25`

let mxConnect = require('../lib/mx-connect');

mxConnect(
    {
        target: process.argv[2] || 'gmail.com',
        port: Number(process.argv[3]) || 25
    },
    (err, mx) => {
        if (err) {
            console.log(err);
            return process.exit(1);
        }
        console.log(mx);
        if (mx && mx.socket) {
            console.log('Connection established to %s:%s', mx.hostname || mx.host, mx.port);
            mx.socket.once('end', () => process.stdin.end());
            mx.socket.pipe(process.stdout);
            process.stdin.pipe(mx.socket);
        } else {
            console.log('Connection not established :/');
        }
    }
);
