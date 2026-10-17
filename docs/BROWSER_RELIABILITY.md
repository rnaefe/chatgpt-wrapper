# Browser reliability

## Live result — 2026-10-17

The following coding probes ran through MCP, the local queue, a real signed-in Chromium profile, and the response collector. They were not DOM fixtures.

| Mode     | Probe | Result                                                     | End-to-end time |
| -------- | ----- | ---------------------------------------------------------- | --------------- |
| visible  | 1     | PASS — completed TypeScript source                         | 17,073 ms       |
| visible  | 2     | PASS — completed TypeScript source in a fresh conversation | 10,032 ms       |
| headless | 1     | BLOCKED — `NEEDS_HUMAN` / `BROWSER_CHALLENGE`              | 2,014 ms        |

The visible probes used the same browser session. Headless was tested afterwards using the same saved profile, with the visible context closed first. No cookies or profile copies were exported. The headless task stopped before prompt submission; no second headless probe or retry was sent.

This is evidence for this account, browser version, and run, not an uptime or headless-compatibility guarantee. Generated images, uploaded attachments, and long-running reasoning were not part of this live test.

## On-demand browser lifecycle — 0.4.1

Published on npm on 2026-10-17. The registry artifact matched the release integrity value; a clean registry installation, Codex config merge and seven-tool MCP handshake passed.

After changing context lifetime, two visible MCP probes passed in 14,446 ms and 20,127 ms. Each task launched its own context from the saved profile and closed it afterwards. This verifies reopening between tasks for this session. The 0.4.0 npm release still uses the earlier persistent-window behavior.

## Published-package check — 2026-10-17

The public npm artifact matched the published SHA-512 integrity value. `node scripts/test-package.mjs --registry` installed from the registry into a clean temporary environment, configured Codex while preserving another server, and verified seven MCP tools after removing the bootstrap install. This setup used `--skip-login` and did not access an account.

Separately, `npx -y @rnaefe/chatgpt-wrapper@0.4.0 connect --visible` reopened the existing saved profile. A code task through the existing Codex Wrapper integration completed in 11,536 ms and returned the exact requested TypeScript function. This checks saved-session reuse, not a new user sign-in or a replacement of the existing Codex integration.

## Browser runtime change — unreleased

After moving Chromium launch to `playwright-extra` without plugins, the local persistent-context Chromium fixture and all 77 tests passed. A fresh live headless probe on 2026-10-17 remained blocked before submission (`NEEDS_HUMAN` / `BROWSER_CHALLENGE`, 2,018 ms). Changing the launcher did not establish headless provider access.

## Repeat the live check

This command sends up to two small, fixed public TypeScript prompts per mode. Run it only when that provider interaction is authorized. It does not collect repository source or run generated output.

```sh
chatgpt-wrapper stop
chatgpt-wrapper verify-browser --mode both --timeout 90
```

The worker must be idle, with no unfinished tasks. Stopping it closes its managed browser. The verifier refuses to take a profile already owned by another worker and never terminates an existing session automatically. Each test worker owns its own lifecycle and releases the profile before switching modes.

`--mode visible` or `--mode headless` tests a single mode. Use the same `--data-dir` as your installation when it is customized. `--report /absolute/path/report.json` selects a new report path; existing reports are not overwritten.

Reports default to `<data-dir>/verification/<run-id>.json` with mode 600. They contain version, platform, task IDs, timing, check results, and error codes. They omit prompts, response text, session tokens and page snapshots. The tested prompts and responses remain in the normal local task history and in the provider's chat history.

Outcomes:

- `PASS`: both probes completed and returned the exact requested source in a TypeScript code fence.
- `BLOCKED`: login, manual verification, or a provider restriction prevented completion. This is not counted as a passing compatibility check.
- `FAIL`: invalid output, infrastructure failure, or another terminal failure.

The CLI exits nonzero unless all requested modes pass. This makes a blocked headless check visible to a caller without pretending it is a code regression or a successful run.

After verification, reopen the normal visible session:

```sh
chatgpt-wrapper connect --visible
```

## Fault recovery coverage — 0.4.2

On 2026-10-17 the merged 0.4.2 code completed two live visible probes in 10,036 ms and 11,032 ms, reopening and closing the saved profile for each task.

Controlled adapter fixtures cover expired-session redirects, browser verification, interrupted evaluation, manual window closure, and cancellation in both execution modes. Each failure releases the profile and does not replay a prompt; a subsequent explicitly submitted task can proceed. Existing queue integration tests cover deadlines, cancellation and worker restart recovery. These fault tests do not claim a live provider outage, a deliberately expired user session, or extended uptime.

The package smoke test also exercises default Codex setup, idle-worker update and config-only uninstall while preserving another MCP server and saved data.

## Separate fixture coverage

`pnpm check` covers page fixtures, cancellation, task persistence, profile lifecycle, config handling and the real Chromium engine fixture. `pnpm test:package` covers a clean npm install and MCP handshake without an account. Neither substitutes for the explicitly invoked live check above. No CI workflow is installed.
