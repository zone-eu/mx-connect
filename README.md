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
    - **ignoreIPv6** (boolean, defaults to `false`) If true then IPv6 is never used for sending: no AAAA records are looked up, and any IPv6 address is refused rather than used, including ones given as the target or supplied through the **mx** option. A host that also has an IPv4 address is still delivered to over IPv4. Because this refusal reflects your configuration rather than the destination, the resulting error is temporary, so a message is held rather than bounced
    - **preferIPv6** (boolean, defaults to `false`) If true then use IPv6 address even if IPv4 address is also available
    - **blockLocalAddresses** (boolean, defaults to `false`) If true then refuses to connect to IP addresses that are in a local or private scope, or attached to the server. People put every kind of stuff in MX records, you do not want to flood your loopback interface because someone thought it is a great idea to set 127.0.0.1 as the MX server. Covers loopback (`127.0.0.0/8`, `::1`), private networks (RFC1918), link-local (`169.254.0.0/16`, `fe80::/10`), carrier-grade NAT (`100.64.0.0/10`), IPv6 unique-local (`fc00::/7`) and deprecated site-local (`fec0::/10`). Also covers the local-use NAT64 prefix (`64:ff9b:1::/48`), whose embedded IPv4 address depends on the local network configuration and so cannot be checked
    - **blockReservedNetworks** (boolean, defaults to `false`) If true then also refuses to connect to IANA special-purpose addresses: future-use (`240.0.0.0/4`), the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`), benchmarking (`198.18.0.0/15`, `2001:2::/48`) and AMT (`2001:3::/32`). Off by default so that the documentation ranges stay usable in tests and staging setups
    - **nat64Prefixes** (array of CIDR strings, defaults to `[]`) The NAT64 prefixes your network runs, for example `['2a01:4f8:c17:b8f::/96']`. The well-known prefix `64:ff9b::/96` is always recognised; a prefix from your own address space cannot be, since nothing in the address identifies it. Declaring it lets the IPv4 address such an address carries be validated like any other, so a synthesized record pointing at `127.0.0.1` is refused while one pointing at a public host still delivers, and the address is still judged on its own account as well. RFC 7050 describes how to discover the prefix your network uses. Only the prefix lengths RFC 6052 defines (32, 40, 48, 56, 64 and 96) carry an address at a known position, so an entry with any other length is ignored, as is one that cannot be parsed
    - **resolve** (function, defaults to native `dns.resolve`) Custom callback-style DNS resolver function with signature `resolve(domain, type, callback)` or `resolve(domain, callback)`. A record lookups always use the two-argument form `resolve(domain, callback)`, other record types (`MX`, `AAAA`, `TXT`) use the three-argument form

    Addresses that can never be a real mail host are always rejected, whatever the options above are set to: the unspecified address (`0.0.0.0`, `::`), the limited broadcast address (`255.255.255.255`), multicast (`224.0.0.0/4`, `ff00::/8`), the discard prefix (`100::/64`) and segment routing identifiers (`5f00::/16`).

    An address also has to be written in a notation `net.isIP()` recognises, so `0127.0.0.1`, `2130706433` and `127.1` are refused rather than checked. Those spellings mean different things to different parsers, and the platform resolver would reach a different host than the one checked: a leading zero is octal here and decimal there, which would turn `0127.0.0.1` into a check against the public `87.0.0.1` and a connection to `127.0.0.1`. Records returned by `dns.resolve` are always canonical, so this only concerns addresses you supply through the **mx** option or a custom **resolve** function.

    An IPv6 address that carries an IPv4 address inside it is judged as the IPv4 address the connection actually reaches, so it can neither slip past `blockLocalAddresses` nor be refused when the host it reaches is an ordinary public one. This covers IPv4-mapped (`::ffff:127.0.0.1`), the deprecated IPv4-compatible form (`::127.0.0.1`), NAT64 (`64:ff9b::/96`), IPv4-translated (`::ffff:0:0:0/96`), 6to4 (`2002::/16`) and Teredo (`2001::/32`). So `64:ff9b::7f00:1` is refused because it reaches `127.0.0.1`, while `64:ff9b::8.8.8.8` is fine - which matters on IPv6-only networks, where DNS64 synthesizes exactly these records for every IPv4-only mail host. For 6to4 and Teredo both tunnel endpoints are checked as well as the address itself. `ignoreIPv6` is decided separately from this unwrapping, since it is about which stack the socket uses rather than where the packets land, so `::ffff:8.8.8.8` and `64:ff9b::8.8.8.8` are still refused as IPv6 even though they reach an IPv4 host.

    RFC 6052 also lets a network run NAT64 on a prefix out of its own address space, and nothing in such an address marks it as one, so `2a01:4f8:c17:b8f::7f00:1` is indistinguishable from an ordinary IPv6 host. Only you know that prefix, so declare it with **nat64Prefixes** and the address it carries is checked like any other.

    All of the above, `ignoreIPv6` included, is decided in one place for every address the library resolves or is given, including addresses you pass in yourself through the **mx** option and the host a domain's MTA-STS policy is fetched from. The one exception is **connectHook**: it is handed the same options object used to open the socket, so a hook that rewrites `options.host` connects wherever it says, by design. Addresses dropped by these rules are listed on the `delivery.blockedAddresses` array handed to the `connectHook` and `connectError` callbacks, so filtering that still leaves a usable address can be told apart from a network failure.

- **mx** is a hostname string, a resolved MX object, or an array of either, to skip DNS resolving. Useful if you want to connect to a specific host. String entries are treated as hostnames (or IP addresses) with priority 0.
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
    - **enabled** - must be set to `true` to enable DANE verification
    - **resolveTlsa(tlsaName)** - custom async function to resolve TLSA records. Receives the full TLSA query name (e.g., `_25._tcp.mail.example.com`). If not provided, uses native `dns.resolveTlsa` when available
    - **checkDnssecSecure(hostname)** - optional async function to check DNSSEC validation status of an MX host before attempting TLSA lookups ([RFC 7672 Section 2.2.2](https://datatracker.ietf.org/doc/html/rfc7672#section-2.2.2)). Should return `{ secure: boolean }`. When provided and the zone is insecure, TLSA lookups are skipped and the connection falls back to opportunistic TLS. See [DNSSEC-Aware DANE](#dnssec-aware-dane) below
    - **logger(logObj)** - method to log DANE information, logging is disabled by default
    - **verify** - _(deprecated, ignored)_ DANE verification is always enforced when TLSA records are present, per RFC 7672. This option is accepted for backward compatibility but has no effect

### Null MX

If a domain publishes an [RFC 7505](https://datatracker.ietf.org/doc/html/rfc7505) null MX record (`0 .`), it states that it accepts no mail at all. Resolving such a target fails permanently with `err.code = 'ENULLMX'`, and no fallback to A/AAAA records is attempted. Treat it as a permanent rejection, there is no point in retrying it later.

A null MX published alongside real MX records is a misconfiguration, RFC 7505 Section 4.1 forbids the combination. In that case the null entry is ignored and delivery proceeds using the remaining MX records.

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
- **requireTls** is `true` when DANE records exist, indicating TLS should be enforced. mx-connect itself does not enforce TLS -- the consuming application should check this flag during TLS upgrade

## DANE Support

DANE (DNS-based Authentication of Named Entities) provides a way to authenticate TLS certificates using DNSSEC. This module supports DANE verification for outbound SMTP connections by looking up TLSA records and verifying server certificates against them.

### Security Considerations

> **Important**: DANE security relies on DNSSEC validation. Without DNSSEC, a DNS attacker could potentially inject fake TLSA records and pin a malicious certificate, introducing new security vulnerabilities rather than preventing them.

Currently, Node.js does not expose the DNSSEC AD (Authenticated Data) flag from DNS responses, which means applications cannot verify that TLSA records were DNSSEC-validated by the resolver. This is tracked in [nodejs/node#57159](https://github.com/nodejs/node/issues/57159).

However, applications that use a DNS-over-HTTPS (DoH) resolver or a custom DNS library with access to raw DNS response packets can check the AD flag themselves. The `dane.checkDnssecSecure` callback provides a way to integrate this check into the DANE pipeline, allowing mx-connect to skip TLSA lookups for MX hosts whose zones are not DNSSEC-signed. This prevents delivery failures caused by nameservers that return SERVFAIL for TLSA queries on unsigned zones (see [RFC 7672 Section 2.2.2](https://datatracker.ietf.org/doc/html/rfc7672#section-2.2.2) and [DNSSEC-Aware DANE](#dnssec-aware-dane) below).

**Recommendations for production use:**

1. **Use a DNSSEC-validating resolver** - Configure your system to use a resolver that performs DNSSEC validation (e.g., Cloudflare's 1.1.1.1, Google's 8.8.8.8, or a local validating resolver like Unbound)
2. **Use DNS-over-HTTPS (DoH)** - A DoH resolver provides transport security via HTTPS, which protects against on-path attackers (though this is not a substitute for DNSSEC validation)
3. **Use `checkDnssecSecure`** - If your DNS resolver exposes the AD flag (e.g., via DoH raw responses), provide a `checkDnssecSecure` callback to skip TLSA lookups for insecure zones per RFC 7672
4. **Monitor [nodejs/node#57159](https://github.com/nodejs/node/issues/57159)** - When Node.js adds AD flag support, this module will be updated to optionally require DNSSEC validation

For domains with properly configured DNSSEC, DANE provides strong protection against certificate misissuance and man-in-the-middle attacks. For domains without DNSSEC, consider using MTA-STS as an alternative or complementary security mechanism.

### Node.js Version Support

Node.js 22.19.0 or newer is required. The floor comes from `mailauth`, which this package depends on for MTA-STS policy handling.

Native `dns.resolveTlsa`, used for DANE, is available across that whole range:

| Node.js Version | TLSA Support |
| --------------- | ------------ |
| v24.x           | Native       |
| v23.9.0+        | Native       |
| v22.19.0+       | Native       |

**Note:** `dane.enabled` must be set to `true` explicitly to activate DANE. There is no auto-detection. A custom resolver can still be supplied through the `dane.resolveTlsa` option if you want to route TLSA lookups through your own validating resolver.

### Custom TLSA Resolver

For Node.js versions without native TLSA support, you can provide a custom resolver function:

```javascript
const mxConnect = require('mx-connect');

const connection = await mxConnect({
    target: 'user@example.com',
    dane: {
        enabled: true,
        resolveTlsa: customResolveTlsa,
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

### DNSSEC-Aware DANE

[RFC 7672 Section 2.2.2](https://datatracker.ietf.org/doc/html/rfc7672#section-2.2.2) requires SMTP clients to check the DNSSEC validation status of MX host address records before attempting TLSA lookups. If the zone is not DNSSEC-signed ("insecure"), TLSA lookups should be skipped because:

1. Secure TLSA records cannot exist in an unsigned zone
2. Some nameservers for unsigned zones return SERVFAIL for TLSA queries (e.g., Microsoft Exchange Online Protection), which would cause delivery failures

The `checkDnssecSecure` callback enables this check. It receives an MX hostname and should return `{ secure: boolean }` indicating whether the zone is DNSSEC-signed.

```javascript
const mxConnect = require('mx-connect');

const connection = await mxConnect({
    target: 'user@example.com',
    dane: {
        enabled: true,
        resolveTlsa: customResolveTlsa,
        // RFC 7672 Section 2.2.2: Check DNSSEC status before TLSA lookups.
        // Uses the AD (Authenticated Data) flag from the DNS response to
        // determine if the MX host's zone is DNSSEC-signed.
        async checkDnssecSecure(hostname) {
            try {
                // Check A record first (covers most MX hosts)
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

When `checkDnssecSecure` reports that a zone is insecure (`{ secure: false }`), mx-connect skips the TLSA lookup for that MX host and falls back to opportunistic TLS. If the callback itself throws an error (e.g. DNS timeout), the MX is marked as having a DANE lookup failure and the connection is rejected with a temporary error, preserving DANE enforcement across retries. If `checkDnssecSecure` is not provided, the existing behavior is preserved and TLSA lookups are attempted for all MX hosts.

### DANE Verification Flow

When DANE is enabled, the following flow occurs:

1. **DNSSEC Check** (optional): If `checkDnssecSecure` is provided, the DNSSEC validation status of each MX host's A/AAAA records is checked. Hosts in insecure zones (`{ secure: false }`) skip directly to step 5. If the check itself fails (DNS error), the MX is marked as a DANE lookup failure and the connection is rejected with a temporary error
2. **TLSA Lookup**: For hosts in DNSSEC-signed zones (or when `checkDnssecSecure` is not provided), mx-connect resolves TLSA records for each MX hostname (e.g., `_25._tcp.mail.example.com`)
3. **Connection**: A TCP connection is established to the MX server
4. **TLS Upgrade**: When upgrading to TLS (STARTTLS), use the `connection.daneVerifier` function as the `checkServerIdentity` option
5. **Certificate Verification**: The server's certificate is verified against the TLSA records (or opportunistic TLS is used if no TLSA records were found)

`connection.daneVerifier` has the signature `(hostname, cert, chain)`. Node only ever calls `checkServerIdentity` with `(hostname, cert)`, so the leaf certificate alone is checked when it is wired up as shown above - enough for DANE-EE (usage 3) and PKIX-EE (usage 1). To also cover DANE-TA (usage 2) and PKIX-TA (usage 0), call the verifier yourself after the handshake and pass the issuer chain as an **array of `X509Certificate` objects**:

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

Two caveats when relying on DANE:

- Node only invokes `checkServerIdentity` after its own PKIX validation has passed, so with the default `rejectUnauthorized: true` a certificate that fails PKIX is rejected before the DANE verifier ever runs. DANE-EE certificates are frequently self-signed, which is exactly the case PKIX rejects. Set `rejectUnauthorized: false` and treat the verifier's result as the authority.
- Because of the above, when TLSA records are present the verifier's return value is the only thing standing between you and an intercepted connection. Always destroy the socket when it returns an error, as shown.

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

| Usage | Name    | Description                                             | Support Status |
| ----- | ------- | ------------------------------------------------------- | -------------- |
| 0     | PKIX-TA | CA constraint - must chain to specified CA              | Partial\*      |
| 1     | PKIX-EE | Service certificate constraint - must match exactly     | Full           |
| 2     | DANE-TA | Trust anchor assertion - specified cert is trust anchor | Full\*         |
| 3     | DANE-EE | Domain-issued certificate - certificate must match      | Full           |

> **\*Note on DANE-TA and PKIX-TA**: These usage types need the issuer chain, which Node does not pass to a `checkServerIdentity` callback. `createDaneVerifier` accepts an optional `chain` argument (an array of `X509Certificate` objects) to supply it - see [DANE Verification Flow](#dane-verification-flow). Without a chain, only the end-entity certificate is checked and DANE-TA/PKIX-TA records never match.
>
> The pinned certificate must lie on a signature-verified path from the certificate the server presented. A certificate that merely appears in the chain is not accepted: the trust anchor a TLSA record pins is public, so otherwise anyone could present their own certificate with the pinned CA stapled onto the chain.
>
> PKIX-TA (usage 0) remains partial: it does not additionally require PKIX path validation to have succeeded ([RFC 7671 Section 5.1](https://datatracker.ietf.org/doc/html/rfc7671#section-5.1)). [RFC 7672 Section 3.1](https://datatracker.ietf.org/doc/html/rfc7672#section-3.1) makes usages 0 and 1 inapplicable to SMTP in any case - for SMTP, prefer DANE-EE (usage 3).

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
        resolveTlsa: customResolveTlsa,
        checkDnssecSecure: customCheckDnssecSecure // optional, see DNSSEC-Aware DANE
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

// Verify a certificate against TLSA records (with optional chain for DANE-TA)
const result = dane.verifyCertAgainstTlsa(certificate, tlsaRecords, chain);
```

## License

EUPL v1.1 or newer
