# Automated MVP Roadmap (Proposed)

Goal: any MCP/HTTP client -> task queue -> unattended worker -> validated result -> same client, with no routine copy/paste. Client integrations must remain optional and provider-neutral. The ChatGPT web worker is experimental and cannot be shipped without resolving provider permission and terms constraints.

## Phase 0 — Feasibility gate
- Assess provider terms and obtain authorization for automated ChatGPT web interaction/output extraction.
- Test whether browser UI permits stable text and image artifact completion detection in an authorized environment.
- Define failure states for challenges, session expiration, UI drift and access blocks.
- Decision: if not permitted, keep automatic workflow using official APIs or local models; do not implement evasions.

## Phase 1 — Core infrastructure
- Stable MCP tool server and HTTP endpoints.
- SQLite-backed queue, idempotency, cancellation and crash recovery.
- Typed task/result/artifact schemas; integration tests.

## Phase 2 — Browser worker spike (only if authorized)
- Playwright browser lifecycle and persistent user-owned profile.
- One-time user-initiated interactive sign-in, later unattended/headless execution where supported.
- Capability-specific prompt submission and completion detection.
- Worker error taxonomy; stop on challenge, account block or rate limit.

## Phase 3 — Outputs
- Text and structured code results.
- Artifact capture and image MIME/size/hash validation.
- Diff validation, worktree-safe application policy, result provenance.

## Phase 4 — Agent integration
- Generic MCP and HTTP examples, with optional recipes for Claude Code, Gemini CLI, Codex and other clients.
- Async polling and cancellation.
- Local dashboard for status, onboarding, NEEDS_AUTH, and BLOCKED_BY_PROVIDER.

## Phase 5 — Release
- Security audit, provider permission confirmation, selector drift tests, documentation.
- Installer, smoke tests, telemetry opt-in only.
- No guarantee of ChatGPT Plus capacity, uptime or specific models.

## Current implementation
Only a development-only in-memory HTTP task prototype and schema package exist. No MCP server, Playwright worker, SQLite queue, dashboard or automated ChatGPT execution has been implemented.
