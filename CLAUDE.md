# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

1. Never use emojis in code, comments, or documentation.
2. Do not include Claude as a co-contributor in commit messages.
3. Use Conventional Commit format for all commit messages.
4. Keep the year in LICENSE up to date.

## Project Overview

mx-connect is a Node.js library that establishes TCP connections to MX (Mail Exchange) servers. It resolves MX records for a domain or email address and attempts connections starting with highest priority servers. Supports unicode hostnames (punycode), IPv4/IPv6, and MTA-STS policy validation.

## Build and Test Commands

```bash
# Run tests (includes linting + nodeunit tests)
npm test

# Run only linting
npx grunt eslint

# Run only unit tests
npx grunt nodeunit

# Run a single test file
npx nodeunit test/mx-connect-test.js

# Format code
npm run format
```

## Architecture

The main module (`lib/mx-connect.js`) orchestrates a promise chain that processes connection requests:

```
formatAddress -> resolvePolicy -> resolveMX -> validateMxPolicy -> resolveIP -> getConnection
```

**Core modules in `lib/`:**
- `mx-connect.js` - Entry point; builds delivery object from options, orchestrates the connection pipeline
- `format-address.js` - Parses target (domain/email/IP literal), handles punycode conversion
- `resolve-mx.js` - DNS MX record resolution with fallback to A/AAAA records
- `resolve-ip.js` - Resolves MX hostnames to IPv4/IPv6 addresses
- `get-connection.js` - Iterates through MX hosts attempting TCP connections
- `tools.js` - IP validation utilities (local address detection, range checking)
- `dns-errors.js` / `net-errors.js` - Error code to message mappings

**Key data structure:** The `delivery` object flows through the pipeline, accumulating:
- Parsed domain info (`domain`, `decodedDomain`, `isIp`, `isPunycode`)
- Resolved MX entries (`mx` array with `exchange`, `priority`, `A`, `AAAA`)
- Connection options (`port`, `localAddress`, `dnsOptions`, `mtaSts`)

**MTA-STS integration:** Uses `mailauth` library for policy fetching and MX validation. Policies are cached via user-provided cache handlers.

## Testing

Tests use nodeunit framework. Test files in `test/` follow the pattern `*-test.js` and test each corresponding module in `lib/`.
