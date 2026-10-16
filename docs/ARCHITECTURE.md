# ChatGPT Wrapper — Automated Browser Worker Architecture (Experimental)

Status: proposed, unimplemented, subject to provider permission and terms review.
MVP focus: ChatGPT only. User requirement: zero manual handoff after initial authentication.

## Product objective
Expose ChatGPT capabilities as a standalone, client-agnostic tool over MCP and HTTP. Any compatible client—Claude Code, Gemini CLI, Codex, Cursor, scripts, or custom agents—can submit code, reasoning, and image tasks. The wrapper does not orchestrate client agents or own their project workflows. A local headless browser worker is a proposed experimental execution transport.

## Critical feasibility boundary
ChatGPT Plus is not an API entitlement. OpenAI consumer Terms of Use restrict automatic or programmatic extraction of output. A Playwright-based unattended ChatGPT web adapter may conflict with those terms and is unsupported; this design is a technical proposal, **not authorization** to operate it or a promise of reliable access. Do not distribute/enable this adapter without resolving provider permission and legal/terms review. Never bypass anti-bot challenges, CAPTCHAs, rate limits, or account restrictions. An authorized API/local adapter is the production fallback.

## Proposed data flow
Any MCP/HTTP client (agent, IDE, CLI, script, application)
-> MCP Server / loopback HTTP
-> Capability Router
-> Durable Task Queue (SQLite)
-> Browser Worker Manager
-> Playwright + persistent browser profile (headless where permitted)
-> ChatGPT web session (experimental, subject to permission)
-> Completion Detector / Output Extractor
-> Result Normalizer + Artifact Store
-> Validator
-> MCP/HTTP task result or artifact reference -> requesting client

## Product boundary
The wrapper owns task intake, validation, execution transport, status, output normalization and artifact delivery. The client owns prompt planning, agent orchestration, repository editing, applying patches, and downstream execution. Do not add client-specific dependencies or Codex-specific workflow assumptions. MCP and HTTP are first-class interfaces; neither client is privileged.

## Components
### 1. MCP Gateway
Capabilities: code.generate, code.review, reason.analyze, image.generate, image.edit.
Operations: submit_task, get_task, cancel_task, list_tasks, get_artifact.
Asynchronous task IDs and polling; never block an MCP call for a long inference.

### 2. Task Orchestrator
SQLite durable jobs; states QUEUED, WAITING_FOR_WORKER, RUNNING, EXTRACTING, VALIDATING, COMPLETED, FAILED, CANCELLED, NEEDS_AUTH, NEEDS_HUMAN, BLOCKED_BY_PROVIDER. Idempotency keys, bounded retries for safe transient errors, per-account concurrency=1 by default, explicit deadlines. No quota circumvention.

### 3. Browser Worker Manager (experimental)
One isolated Playwright persistent browser context per local user profile. Initial sign-in occurs in a visible browser controlled by the user; never request passwords or export session cookies. Later sessions may run headless if supported and authorized. Handle browser lifecycle, profile locking, crash recovery, navigation timeouts, version compatibility and observable error states. No stealth plugins, fingerprint spoofing, challenge solving or automated account creation. A browser challenge or login expiration pauses the task and requests user intervention rather than bypassing it.

### 4. ChatGPT Adapter (experimental)
Capability negotiation, session readiness, prompt submission, completion detection, extraction of text and user-authorized generated artifacts, structured errors. UI selectors and response formats are volatile; treat changes as adapter errors, not as silent success. Distinguish streaming/incomplete text from completed response. Images require actual artifact retrieval and MIME verification; no fake image URL or textual substitute. Avoid undocumented private APIs.

### 5. Context Packager
Task-specific prompt template, repository context allowlist, file size limits, secret redaction, expected output schema, and acceptance criteria. Do not automatically send private code without user-approved scope.

### 6. Result Normalizer & Artifact Store
Normalized result with task_id, capability, text, files, images, provenance, timestamps, errors, validation report. Store immutable SHA-256 addressed files locally; imported/generated artifacts carry source provenance and content type.

### 7. Validation / Integration
Validate JSON and patch syntax, path allowlist, MIME, file integrity and size. Apply patches only in isolated worktree with explicit policy; never execute model output without authorization.

### 8. Observability
Task history, per-step timings, retry reasons, selector drift, worker health, session status, output validation, manual intervention events. Do not claim access to real Plus quota telemetry. Local task counters are not subscription usage.

## MVP interfaces
HTTP: POST /v1/tasks; GET /v1/tasks/:id; GET /v1/tasks; POST /v1/tasks/:id/cancel; GET /v1/artifacts/:id; GET /health.
MCP: submit_task, get_task, cancel_task, list_tasks, get_artifact.
Worker internal contract: start(task), status(task), cancel(task), collect(task), capabilities().

## Planned repository modules
apps/daemon — MCP and HTTP gateway, worker manager.
apps/dashboard — local status, onboarding, auth-required and blocked-task UI.
packages/contracts — task, result, artifact schemas.
packages/core — durable queue, state machine, scheduler.
packages/adapters — experimental browser adapter and authorized fallback.
packages/validation — patch and image validators.

## Nonfunctional requirements
Local-first; bind loopback; Origin checks and local API auth; encryption or OS permissions for profile; no credential export; safe retention; no central telemetry by default. Browser profiles are sensitive and must not be committed or logged.

## Exit criteria for research spike
Demonstrate a permissioned end-to-end text task with stable completion detection; document ToS review; demonstrate clear NEEDS_AUTH and BLOCKED_BY_PROVIDER behavior; verify artifact integrity for an image task; prove retries do not duplicate jobs. If permission is unavailable, do not enable the browser adapter: keep MCP/queue architecture and use authorized providers.

## Non-goals
No quota bypass, CAPTCHA solving, anti-detection, mass account use, credential harvesting, hidden API exploitation, or misleading claims that Plus includes API access.
