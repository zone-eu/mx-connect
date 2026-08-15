# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

1. Never use emojis in code, comments, or documentation.
2. Do not include Claude as a co-contributor in commit messages.
3. Use Conventional Commit format for all commit messages.
4. Keep the year in LICENSE up to date.
5. After every code change, run `npm run format` and `npm run lint` before committing.

## Project Overview

mx-connect is a Node.js library that establishes TCP connections to MX (Mail Exchange) servers. It resolves MX records for a domain or email address and attempts connections starting with highest priority servers. Supports unicode hostnames (punycode), IPv4/IPv6, and MTA-STS policy validation.

## Build and Test Commands

```bash
# Run linting and both test suites
npm test

# Run linting
npm run lint

# Run only unit tests
npm run test:unit

# Run only integration tests (needs DNS and outbound HTTPS)
npm run test:integration

# Run a single test file
node --test test/mx-connect-test.js

# Run one test by name
node --test --test-name-pattern='blockedAddressesRecordedOnDelivery' test/resolve-ip-test.js

# Format code
npm run format
```

## Architecture

The main module (`lib/mx-connect.js`) supports both callback and promise APIs:

```javascript
// Promise API
const connection = await mxConnect(options);

// Callback API (also returns promise)
mxConnect(options, (err, connection) => { ... });
```

The module runs connection requests through an async/await pipeline:

```
formatAddress -> resolvePolicy -> resolveMX -> validateMxPolicy -> resolveIP -> getConnection
```

**Core modules in `lib/`:**

- `mx-connect.js` - Entry point; builds delivery object from options, orchestrates the connection pipeline, supports dual callback/promise API
- `format-address.js` - Parses target (domain/email/IP literal), handles punycode conversion
- `resolve-mx.js` - Async DNS MX record resolution with fallback to A/AAAA records
- `resolve-ip.js` - Async resolution of MX hostnames to IPv4/IPv6 addresses (parallel)
- `get-connection.js` - Async iteration through MX hosts attempting TCP connections
- `tools.js` - Shared utilities: `getDnsResolver` (selects the DNS resolver, see below), `isNotFoundError`, IP validation (`isLocal`, `isInvalid`, `checkAddress`)
- `dns-errors.js` / `net-errors.js` - Error code to message mappings

**Key data structure:** The `delivery` object flows through the pipeline, accumulating:

- Parsed domain info (`domain`, `decodedDomain`, `isIp`, `isPunycode`)
- Resolved MX entries (`mx` array with `exchange`, `priority`, `A`, `AAAA`)
- Connection options (`port`, `localAddress`, `dnsOptions`, `mtaSts`)

**MTA-STS integration:** Uses `mailauth` library for policy fetching and MX validation. Policies are cached via user-provided cache handlers.

**Custom DNS resolvers:** `tools.getDnsResolver(dnsOptions)` builds the one resolver the whole pipeline uses, choosing between `dnsOptions.resolveRecords`, the older callback-style `dnsOptions.resolve`, and native `dns.promises`. The user-facing contract for both options, including why the callback form still omits the record type for A lookups, is documented in the README under Custom DNS resolver. TLSA lookups do not go through here; they have their own `dane.resolveTlsa`.

**Async conventions:** All asynchronous code uses async/await. Raw promise primitives are limited to justified boundaries: `new Promise` wrappers where callback-style user APIs (custom DNS resolvers, `connectHook`) or event-based APIs (`net.connect` with timeout race) meet async code, `Promise.all` for parallel fan-out, and the `.then()` bridge in `mx-connect.js` that feeds the public callback API.

## Testing

Tests use the Node.js built-in test runner (`node --test`) with `node:assert`, so there is no test framework dependency. Test files in `test/` follow the pattern `*-test.js` and test each corresponding module in `lib/`.

`test/` is the blocking suite: it covers the socket layer too, against a listener started on a loopback high port, so it needs no network. `test/integration/` covers only what a unit test cannot, real DNS resolution and a real MTA-STS policy fetch, and is run in CI without blocking, because a failure there can equally mean a published record changed.

Tests of the callback API use the runner's callback form, `test('name', (t, done) => ...)`, so an assertion inside a library callback is still attributed to the test.
