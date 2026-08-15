# Changelog

## [2.0.0](https://github.com/zone-eu/mx-connect/compare/v1.7.0...v2.0.0) (2026-08-15)


### ⚠ BREAKING CHANGES

* Node.js 22.19.0 or newer is now required. The previous range claimed 14 and above, which no longer holds once mailauth is up to date.

### Features

* **dns:** accept a promise-based custom DNS resolver ([4cf3466](https://github.com/zone-eu/mx-connect/commit/4cf346622cbae7d22c49c3b56d828af8d50e3f8c))
* **dns:** accept a promise-based custom DNS resolver ([a85d4cd](https://github.com/zone-eu/mx-connect/commit/a85d4cd873f517cc573b05fe391f647538e161a1))
* **dns:** allow declaring local NAT64 prefixes ([202a5dd](https://github.com/zone-eu/mx-connect/commit/202a5dd52ff43769af0c6acfb745aa68fb298485))
* **dns:** validate IPv4 addresses carried by IPv6 transition addresses ([e452eec](https://github.com/zone-eu/mx-connect/commit/e452eec43753de64564c83ab71dbc1730831996b))
* require Node 22.19.0 and refresh dependencies ([fdded42](https://github.com/zone-eu/mx-connect/commit/fdded42a19e829839f96a68e76c336b77a88939d))
* validate every connection address, migrate internals to async/await ([aa9129a](https://github.com/zone-eu/mx-connect/commit/aa9129a05500da4c135c8341a66444476e103532))


### Bug Fixes

* **dns:** enforce ignoreIPv6 for every address, not just lookups ([30a0028](https://github.com/zone-eu/mx-connect/commit/30a002838db270693e5ff3ec33fbd051111900ba))
* **dns:** give an address lookup failure one wording ([a1c041a](https://github.com/zone-eu/mx-connect/commit/a1c041a08b3a34436e8dd486f46f76e46518e48e))
* **dns:** keep judging the address a declared NAT64 prefix matches ([10fe9b2](https://github.com/zone-eu/mx-connect/commit/10fe9b2887664ecb55b0a6ebebf79f27cee4f54c))
* **dns:** let a declared prefix cover the RFC 8215 NAT64 range ([776c6f7](https://github.com/zone-eu/mx-connect/commit/776c6f7281c7c17aff7579030043707fe53eb1dc))
* **dns:** report an IPv6-only host accurately under ignoreIPv6 ([64f145f](https://github.com/zone-eu/mx-connect/commit/64f145f154b76b4737f2726857c48a5bf4dd54c0))
* **dns:** validate only canonical IP literals ([e6c928d](https://github.com/zone-eu/mx-connect/commit/e6c928d34cafa72f80a42cadb4f7fcd8d1cb1d55))
* **npm:** publish only lib, not the whole repository ([55b23ab](https://github.com/zone-eu/mx-connect/commit/55b23ab2959433d6846b860ec1464c2900f49f94))
* prevent unhandled socket error events and crashes on malformed MX responses ([b2d7892](https://github.com/zone-eu/mx-connect/commit/b2d7892b424767ee2a121f54025d87298c3803e7))
* **resolve-ip:** tolerate MX entries without address arrays ([d8fbead](https://github.com/zone-eu/mx-connect/commit/d8fbead9b290534fdffa63803212d3e2fb3475ab))

## [1.7.0](https://github.com/zone-eu/mx-connect/compare/v1.6.0...v1.7.0) (2026-07-21)


### Features

* harden MX IP validation and reject null MX (RFC 7505) ([39fb745](https://github.com/zone-eu/mx-connect/commit/39fb745d2c9ac489eca26468a75590539606e727))
* harden MX IP validation and reject null MX (RFC 7505) ([84a33d5](https://github.com/zone-eu/mx-connect/commit/84a33d5b08f5788189f417fd6a2e0d09d57d9fbc))
* skip TLSA lookups for non-DNSSEC zones per RFC 7672 Section 2.2.2 ([1f2759a](https://github.com/zone-eu/mx-connect/commit/1f2759a148459720376a05d3c95e176ae403ff9e))
* skip TLSA lookups for non-DNSSEC zones per RFC 7672 Section 2.2.2 ([a3bbd4f](https://github.com/zone-eu/mx-connect/commit/a3bbd4fe0a13c9c9c2673c071344ee521db308f0))


### Bug Fixes

* `extractSPKI()` always returns `null`, silently breaking DANE/TLSA ([4f7685d](https://github.com/zone-eu/mx-connect/commit/4f7685debf85851518a76d537574ec6950487585))
* **dane:** extractSPKI returned raw public key instead of SPKI DER ([1bf0f1d](https://github.com/zone-eu/mx-connect/commit/1bf0f1dc463512059e570ee6cd52f3e60e18379c))
* **dane:** handle JSON-deserialized Buffer in TLSA record cert field ([d3b4ed9](https://github.com/zone-eu/mx-connect/commit/d3b4ed9d575e693e64e5cd076e45f63ed9965404))
* **dane:** harden DNS error handling, pass cert chain, update docs ([28bd488](https://github.com/zone-eu/mx-connect/commit/28bd488bfc1e9c7ab305c5dc4433781001fff1db))
* **dane:** harden DNS error handling, verify TA chain linkage, drop verify opt-out ([90865ab](https://github.com/zone-eu/mx-connect/commit/90865abcfaae5a6524d149c6cbdf409ad469e222))
* **dane:** harden DNS error handling, verify TA chain linkage, drop verify opt-out ([c111ee8](https://github.com/zone-eu/mx-connect/commit/c111ee8e9ce8ea1ccab4cc967fd6880512078db8))
* **dns:** unwrap IPv4-mapped IPv6 and narrow null MX rejection ([b7836a3](https://github.com/zone-eu/mx-connect/commit/b7836a369fa83c6bd235260f8b0d9b075530a347))
* **dns:** unwrap IPv4-mapped IPv6 and narrow null MX rejection ([7f6d0ee](https://github.com/zone-eu/mx-connect/commit/7f6d0ee98a9cd9f16b8406f7bf8a080f95ab2409))
* fixed linting ([90d2af2](https://github.com/zone-eu/mx-connect/commit/90d2af2118a1ea1782eb83cbf403f3f9076ccb61))
* **test:** log unexpected errors in DANE SERVFAIL memory leak scenario ([c534bf4](https://github.com/zone-eu/mx-connect/commit/c534bf477de5426714b6fddf24905617eef9dbfe))

## [1.6.0](https://github.com/zone-eu/mx-connect/compare/v1.5.6...v1.6.0) (2026-02-11)


### Features

* add DANE/TLSA support for outbound SMTP connections ([8705f72](https://github.com/zone-eu/mx-connect/commit/8705f72f0a8849db51c3ba560f53ea9408cb4499))
* add DANE/TLSA support for outbound SMTP connections ([dd8525b](https://github.com/zone-eu/mx-connect/commit/dd8525b9a04aded9d5f1e11dfa265258f3670bbf))


### Bug Fixes

* add engines field requiring Node.js 14+ ([56ebbfc](https://github.com/zone-eu/mx-connect/commit/56ebbfcb34ee4eb76f6afb130484f78e59f89115))
* address code review feedback for DANE/TLSA support ([e1f4c7f](https://github.com/zone-eu/mx-connect/commit/e1f4c7f12a15d1ae0cb670750db2b282171e7a00))
* **dane:** address post-merge issues in DANE/TLSA implementation ([a000cdc](https://github.com/zone-eu/mx-connect/commit/a000cdc1c02fc38f57fd19567f2baa0f3bac41f9))
* **dns-errors:** correct EOF error code and improve descriptions ([5899eef](https://github.com/zone-eu/mx-connect/commit/5899eef85c6517a0112b594240f5f5e23ec747bb))
* **get-connection:** destroy socket on connection error to prevent handle leak ([bd3e8f5](https://github.com/zone-eu/mx-connect/commit/bd3e8f58b93dfe7f6cae1e7309710721131b60a3))
* **net-errors:** update error codes and descriptions from libuv ([36beca2](https://github.com/zone-eu/mx-connect/commit/36beca25597f334593e120b79693795cc80b9965))
* use userland punycode and fix preferIPv6 sort ([68ae733](https://github.com/zone-eu/mx-connect/commit/68ae73332eb53fbe1200edabfd1f3be1a57d0fac))

## [1.5.6](https://github.com/zone-eu/mx-connect/compare/v1.5.5...v1.5.6) (2025-04-20)


### Bug Fixes

* handle edge case errors ([7feea75](https://github.com/zone-eu/mx-connect/commit/7feea75fdfb0ed46ff5e8356d8922b2d08b234f7))

## [1.5.5](https://github.com/zone-eu/mx-connect/compare/v1.5.4...v1.5.5) (2024-07-01)


### Bug Fixes

* **Exception:** Fixed exception on throwing an error ([21f9333](https://github.com/zone-eu/mx-connect/commit/21f9333c4eed03859432ddc4d5fb87045f2f6539))

## [1.5.4](https://github.com/zone-eu/mx-connect/compare/v1.5.3...v1.5.4) (2024-05-13)


### Bug Fixes

* **deps:** Bumped deps to clear security warnings ([d2efd6a](https://github.com/zone-eu/mx-connect/commit/d2efd6a8775ea76a2fcbf2e06aa6f093964ae000))

## [1.5.3](https://github.com/zone-eu/mx-connect/compare/v1.5.2...v1.5.3) (2024-01-19)


### Bug Fixes

* **typo:** Fixed typo in network error response ([2d3616d](https://github.com/zone-eu/mx-connect/commit/2d3616dff1d91c587f69d9c1ea9798e87b0cd56b))

## [1.5.2](https://github.com/zone-eu/mx-connect/compare/v1.5.1...v1.5.2) (2024-01-19)


### Bug Fixes

* **errors:** normalized error categories ([f4e7173](https://github.com/zone-eu/mx-connect/commit/f4e71738b4b19c564aebba30e8976f58bde889ab))

## [1.5.1](https://github.com/zone-eu/mx-connect/compare/v1.5.0...v1.5.1) (2024-01-19)


### Bug Fixes

* **autodeploy:** Fixed dependency retrieval ([c3b26ba](https://github.com/zone-eu/mx-connect/commit/c3b26ba527aaa4b18a9f662ea874e7275b09e4c4))

## [1.5.0](https://github.com/zone-eu/mx-connect/compare/v1.4.4...v1.5.0) (2024-01-19)


### Features

* **autodeploy:** Enabled auto-deployment. Updated response errors ([324c021](https://github.com/zone-eu/mx-connect/commit/324c021670e288f4188b95e9714bc1372c0622e2))
