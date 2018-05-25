# mx-connect

Establish TCP connection to a MX server. This module takes a target domain or email address, resolves appropriate MX servers for this target and tries to get a connection, starting from higher priority servers.

Supports unicode hostnames and IPv6.

```
npm install mx-connect
```

## Usage

```javascript
const mxConnect = require('mx-connect');
mxConnect(options, callback);
```

Where

*   **options** is the target domain, address, or configuration object
*   **callback** is the function to run once connection is established to it fails

**Example**

This example establishes a connection to the MX of gmail.com and pipes output to console

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

You can use a domain name or an email address as the target, for additional configuration you would need to use configurtion object with the following properties (most are optional)

*   **target** is either a domain name or an email address or an IP address or IP address literal (basically anything you can have after the @-sign in an email address). Unicode is allowed.

*   **port** is the port number to connect to. Defaults to 25.
*   **localAddress** is the local IP address to use for the connection
*   **localHostname** is the hostname of the local address
*   **localAddressIPv4** is the local IPv4 address to use for the connection if you want to specify an address both for IPv4 and IPv6
*   **localAddressIPv6** is the local IPv6 address to use for the connection if you want to specify an address both for IPv4 and IPv6
*   **dnsOptions** is an object for IP address related options
    *   **ignoreIPv6** (boolean, defaults to `false`) If true then never use IPv6 addresses for sending
    *   **preferIPv6** (boolean, defaults to `false`) If true then use IPv6 address even if IPv4 address is also available
    *   **blockLocalAddresses** (boolean, defaults to `false`) If true then refuses to connect to IP addresses that are either in loopback, private network or attached to the server. People put every kind of stuff in MX records, you do not want to flood your loopback interface because someone thought it is a great idea to set 127.0.0.1 as the MX server
*   **mx** is a resolved MX object or an array of MX objects to skip DNS resolving. Useful if you want to connect to a specific host.
    *   **exchange** is the hostname of the MX
    *   **priority** (defaults to 0) is the MX priority number that is used to sort available MX servers (servers with higher priority are tried first)
    *   **A** is an array of IPv4 addresses. Optional, resolved from exchange hostname if not set
    *   **AAAA** is an array of IPv6 addresses. Optional, resolved from exchange hostname if not set
*   **connectHook** _function (options, socketOptions, callback)_ is a function handler to run before establishing a tcp connection to current target (defined in `socketOptions`). If the `socketOptions` object has a `socket` property after the callback then connection is not established. Useful if you want to divert the connection is ome cases, for example if the target domain is in the Onion network then you could create a socket against a SOCK proxy yourself.

### Connection object

Function callback gets connection object as the second argument

*   **socket** is a socket object against target
*   **hostname** is the hostname of the exchange
*   **host** is the IP address of the exchange
*   **port** is the port used to connect
*   **localAddress** is the local IP address used for the connection
*   **localPort** is the local port used for the connection

## License

EUPL v1.1 or newer
