# Security policy

## Supported versions

Only the latest version in the Firefox Add-ons store and the Chrome
Web Store gets security fixes.

## Reporting a vulnerability

Please report it privately, not in a public issue:

- email [sebastian@nuez.no](mailto:sebastian@nuez.no), or
- use [Report a vulnerability](https://github.com/ikkeseb/brreg-snap/security/advisories/new)
  on GitHub.

Say what you found, the browser and extension version, and how to
reproduce it. brreg-snap has one maintainer, so expect a reply within
a week. A fix ships in a store release, and the report is credited in
the changelog if you want.

## Scope

The [security model](README.md#security-model) is the product, so
these are in scope:

- a way around the declared permissions, or a permission the
  extension uses without declaring it
- a way around the Content Security Policy, or code that runs from
  anywhere but the package
- text from the brreg API, a page address or a page title that ends up
  as markup or script
- any data sent anywhere but `data.brreg.no`, or more than
  [PRIVACY.md](PRIVACY.md) says is sent

Out of scope: wrong or outdated data in the register itself (report
that to Brønnøysundregistrene), and issues in the browsers or the
stores.
