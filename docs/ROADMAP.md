# Roadmap

Version [0.6.0](https://www.npmjs.com/package/@rnaefe/chatgpt-wrapper/v/0.6.0) adds the capabilities below; the prior public npm release was 0.4.2. The project focuses on a local browser worker and MCP, with Codex as the primary setup target.

## Delivered

- CLI installation without cloning the repository or editing client config by hand.
- Persistent versioned runtime, managed config backups, updates and config-only uninstall.
- Visible sign-in and task windows that close after use; saved-profile reuse.
- Durable SQLite tasks, cancellation, deadline handling and recovery without prompt replay.
- Local duration metrics, error-code queries and configurable terminal-task retention.
- Allowlisted file/URL image inputs, binary MCP image artifacts and bounded output validation.
- npm distribution and isolated package installation/update/uninstall verification.

Live visible coding tasks have passed on macOS. Headless was blocked by provider browser verification. Fault recovery is covered with controlled fixtures. See [browser reliability](BROWSER_RELIABILITY.md) for measured results and limits.

## Version 0.6.0

The release adds selected file attachments, durable batches, Search research, exact visible model selection, conversation continuation and task progress watching. These features have fixture coverage, with visible live checks for model selection, continuation, text/code file attachments and Search. Consult the measured browser results and limits before assuming provider availability.

## Next

1. Measure longer visible sessions and document reconnection behavior over time.
2. Improve diagnostics for provider layout changes using small reproducible fixtures.
3. Expand live image/attachment coverage without collecting private account data.

Windows/Linux acceptance remains unverified and is outside the current work. There are no support or delivery-date commitments for these items.

## Scope

Keep setup and MCP use simple. There is no dashboard, browser extension or CI workflow. Additional transports, providers and product surfaces need a concrete use case before implementation. Stealth, verification bypasses, private endpoints, automatic prompt retries and generated-code execution are outside the project scope.
