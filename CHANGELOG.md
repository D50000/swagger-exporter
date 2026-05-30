# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.1] - 2026-05-31

### Fixed
- **Bypass User-Agent Blocks**: Set a standard Chrome browser `User-Agent` header for all requests to bypass WAF/firewall blocks (returning 403 Forbidden) on strict web servers.
- **Dynamic Token Fallback**: Added automatic fallback to retry fetching Swagger UI HTML without a Bearer token if the initial request returns a 401 or 403. Once HTML is obtained and the spec URL is parsed, the token is reapplied for fetching the spec JSON/YAML.

---

## [1.1.0] - 2026-05-29

### Added
- **Dynamic Spec Extraction**: Parse HTML script tags to dynamically extract the exact path of `swagger-initializer.js` (supporting setups where Swagger assets are deployed in subfolders like `public/swagger-ui/`).
- **Default Output Note**: Added clear documentation showing where output Excel workbooks are saved by default (`./archived/` folder).
- **Better Documentation**: Restructured the installation manual to feature A (npx), B (global install), and C (source dev) methods. Replaced references of `node exporter.js` with the binary command `openapi-to-xlsx` in execution examples.

---

## [1.0.1] - 2026-05-28

### Added
- Initial public release on npm as `openapi-to-xlsx`.
- Enforced GNU GPLv3 license compliance.
- Supported direct Swagger UI webpage parsing, custom output path specification, SSL verification bypass, and token authentication.
