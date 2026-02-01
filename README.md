# mx-connect

Establish TCP connection to a MX server. This module takes a target domain or email address, resolves appropriate MX servers for this target and tries to get a connection, starting from higher priority servers.

Supports unicode hostnames and IPv6.

```
npm install mx-connect
```

## Usage

```javascript
const mxConnect = require('mx-connect');

// Using promises (recommended)
const connection = await mxConnect(options);

// Using callbacks
mxConnect(options, (err, connection) => { ... });
```

Where

- **options** is the target domain, address, or configuration object
- **callback** (optional) is the function to run once connection is established or it fails

**Example using async/await**

```javascript
const mxConnect = require('mx-connect');

try {
    const connection = await mxConnect('user@gmail.com');
    console.log('Connection to %s:%s', connection.hostname, connection.port);
    // Connection to aspmx.l.google.com:25

    connection.socket.pipe(process.stdout);
    // 220 mx.google.com ESMTP k11-v6si869487ljk.7 - gsmtp
} catch (err) {
    console.error(err);
}
```

**Example using callbacks**

```javascript
const mxConnect = require('mx-connect');

mxConnect('user@gmail.com', (err, connection) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Connection to %s:%s', connection.hostname, connection.port);
        // Connection to aspmx.l.google.com:25

        connection.socket.pipe(process.stdout);
        // 220 mx.google.com ESMTP k11-v6si869487ljk.7 - gsmtp
    }
});
```

### Configuration options

You can use a domain name or an email address as the target, for additional configuration you would need to use a configuration object with the following properties (most are optional)

- **target** is either a domain name or an email address or an IP address or IP address literal (basically anything you can have after the @-sign in an email address). Unicode is allowed.

- **port** is the port number to connect to. Defaults to 25.
- **maxConnectTime** is the timeout in milliseconds to wait for a connection to be established (per MX host). Defaults to 5 minutes.
- **localAddress** is the local IP address to use for the connection
- **localHostname** is the hostname of the local address
- **localAddressIPv4** is the local IPv4 address to use for the connection if you want to specify an address both for IPv4 and IPv6
- **localHostnameIPv4** is the local hostname to use for IPv4 connections
- **localAddressIPv6** is the local IPv6 address to use for the connection if you want to specify an address both for IPv4 and IPv6
- **localHostnameIPv6** is the local hostname to use for IPv6 connections
- **dnsOptions** is an object for IP address related options
    - **ignoreIPv6** (boolean, defaults to `false`) If true then never use IPv6 addresses for sending
    - **preferIPv6** (boolean, defaults to `false`) If true then use IPv6 address even if IPv4 address is also available
    - **blockLocalAddresses** (boolean, defaults to `false`) If true then refuses to connect to IP addresses that are either in loopback, private network or attached to the server. People put every kind of stuff in MX records, you do not want to flood your loopback interface because someone thought it is a great idea to set 127.0.0.1 as the MX server
    - **resolve** (function, defaults to native `dns.promises`, callback-style) Custom DNS resolver function with signature `resolve(domain, type, callback)` or `resolve(domain, callback)`
- **mx** is a resolved MX object or an array of MX objects to skip DNS resolving. Useful if you want to connect to a specific host.
    - **exchange** is the hostname of the MX
    - **priority** (defaults to 0) is the MX priority number that is used to sort available MX servers (servers with higher priority are tried first)
    - **A** is an array of IPv4 addresses. Optional, resolved from exchange hostname if not set
    - **AAAA** is an array of IPv6 addresses. Optional, resolved from exchange hostname if not set
- **ignoreMXHosts** is an array of IP addresses to skip when connecting
- **mxLastError** is an error object to use if all MX hosts are filtered out by `ignoreMXHosts`
- **connectHook** _function (delivery, options, callback)_ is a function handler to run before establishing a tcp connection to current target (defined in `options`). If the `options` object has a `socket` property after the callback then connection is not established. Useful if you want to divert the connection in some cases, for example if the target domain is in the Onion network then you could create a socket against a SOCKS proxy yourself.
- **connectError** _function (err, delivery, options)_ is a function handler to run when a connection to a MX fails.
- **mtaSts** is an object for MTA-STS configuration
    - **enabled** - if not `true` then does not run MTA-STS checks, disabled by default
    - **logger(logObj)** - method to log MTA-STS information, logging is disabled by default
    - **cache** - an object to manage MTA-STS policy cache
        - **get(domain)** -> returns cached policy object
        - **set(domain, policyObj)** -> caches a policy object

### Connection object

Function callback or promise resolution provides a connection object with the following properties:

- **socket** is a socket object against target
- **hostname** is the hostname of the exchange
- **host** is the IP address of the exchange
- **port** is the port used to connect
- **localAddress** is the local IP address used for the connection
- **localHostname** is the local hostname used for the connection
- **localPort** is the local port used for the connection

## License

EUPL v1.1 or newer
