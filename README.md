# mx-connect

Establish a TCP connection to a mail server. Give it a domain or an email address; it resolves the MX records for that target and connects, trying the highest priority server first and falling back through the rest.

Supports unicode hostnames, IPv6, MTA-STS and DANE/TLSA verification.

## Requirements

Node.js 22.19.0 or newer. The floor comes from [mailauth](https://www.npmjs.com/package/mailauth), used for MTA-STS policy handling.

## Install

```
npm install mx-connect
```

## Usage

```javascript
const mxConnect = require('mx-connect');

// Promise (recommended)
const connection = await mxConnect(options);

// Callback
mxConnect(options, (err, connection) => { ... });
```

- **options** is the target domain, an email address, or a configuration object
- **callback** is optional; a promise is returned either way

### Example

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

The same with a callback:

```javascript
mxConnect('user@gmail.com', (err, connection) => {
    if (err) {
        return console.error(err);
    }
    console.log('Connection to %s:%s', connection.hostname, connection.port);
});
```

## Configuration

Pass a string to use the defaults, or an object to configure. Every property except `target` is optional.

### Target and connection

| Option           | Type   | Default | Description                                                                                              |
| ---------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------- |
| `target`         | string |         | Domain, email address, IP address or IP address literal. Anything valid after an `@`. Unicode is allowed |
| `port`           | number | `25`    | Port to connect to                                                                                       |
| `maxConnectTime` | number | 5 min   | Timeout in milliseconds to establish a connection, applied per MX host                                   |

### Local address binding

| Option              | Description                                   |
| ------------------- | --------------------------------------------- |
| `localAddress`      | Local IP address to bind to                   |
| `localHostname`     | Hostname of the local address, used for EHLO  |
| `localAddressIPv4`  | Local address used only for IPv4 connections  |
| `localHostnameIPv4` | Local hostname used only for IPv4 connections |
| `localAddressIPv6`  | Local address used only for IPv6 connections  |
| `localHostnameIPv6` | Local hostname used only for IPv6 connections |

The family-specific options let you bind a different source address per family. `localAddress` is used as-is whenever it matches the family of the host being connected to; the matching family-specific option is used only when `localAddress` is unset, or when the host belongs to the other family.

### dnsOptions

| Option                  | Type     | Default | Description                                                                                     |
| ----------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------- |
| `ignoreIPv6`            | boolean  | `false` | Never use IPv6 for sending. See [below](#ignoreipv6)                                            |
| `preferIPv6`            | boolean  | `false` | Try IPv6 addresses before IPv4 when a host has both                                             |
| `blockLocalAddresses`   | boolean  | `false` | Refuse local and private scope addresses. See [Address validation](#address-validation)         |
| `blockReservedNetworks` | boolean  | `false` | Refuse IANA special-purpose addresses. See [Address validation](#address-validation)            |
| `nat64Prefixes`         | string[] | `[]`    | NAT64 prefixes your own network runs. See [NAT64 on your own prefix](#nat64-on-your-own-prefix) |
| `resolveAsync`          | function |         | DNS resolver returning the records. See [Custom DNS resolver](#custom-dns-resolver)             |
| `resolve`               | function |         | Callback-style DNS resolver. See [Custom DNS resolver](#custom-dns-resolver)                    |

With neither set, native `dns.promises` is used.

#### Custom DNS resolver

`resolveAsync` receives a domain and a record type and returns the records:

```javascript
const connection = await mxConnect({
    target: 'user@example.com',
    dnsOptions: {
        async resolveAsync(domain, type) {
            // type is 'MX', 'A', 'AAAA' or 'TXT'
            return myResolver.lookup(domain, type);
        }
    }
});
```

Returning the records directly is fine too, so a resolver backed by a cache does not have to pretend to be asynchronous:

```javascript
const dnsOptions = {
    resolveAsync: (domain, type) => cache.get(`${domain}:${type}`) ?? []
};
```

Throwing, or returning a rejected promise, is how you report a lookup failure. Set `err.code` to `ENOTFOUND` or `ENODATA` to say "no records of this type", which lets resolution fall through to the next step; any other code is treated as a real DNS failure.

> [!TIP]
> `resolveAsync` always receives an explicit record type, A lookups included.

The older `resolve` option takes a callback and is still supported:

```javascript
const dnsOptions = {
    resolve(domain, type, callback) {
        // A lookups arrive as resolve(domain, callback), with no type
        myResolver.lookup(domain, type, callback);
    }
};
```

It is called as `resolve(domain, type, callback)`, except for A records where it is called as `resolve(domain, callback)` with no type at all. That quirk is why `resolveAsync` exists; prefer it for new code.

> [!NOTE]
> If both are set, `resolveAsync` is used and `resolve` is ignored, so you can migrate one deployment at a time.

#### ignoreIPv6

With `ignoreIPv6` enabled, no AAAA records are looked up and any IPv6 address is refused rather than used, including one given as the target or supplied through `mx`. A host that also has an IPv4 address is still delivered to over IPv4.

> [!NOTE]
> Refusing an address for this reason says nothing about the destination, only about how you configured this sender, so the error is marked temporary. A message waits for the setting to change instead of bouncing.

### mx

Skip MX resolution and connect to a host you name. Accepts a hostname string, a resolved MX object, or an array of either. A string is treated as a hostname or IP address with priority 0.

| Property      | Description                                                            |
| ------------- | ---------------------------------------------------------------------- |
| `exchange`    | Hostname of the MX                                                     |
| `priority`    | MX priority, defaulting to `0`. Lower numbers are tried first          |
| `A`           | Array of IPv4 addresses. Resolved from `exchange` when omitted         |
| `AAAA`        | Array of IPv6 addresses. Resolved from `exchange` when omitted         |
| `tlsaRecords` | Pre-resolved TLSA records. Resolved automatically when DANE is enabled |

> [!IMPORTANT]
> Addresses you supply here are validated exactly like resolved ones. An `mx` entry pointing at a blocked address is refused, not connected to.

### Host filtering and hooks

| Option          | Type     | Description                                                         |
| --------------- | -------- | ------------------------------------------------------------------- |
| `ignoreMXHosts` | string[] | IP addresses to skip when connecting                                |
| `mxLastError`   | Error    | Error to report if `ignoreMXHosts` filters out every host           |
| `connectHook`   | function | `(delivery, options, callback)`, run before each connection attempt |
| `connectError`  | function | `(err, delivery, options)`, run when a connection to an MX fails    |

`connectHook` runs before the TCP connection is opened. If `options` has a `socket` property once the callback returns, mx-connect uses that socket instead of connecting itself. This is how you divert a connection, for example through a SOCKS proxy for an Onion target.

### mtaSts

| Option           | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `enabled`        | Set to `true` to run MTA-STS checks. Off by default       |
| `logger(logObj)` | Receives MTA-STS log entries. Logging is off by default   |
| `cache`          | Policy cache with `get(domain)` and `set(domain, policy)` |

### dane

| Option                    | Description                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `enabled`                 | Must be set to `true` to enable DANE. There is no auto-detection                            |
| `resolveTlsa(tlsaName)`   | Optional custom TLSA resolver. See [Custom TLSA resolver](#custom-tlsa-resolver)            |
| `checkDnssecSecure(host)` | Optional DNSSEC status check. See [DNSSEC-aware DANE](#dnssec-aware-dane)                   |
| `logger(logObj)`          | Receives DANE log entries. Logging is off by default                                        |
| `verify`                  | Deprecated and ignored. DANE is always enforced when TLSA records are present, per RFC 7672 |

See [DANE support](#dane-support) for the full picture.

## Address validation

People put every kind of thing in MX records. You do not want to flood your loopback interface because someone decided `127.0.0.1` was a good MX host.

Every address the library resolves or is given passes through one check, whatever its origin: DNS answers, addresses you pass through `mx`, an IP literal target, and the host a domain's MTA-STS policy is fetched from.

### Always refused

These can never be a real mail host and are refused whatever the options say.

| Range                     | Description         |
| ------------------------- | ------------------- |
| `0.0.0.0`, `::`           | Unspecified address |
| `255.255.255.255`         | Limited broadcast   |
| `224.0.0.0/4`, `ff00::/8` | Multicast           |
| `100::/64`                | Discard prefix      |
| `5f00::/16`               | Segment routing     |

### blockLocalAddresses

| Range                         | Description                 |
| ----------------------------- | --------------------------- |
| `127.0.0.0/8`, `::1`          | Loopback                    |
| RFC 1918 ranges               | Private networks            |
| `169.254.0.0/16`, `fe80::/10` | Link-local                  |
| `100.64.0.0/10`               | Carrier-grade NAT           |
| `fc00::/7`                    | IPv6 unique-local           |
| `fec0::/10`                   | Deprecated site-local       |
| `64:ff9b:1::/48`              | Local-use NAT64 (see below) |

Any address assigned to one of the machine's own interfaces is refused too.

`64:ff9b:1::/48` is refused wholesale because RFC 8215 leaves the position of the embedded IPv4 address up to the local network, so it cannot be read from the address. Declaring the prefix in `nat64Prefixes` supplies that missing piece and lifts the blanket refusal.

### blockReservedNetworks

Off by default so the documentation ranges stay usable in tests and staging.

| Range                                                                | Description   |
| -------------------------------------------------------------------- | ------------- |
| `240.0.0.0/4`                                                        | Future use    |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32` | Documentation |
| `198.18.0.0/15`, `2001:2::/48`                                       | Benchmarking  |
| `2001:3::/32`                                                        | AMT           |

### Canonical notation is required

An address has to be written in a notation `net.isIP()` recognises, so `0127.0.0.1`, `2130706433` and `127.1` are refused rather than checked.

> [!WARNING]
> Those spellings mean different things to different parsers. A leading zero is octal to one and decimal to another, so `0127.0.0.1` would be checked as the public `87.0.0.1` and then connected to `127.0.0.1`.

Records returned by `dns.resolve` are always canonical, so this only concerns addresses you supply through `mx` or a custom `resolve` function.

### IPv4 addresses carried inside IPv6

Several IPv6 forms carry an IPv4 address that the connection actually reaches. Each is judged as the address it reaches, so it can neither slip past `blockLocalAddresses` nor be refused when the host behind it is an ordinary public one.

| Form             | Example            |
| ---------------- | ------------------ |
| IPv4-mapped      | `::ffff:127.0.0.1` |
| IPv4-compatible  | `::127.0.0.1`      |
| NAT64 well-known | `64:ff9b::/96`     |
| IPv4-translated  | `::ffff:0:0:0/96`  |
| 6to4             | `2002::/16`        |
| Teredo           | `2001::/32`        |

So `64:ff9b::7f00:1` is refused because it reaches `127.0.0.1`, while `64:ff9b::8.8.8.8` is fine. That distinction matters on IPv6-only networks, where DNS64 synthesizes exactly these records for every IPv4-only mail host, and blocking the prefix outright would break delivery to all of them.

For 6to4 and Teredo both tunnel endpoints are checked as well as the address itself.

> [!NOTE]
> `ignoreIPv6` is decided separately from this unwrapping, because it is about which stack the socket uses rather than where the packets land. `::ffff:8.8.8.8` and `64:ff9b::8.8.8.8` are refused as IPv6 even though they reach an IPv4 host.

### NAT64 on your own prefix

RFC 6052 also lets a network run NAT64 on a prefix from its own address space. Nothing in such an address identifies it as one, so `2a01:4f8:c17:b8f::7f00:1` is indistinguishable from an ordinary IPv6 host.

Only you know that prefix. Declare it and the address it carries is checked like any other:

```javascript
const connection = await mxConnect({
    target: 'user@example.com',
    dnsOptions: {
        blockLocalAddresses: true,
        nat64Prefixes: ['2a01:4f8:c17:b8f::/96']
    }
});
```

[RFC 7050](https://datatracker.ietf.org/doc/html/rfc7050) describes how to discover the prefix your network uses. Only the prefix lengths RFC 6052 defines (32, 40, 48, 56, 64 and 96) place the address at a known position, so an entry with any other length is ignored, as is one that cannot be parsed.

### Seeing what was refused

Refused addresses are collected on `delivery.blockedAddresses`, which is passed to the `connectHook` and `connectError` callbacks. Each entry has `exchange`, `ip` and `reason`.

This matters when only some of a host's addresses are refused: delivery continues over whatever survived, and without this the filtering would leave no trace, so a host left with only unreachable addresses would look like a plain network failure.

> [!CAUTION]
> `connectHook` receives the same options object used to open the socket, so a hook that rewrites `options.host` connects wherever it says. That is by design, and it is the one path validation does not cover.

## Connection object

The promise resolves, or the callback is invoked, with:

| Property        | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `socket`        | Connected socket                                                       |
| `hostname`      | Hostname of the exchange                                               |
| `host`          | IP address connected to                                                |
| `port`          | Port connected to                                                      |
| `localAddress`  | Local IP address used                                                  |
| `localHostname` | Local hostname used                                                    |
| `localPort`     | Local port used                                                        |
| `daneEnabled`   | `true` when DANE is active for this connection                         |
| `daneVerifier`  | DANE certificate verification function, for use during the TLS upgrade |
| `tlsaRecords`   | TLSA records for this MX host, when DANE is enabled                    |
| `requireTls`    | `true` when TLSA records exist, indicating TLS should be enforced      |

> [!IMPORTANT]
> mx-connect does not enforce TLS itself. Check `requireTls` during your TLS upgrade.

## Null MX

A domain that publishes an [RFC 7505](https://datatracker.ietf.org/doc/html/rfc7505) null MX record (`0 .`) is stating that it accepts no mail at all. Resolving such a target fails permanently with `err.code = 'ENULLMX'` and no A/AAAA fallback is attempted. Treat it as a permanent rejection; retrying will not help.

A null MX published alongside real MX records is a misconfiguration, forbidden by RFC 7505 Section 4.1. The null entry is ignored and delivery proceeds over the remaining records.

## DANE support

DANE (DNS-based Authentication of Named Entities) authenticates TLS certificates through DNSSEC. mx-connect looks up TLSA records for each MX host and gives you a verifier for the server certificate.

Native `dns.resolveTlsa` is available on every Node.js version this package supports, so DANE needs no resolver configuration:

```javascript
const connection = await mxConnect({
    target: 'user@example.com',
    dane: { enabled: true, logger: console.log }
});

console.log('DANE enabled:', connection.daneEnabled);
console.log('TLSA records:', connection.tlsaRecords?.length ?? 0);
```

> [!NOTE]
> `dane.enabled` must be set to `true` explicitly. There is no auto-detection.

### Security considerations

> [!IMPORTANT]
> DANE security rests on DNSSEC validation. Without it, an attacker who can tamper with DNS could inject fake TLSA records and pin a certificate of their choosing, making things worse rather than better.

Node.js does not currently expose the DNSSEC AD (Authenticated Data) flag from DNS responses, so an application cannot confirm that TLSA records were DNSSEC-validated by the resolver. This is tracked in [nodejs/node#57159](https://github.com/nodejs/node/issues/57159).

Applications using a DNS-over-HTTPS resolver, or any DNS library with access to raw response packets, can check the AD flag themselves and feed the result in through [`checkDnssecSecure`](#dnssec-aware-dane).

For production use:

1. **Use a DNSSEC-validating resolver**, such as a local Unbound instance, or 1.1.1.1 or 8.8.8.8
2. **Consider DNS-over-HTTPS** for transport security against on-path attackers, though it is not a substitute for DNSSEC validation
3. **Provide `checkDnssecSecure`** if your resolver exposes the AD flag, so TLSA lookups are skipped for insecure zones per RFC 7672
4. **Watch [nodejs/node#57159](https://github.com/nodejs/node/issues/57159)**; when Node exposes the AD flag, this module will be able to require DNSSEC validation

For domains with DNSSEC configured, DANE protects strongly against certificate misissuance and interception. For domains without it, MTA-STS is the alternative or complement.

### Verification flow

1. **DNSSEC check**, if `checkDnssecSecure` is provided. Hosts in insecure zones skip to step 5. A failing check marks the host as a DANE lookup failure and rejects the connection with a temporary error
2. **TLSA lookup** for each MX hostname, for example `_25._tcp.mail.example.com`
3. **Connection** to the MX server
4. **TLS upgrade**, where you pass `connection.daneVerifier` as `checkServerIdentity`
5. **Certificate verification** against the TLSA records, or opportunistic TLS when none were found

> [!WARNING]
> Node only calls `checkServerIdentity` after its own PKIX validation passes, so with the default `rejectUnauthorized: true` a certificate failing PKIX is rejected before the DANE verifier ever runs. DANE-EE certificates are frequently self-signed, which is exactly what PKIX rejects. Set `rejectUnauthorized: false` and treat the verifier's result as the authority.
>
> When TLSA records are present, the verifier's return value is then the only thing standing between you and an intercepted connection. Always destroy the socket when it returns an error.

`connection.daneVerifier` has the signature `(hostname, cert, chain)`. Node only ever calls `checkServerIdentity` with `(hostname, cert)`, so wiring it up directly checks the leaf certificate alone, which covers DANE-EE (usage 3) and PKIX-EE (usage 1). To also cover DANE-TA (usage 2) and PKIX-TA (usage 0), call the verifier yourself after the handshake and pass the issuer chain as an array of `X509Certificate` objects:

```javascript
const leaf = socket.getPeerX509Certificate();

// the chain holds the issuers only, the leaf is passed separately
const chain = [];
for (let cert = leaf && leaf.issuerCertificate; cert; cert = cert.issuerCertificate) {
    chain.push(cert);
}

const err = connection.daneVerifier(hostname, leaf, chain);
if (err) {
    socket.destroy();
    throw err;
}
```

### DNSSEC-aware DANE

[RFC 7672 Section 2.2.2](https://datatracker.ietf.org/doc/html/rfc7672#section-2.2.2) requires SMTP clients to check the DNSSEC status of an MX host's address records before looking up TLSA records. TLSA lookups should be skipped for unsigned zones because:

1. Secure TLSA records cannot exist in an unsigned zone
2. Some nameservers for unsigned zones return SERVFAIL for TLSA queries, Microsoft Exchange Online Protection among them, which would break delivery

`checkDnssecSecure` receives an MX hostname and returns `{ secure: boolean }`:

```javascript
const connection = await mxConnect({
    target: 'user@example.com',
    dane: {
        enabled: true,
        // Uses the AD flag from the DNS response to decide whether the
        // MX host's zone is DNSSEC-signed
        async checkDnssecSecure(hostname) {
            try {
                // A records cover most MX hosts
                return await resolver.resolve(hostname, 'A', { dnssecSecure: true });
            } catch {
                // Fall back to AAAA for IPv6-only hosts
                return resolver.resolve(hostname, 'AAAA', { dnssecSecure: true });
            }
        },
        logger: console.log
    }
});
```

A zone reported insecure skips the TLSA lookup for that host and falls back to opportunistic TLS. If the callback itself throws, say on a DNS timeout, the host is marked as a DANE lookup failure and the connection is rejected with a temporary error, which keeps DANE enforced across retries rather than silently downgrading. Omitting the callback attempts TLSA lookups for every host.

### Custom TLSA resolver

> [!TIP]
> You do not need this for compatibility. Every supported Node.js version resolves TLSA records natively. Supply one only when you want the lookups to go through a resolver of your own, typically to obtain DNSSEC validation.

The function receives the full query name and returns an array of TLSA records:

```javascript
const connection = await mxConnect({
    target: 'user@example.com',
    dane: {
        enabled: true,
        async resolveTlsa(tlsaName) {
            // tlsaName is e.g. '_25._tcp.mail.example.com'
            const answers = await myDohResolver.query(tlsaName, 'TLSA');

            return answers.map(answer => ({
                usage: answer.usage,
                selector: answer.selector,
                mtype: answer.matchingType,
                cert: Buffer.from(answer.certificate, 'hex')
            }));
        }
    }
});
```

Return an empty array when the host publishes no TLSA records.

### TLSA record format

```javascript
{
    usage: 3,     // 0=PKIX-TA, 1=PKIX-EE, 2=DANE-TA, 3=DANE-EE
    selector: 1,  // 0=Full certificate, 1=SubjectPublicKeyInfo
    mtype: 1,     // 0=Full data, 1=SHA-256, 2=SHA-512
    cert: Buffer, // Certificate association data
    ttl: 3600     // TTL in seconds
}
```

### Usage types

| Usage | Name    | Description                                            | Support |
| ----- | ------- | ------------------------------------------------------ | ------- |
| 0     | PKIX-TA | CA constraint, must chain to the specified CA          | Partial |
| 1     | PKIX-EE | Service certificate constraint, must match exactly     | Full    |
| 2     | DANE-TA | Trust anchor assertion, specified cert is trust anchor | Full\*  |
| 3     | DANE-EE | Domain-issued certificate, certificate must match      | Full    |

\* DANE-TA and PKIX-TA need the issuer chain, which Node does not pass to `checkServerIdentity`. Supply it yourself as shown in [Verification flow](#verification-flow). Without a chain, only the end-entity certificate is checked and these records never match.

The pinned certificate must lie on a signature-verified path from the certificate the server presented. A certificate that merely appears in the chain is not accepted: the trust anchor a TLSA record pins is public, so otherwise anyone could staple the pinned CA onto a chain of their own.

PKIX-TA remains partial because it does not additionally require PKIX path validation to have succeeded ([RFC 7671 Section 5.1](https://datatracker.ietf.org/doc/html/rfc7671#section-5.1)). [RFC 7672 Section 3.1](https://datatracker.ietf.org/doc/html/rfc7672#section-3.1) makes usages 0 and 1 inapplicable to SMTP in any case; prefer DANE-EE.

### Combining DANE with MTA-STS

The two work together. DANE gives stronger guarantees where DNSSEC is configured, MTA-STS covers domains without it:

```javascript
const connection = await mxConnect({
    target: 'user@example.com',
    mtaSts: {
        enabled: true,
        cache: mtaStsCache
    },
    dane: {
        enabled: true
    }
});
// Both MTA-STS and DANE checks are performed
```

### DANE utilities

The DANE module is exported for direct use:

```javascript
const { dane } = require('mx-connect');

// Is native TLSA resolution available
console.log(dane.hasNativeResolveTlsa);

// Constants
console.log(dane.DANE_USAGE, dane.DANE_SELECTOR, dane.DANE_MATCHING_TYPE);

// Resolve TLSA records for a host and port
const records = await dane.resolveTlsaRecords('mail.example.com', 25, {});

// Verify a certificate against TLSA records, chain optional for DANE-TA
const result = dane.verifyCertAgainstTlsa(certificate, tlsaRecords, chain);
```

## License

EUPL v1.1 or newer
