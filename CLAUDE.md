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
# Run tests (includes linting + nodeunit tests)
npm test

# Run linting
npm run lint

# Run only unit tests
npx grunt nodeunit

# Run a single test file
npx nodeunit test/mx-connect-test.js

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

The module orchestrates a promise chain that processes connection requests:

```
formatAddress -> resolvePolicy -> resolveMX -> validateMxPolicy -> resolveIP -> getConnection
```

**Core modules in `lib/`:**

- `mx-connect.js` - Entry point; builds delivery object from options, orchestrates the connection pipeline, supports dual callback/promise API
- `format-address.js` - Parses target (domain/email/IP literal), handles punycode conversion
- `resolve-mx.js` - Async DNS MX record resolution with fallback to A/AAAA records
- `resolve-ip.js` - Async resolution of MX hostnames to IPv4/IPv6 addresses (parallel)
- `get-connection.js` - Recursive promise-based iteration through MX hosts attempting TCP connections
- `tools.js` - Shared utilities: `getDnsResolver` (promisifies custom DNS resolvers or uses native `dns.promises`), `isNotFoundError`, IP validation (`isLocal`, `isInvalid`)
- `dns-errors.js` / `net-errors.js` - Error code to message mappings

**Key data structure:** The `delivery` object flows through the pipeline, accumulating:

- Parsed domain info (`domain`, `decodedDomain`, `isIp`, `isPunycode`)
- Resolved MX entries (`mx` array with `exchange`, `priority`, `A`, `AAAA`)
- Connection options (`port`, `localAddress`, `dnsOptions`, `mtaSts`)

**MTA-STS integration:** Uses `mailauth` library for policy fetching and MX validation. Policies are cached via user-provided cache handlers.

**Custom DNS resolvers:** The library accepts callback-style custom resolvers via `dnsOptions.resolve`. These are automatically promisified internally. When no custom resolver is provided, native `dns.promises` is used.

## Testing

Tests use nodeunit framework. Test files in `test/` follow the pattern `*-test.js` and test each corresponding module in `lib/`. Integration tests are in `test/integration/`.
