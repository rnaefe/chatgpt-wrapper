# Contributing

Small, reproducible fixes are welcome. For a larger feature, open an issue describing the workflow before adding another transport, product surface or dependency.

## Set up

Use Node.js 24+ and pnpm 10:

```sh
git clone https://github.com/rnaefe/chatgpt-wrapper.git
cd chatgpt-wrapper
pnpm install --frozen-lockfile
pnpm browser:install
pnpm check
```

These checks use local fixtures. No ChatGPT account, API key or live prompt is needed. `pnpm format` formats source and documentation. There is no CI workflow; record your local checks in the pull request.

## Find the right package

| Path                                    | Responsibility                                          |
| --------------------------------------- | ------------------------------------------------------- |
| `apps/daemon/src/cli.ts`                | Setup, update, uninstall and diagnostic commands        |
| `apps/daemon/src/client-config.ts`      | Client config parsing, backups and managed entries      |
| `apps/daemon/src/playwright-adapter.ts` | Browser ownership, task execution and image boundaries  |
| `apps/daemon/src/page-engine.ts`        | Provider selectors, readiness and response collection   |
| `packages/contracts`                    | Request schemas and task types                          |
| `packages/core`                         | SQLite queue, events, artifacts, retention and metrics  |
| `packages/validation`                   | Output bounds, code blocks and diff-path checks         |
| `scripts`                               | Distribution bundling and isolated package verification |

The [architecture](docs/ARCHITECTURE.md) explains ownership and data flow.

## Verify a change

```sh
# Focused daemon tests; build first after changing a workspace package
pnpm build
pnpm --filter @chatgpt-wrapper/daemon exec vitest run test/client-config.test.ts

# All formatting, build, types and tests
pnpm check

# CLI, paths, packaging or MCP startup changes
pnpm test:package
```

Add regression coverage for changed behavior. Prefer a test of the failure and expected outcome over an assertion mirroring implementation details. Test config changes in an isolated directory; never modify your normal client config from a test.

Selectors belong in `page-engine.ts`. Reduce a provider layout issue to a small synthetic DOM fixture. Do not copy account pages, private chat history, credentials or session data into fixtures, issues or commits. The real Chromium fixture runs against local HTML.

Live provider checks are explicit and separate: use `verify-browser` only with a session you are authorized to automate. They send prompts to ChatGPT and can consume account limits. State whether evidence came from a fixture or a signed-in browser. Do not add prompt retries, challenge bypasses, stealth plugins, private endpoints or generated-code execution.

## Send a pull request

Keep the change focused. Explain the problem, resulting behavior and verification. Update command help, request schemas and docs together when an interface changes. Preserve unrelated client settings, saved profiles and task history. Run `git diff --check` and review the diff for accidental data before pushing.

Use [private reporting](SECURITY.md) for vulnerabilities.

## Demo video

The separate `video/` package renders the README demo from captured public CLI/MCP output. It is not part of the runtime or npm distribution. See [video instructions](video/README.md) before capturing; a live capture sends a provider prompt, while rendering the existing transcript does not.

## Prepare a release

Update the root package version, changelog and installation examples. Internal workspace packages are bundled into the distribution; they are not published separately. Keep claims about browser support tied to recorded evidence.

```sh
pnpm release:check
npm pack --dry-run --ignore-scripts
```

Review the file list: it must exclude `.env`, `.data`, browser profiles, databases and tests. `pnpm test:package` installs a tarball, checks MCP, updates an idle worker and uninstalls its config in an isolated environment. After publishing, `node scripts/test-package.mjs --registry` repeats the check against the public artifact. Neither package test accesses a provider account.

Publishing is a maintainer action, separate from local verification. See [release history](CHANGELOG.md) and [installation](docs/INSTALLATION.md).
