# Changelog

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
