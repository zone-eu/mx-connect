# mx-connect

Establish TCP connection to a MX server. This module takes a target domain or email address, resolves appropriate MX servers for this target and tries to get a connection, starting from higher priority servers.

Supports unicode hostnames, IPv6, MTA-STS, and DANE/TLSA verification.

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
    - **tlsaRecords** is an array of pre-resolved TLSA records for DANE verification. Optional, resolved automatically if DANE is enabled
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
- **dane** is an object for DANE/TLSA configuration (see [DANE Support](#dane-support) section below)
    - **enabled** - if `true` then enables DANE verification. Auto-detected based on resolver availability if not specified
    - **resolveTlsa(hostname)** - custom async function to resolve TLSA records. If not provided, uses native `dns.resolveTlsa` when available
    - **logger(logObj)** - method to log DANE information, logging is disabled by default
    - **verify** - if `true` (default), enforces DANE verification and rejects connections that fail. If `false`, only logs failures

### Connection object

Function callback or promise resolution provides a connection object with the following properties:

- **socket** is a socket object against target
- **hostname** is the hostname of the exchange
- **host** is the IP address of the exchange
- **port** is the port used to connect
- **localAddress** is the local IP address used for the connection
- **localHostname** is the local hostname used for the connection
- **localPort** is the local port used for the connection
- **daneEnabled** is `true` if DANE verification is active for this connection
- **daneVerifier** is the DANE certificate verification function (for use during TLS upgrade)
- **tlsaRecords** is an array of TLSA records for this MX host (if DANE is enabled)
- **requireTls** is `true` if TLS is required (set when DANE records exist)

## DANE Support

DANE (DNS-based Authentication of Named Entities) provides a way to authenticate TLS certificates using DNSSEC. This module supports DANE verification for outbound SMTP connections by looking up TLSA records and verifying server certificates against them.

### Node.js Version Support

Native `dns.resolveTlsa` support was added in:

| Node.js Version | TLSA Support |
| --------------- | ------------ |
| v24.x (Current) | ✅ Native    |
| v23.9.0+        | ✅ Native    |
| v22.15.0+ (LTS) | ✅ Native    |
| v22.0.0-v22.14  | ❌ None      |
| v20.x (LTS)     | ❌ None      |
| v18.x           | ❌ None      |

### Automatic Detection

When you enable DANE without providing a custom resolver, mx-connect automatically detects whether native `dns.resolveTlsa` is available:

- If native support exists, DANE is enabled automatically
- If native support is not available and no custom resolver is provided, DANE is disabled with a log message

### Using Tangerine for Older Node.js Versions

For Node.js versions without native TLSA support, you can use [Tangerine](https://github.com/forwardemail/tangerine), a DNS-over-HTTPS resolver that provides `resolveTlsa` functionality:

```javascript
const mxConnect = require('mx-connect');
const Tangerine = require('tangerine');

// Create a Tangerine instance
const tangerine = new Tangerine();

const connection = await mxConnect({
    target: 'user@example.com',
    dane: {
        enabled: true,
        resolveTlsa: tangerine.resolveTlsa.bind(tangerine),
        logger: console.log
    }
});

console.log('Connected to %s:%s', connection.hostname, connection.port);
console.log('DANE enabled:', connection.daneEnabled);

if (connection.tlsaRecords) {
    console.log('TLSA records:', connection.tlsaRecords.length);
}

// Use connection.daneVerifier during TLS upgrade
// The verifier function can be passed to tls.connect() as checkServerIdentity
```

### DANE with Redis Caching (Tangerine)

For production use, you can configure Tangerine with Redis caching for better performance:

```javascript
const mxConnect = require('mx-connect');
const Tangerine = require('tangerine');
const Redis = require('ioredis');

const cache = new Redis();
const tangerine = new Tangerine({
    cache,
    setCacheArgs(key, result) {
        return ['PX', Math.round(result.ttl * 1000)];
    }
});

const connection = await mxConnect({
    target: 'user@example.com',
    dane: {
        enabled: true,
        resolveTlsa: tangerine.resolveTlsa.bind(tangerine),
        verify: true, // Enforce DANE verification
        logger: logObj => {
            console.log('[DANE]', logObj.msg, logObj);
        }
    }
});
```

### DANE Verification Flow

When DANE is enabled, the following flow occurs:

1. **TLSA Lookup**: Before connecting, mx-connect resolves TLSA records for each MX hostname (e.g., `_25._tcp.mail.example.com`)
2. **Connection**: A TCP connection is established to the MX server
3. **TLS Upgrade**: When upgrading to TLS (STARTTLS), use the `connection.daneVerifier` function as the `checkServerIdentity` option
4. **Certificate Verification**: The server's certificate is verified against the TLSA records

### TLSA Record Format

TLSA records returned by the resolver should have the following structure:

```javascript
{
    usage: 3,           // 0=PKIX-TA, 1=PKIX-EE, 2=DANE-TA, 3=DANE-EE
    selector: 1,        // 0=Full certificate, 1=SubjectPublicKeyInfo
    mtype: 1,           // 0=Full data, 1=SHA-256, 2=SHA-512
    cert: Buffer,       // Certificate association data
    ttl: 3600           // TTL in seconds
}
```

### DANE Usage Types

| Usage | Name    | Description                                              |
| ----- | ------- | -------------------------------------------------------- |
| 0     | PKIX-TA | CA constraint - must chain to specified CA               |
| 1     | PKIX-EE | Service certificate constraint - must match exactly      |
| 2     | DANE-TA | Trust anchor assertion - specified cert is trust anchor  |
| 3     | DANE-EE | Domain-issued certificate - certificate must match       |

### Combining DANE with MTA-STS

DANE and MTA-STS can be used together. DANE provides stronger security guarantees (when DNSSEC is properly configured), while MTA-STS provides a fallback for domains that don't support DNSSEC:

```javascript
const connection = await mxConnect({
    target: 'user@example.com',
    mtaSts: {
        enabled: true,
        cache: mtaStsCache
    },
    dane: {
        enabled: true,
        resolveTlsa: tangerine.resolveTlsa.bind(tangerine)
    }
});
// Both MTA-STS and DANE checks are performed
```

### Accessing DANE Utilities

The DANE module is exported for direct use:

```javascript
const { dane } = require('mx-connect');

// Check if native TLSA resolution is available
console.log('Native TLSA support:', dane.hasNativeResolveTlsa);

// DANE constants
console.log('DANE Usage Types:', dane.DANE_USAGE);
console.log('DANE Selectors:', dane.DANE_SELECTOR);
console.log('DANE Matching Types:', dane.DANE_MATCHING_TYPE);

// Verify a certificate against TLSA records
const result = dane.verifyCertAgainstTlsa(certificate, tlsaRecords);
```

## License

EUPL v1.1 or newer
