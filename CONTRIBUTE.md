# Contributing to InfluxDB 3 MCP Server

Thank you for your interest in contributing to the InfluxDB 3 MCP Server!
This project provides official Model Context Protocol (MCP) integration
for InfluxDB.

## Current Status

**We are not currently accepting external contributions to this
repository.**

## Future Contributions

We plan to open this project for community contributions in the future.
When we do, we will update this document with:

- Code contribution guidelines
- Development setup instructions
- Testing requirements
- Pull request process
- Code style and standards
- Issue reporting guidelines

## Development Setup

Install [lefthook](https://lefthook.dev/) and run `lefthook install` once.
The pre-commit hook runs `node scripts/check-claim-policy.js`, which CI also
runs on every pull request.

Runtime text (`src/`, `context/`, `schemas/`, `README.md`, and the shipped
docs) states facts with their edition and version and never carries a claim
ID. Cite claim IDs only in `CHANGELOG.md`, `docs/adr/`, and e2e results. No
file may name a path in docs-tooling's research tree.

## Questions and Feedback

If you have questions about the InfluxDB 3 MCP Server or feedback on its
functionality, please check the [README.md](README.md) for usage instructions and examples

## License

By contributing to this project (when contributions are accepted), you
agree that your contributions will be licensed under the Apache 2.0 & MIT License.

---

_This document will be updated when we begin accepting contributions._
