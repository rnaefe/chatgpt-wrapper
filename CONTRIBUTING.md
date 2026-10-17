# Contributing

Use Node.js 24 or newer and pnpm 10.

```sh
pnpm install
pnpm browser:install
pnpm check
```

`pnpm check` checks formatting, builds the project, checks types, and runs tests. `pnpm format` formats source and documentation.

Keep changes focused. Explain the problem, the resulting behavior, and how you tested it. Add tests for changed behavior; avoid tests that only restate the implementation.

Browser selectors belong in `apps/daemon/src/page-engine.ts`. Use a minimal DOM fixture when fixing a layout change. Never include account pages, credentials, chat history, browser profiles, or runtime data in fixtures or issues. The real Chromium test runs against local fixture HTML.

Live provider tests are manual and separate from local fixture tests. Report whether a result came from a fixture or a signed-in browser. Do not add automatic prompt retries, challenge bypasses, stealth plugins, private endpoints, source collection, or generated-code execution.

This project currently has only a headless browser worker and MCP. Please discuss new transports or product surfaces before adding them.

Run `pnpm test:package` after changing runtime paths, CLI setup, npm packaging or MCP startup. It tests a tarball installation and MCP handshake without using a provider account. Keep user-facing release status in CHANGELOG.md and docs/INSTALLATION.md accurate; do not publish during local verification.
