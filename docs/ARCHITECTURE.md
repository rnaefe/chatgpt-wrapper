# ChatGPT Wrapper — MVP Architecture

Status: Proposed architecture (documentation only)
Date: 2026-10-16
Repository: rnaefe/chatgpt-wrapper

## 1. Vision

Build an open-source, local-first bridge that lets developer tools and AI agents delegate code generation, image generation, and reasoning tasks to capabilities a user already accesses in ChatGPT. Start with ChatGPT, but keep transport and provider boundaries replaceable.

**Important product constraint:** ChatGPT Plus is not a general-purpose API subscription. Automating extraction of ChatGPT web output is restricted by OpenAI consumer Terms of Use. The MVP must not claim unattended ChatGPT web inference, scrape private endpoints, collect session cookies, bypass quotas, or impersonate an official integration. The ChatGPT web transport is user-mediated unless an authorized programmatic integration becomes available.

## 2. MVP goals and exclusions

### In scope
- Local MCP server exposing capability-based tools.
- Local HTTP task API for non-MCP clients.
- Code generation, code review, reasoning, image generation and image-edit request envelopes.
- User-mediated ChatGPT web handoff: compose prompt, open/copy, manually import result/artifact.
- Persistent queue, task history, cancellation, timeout, validation and provenance.
- Unified file/patch/image artifact contracts.
- Optional automated adapter using an authorized API or local model, strictly opt-in.
- Public open-source distribution; no hosted account service needed.

### Out of scope
- Automated ChatGPT web UI scraping or undocumented endpoint calls.
- Guaranteed Plus quotas, model selection or image extraction.
- Full Codex replacement or autonomous shell execution.
- Billing, centralized user accounts, cloud sync, multi-provider routing optimization.

## 3. Architecture

Client (Codex / Claude Code / IDE / custom agent)
  -> MCP Server or Local HTTP API
  -> Capability Router
  -> Task Orchestrator / SQLite durable queue
  -> Context Packager + Redaction
  -> Provider Adapter
     -> ChatGPT Web Handoff (user-controlled)
     -> Authorized API Adapter (optional)
     -> Local Model Adapter (optional)
  -> Result Import / Normalizer
  -> Artifact Store
  -> Validator (schema / patch / MIME / scope)
  -> Task Result back to client

The bridge is **local-first**: binds to loopback by default, does not centralize credentials, and stores artifacts on the user's machine.

## 4. Component responsibilities

### MCP Server
Tools: `submit_task`, `get_task`, `list_tasks`, `cancel_task`, `get_artifact`, `import_result`.
Tool calls return task IDs promptly. Polling avoids long-lived MCP timeouts. Capability names are stable, independent of provider/model.

### Local HTTP API
`POST /v1/tasks`, `GET /v1/tasks/:id`, `GET /v1/tasks`, `POST /v1/tasks/:id/cancel`, `POST /v1/tasks/:id/results`, `GET /v1/artifacts/:id`, `GET /health`.
Local API uses a generated secret or local OS access controls. No unauthenticated LAN exposure.

### Capability Router
Selects a compatible adapter by requested capability, explicit user preference, supported input/output types, and authorization. Never silently substitute an unavailable capability. Report unsupported features explicitly.

### Task Orchestrator
Persists state, enforces bounded queue sizes and concurrency, handles retries only for transient transport errors, and never duplicates a task automatically after an uncertain completion.

### Context Packager
Uses explicit file allowlists, byte limits and secret detection. Generates a self-contained prompt with objective, constraints, acceptance criteria and output contract. Sensitive source files require explicit user review before handoff.

### ChatGPT Web Handoff
Presents task packages in a local dashboard. User opens ChatGPT, submits the prompt, then imports copied text, downloaded image or patch. No automatic DOM reading, cookie extraction, browser profile cloning or programmatic ChatGPT response harvesting. Selected ChatGPT model/mode is user-controlled and not verifiable by the bridge.

### Artifact Store
Stores immutable content-addressed artifacts under a local application data directory; SQLite holds metadata and references. Supported types: text, JSON, unified diff, source file, PNG/JPEG/WebP. Validate MIME, size, hash, origin and filesystem path before consumption.

### Validation
Code: schema, permitted file paths, patch syntax, git apply --check, targeted tests in isolated worktree when requested. Image: MIME, dimensions, file integrity, size. Never execute imported code automatically; test execution requires explicit policy/approval.

## 5. Data contracts

Task:
- id, capability, objective, input references, context references
- output format, acceptance criteria, allowed paths
- adapter, state, timestamps, deadline, retry count
- provenance, error code, artifact IDs

Result:
- task_id, status, output artifacts, summary, assumptions, warnings
- provenance: user_imported | authorized_api | local_model
- validation report and integration readiness

Task states:
CREATED -> PACKAGED -> AWAITING_USER -> RUNNING_EXTERNAL -> RESULT_IMPORTED -> VALIDATING -> COMPLETED.
Terminal alternatives: FAILED, CANCELLED, TIMED_OUT, REJECTED.
`RUNNING_EXTERNAL` is advisory for manual ChatGPT handoff, not automatically observed.

## 6. Capability definitions

- `code.generate`: source files or unified diff; file allowlist mandatory for patch application.
- `code.review`: structured findings with severity and file/line references where provided.
- `reason.analyze`: text or validated JSON response.
- `image.generate`: user-imported image artifact and metadata.
- `image.edit`: user-supplied source image, requested edit, imported result.

Do not expose tool calling or streaming as supported for manual ChatGPT transport. Streaming is adapter-dependent. Image generation success requires a real imported image, not a textual description.

## 7. Repository layout (planned; no implementation in this document)

- `docs/ARCHITECTURE.md` — this document
- `docs/PROTOCOL.md` — task, result and artifact schemas
- `docs/SECURITY.md` — trust boundaries and threat model
- `docs/ROADMAP.md` — implementation milestones
- `apps/daemon/` — local runtime, HTTP and MCP
- `apps/dashboard/` — task handoff and import UI
- `packages/contracts/` — shared types and schemas
- `packages/core/` — orchestration, routing and storage
- `packages/adapters/` — replaceable transport adapters
- `packages/validation/` — artifact and patch checks

## 8. Technology decisions

- TypeScript monorepo with pnpm.
- Node.js LTS, Fastify for HTTP, official MCP TypeScript SDK.
- SQLite with WAL for durable local task state.
- Zod for input/output schema validation.
- React + Vite for local dashboard.
- Filesystem-backed artifact store with SHA-256 references.
- Vitest for contract, queue and adapter tests.

Avoid Redis, Kubernetes, hosted infrastructure and a mandatory browser extension in the MVP.

## 9. Security and privacy

Trust boundaries: untrusted agent prompts, untrusted imported model outputs, user repository, local daemon, external provider. Treat imported output as data until validated. Default deny shell execution and filesystem writes outside approved worktree. Redact secrets; never collect ChatGPT passwords, session tokens or cookies. Bind loopback; protect HTTP endpoints against cross-origin and DNS rebinding attacks. Keep telemetry off by default. Store provenance and user consent for external sharing. Provide deletion and retention controls.

## 10. Reliability and observability

Track task latency, queue time, completion/failure rate, manual handoff duration, adapter failures and artifact validation errors. Usage counters are **local task counts**, not actual ChatGPT subscription quotas. No fabricated token usage, model identity or quota remaining. Support crash recovery, idempotency keys and bounded retention.

## 11. Delivery phases

**P0 — Contracts:** define capability schema, task state machine, error taxonomy and threat model.
**P1 — Local daemon:** MCP, HTTP, SQLite queue, local dashboard and task history.
**P2 — ChatGPT handoff:** prompt packaging, user-controlled transfer, result import and artifact storage.
**P3 — Validation:** patch/image validation, safe worktree integration and provenance.
**P4 — Optional automation:** authorized API/local-model adapter with identical contracts.
**P5 — Public release:** installers, documentation, security review, tests and sample integrations.

## 12. Acceptance criteria for MVP

1. An MCP client submits a code task and receives a durable task ID.
2. User can transfer the task to ChatGPT and import a result.
3. A validated patch is returned as an artifact; invalid or out-of-scope patches are rejected.
4. User can request an image and import a genuine image artifact.
5. Tasks survive daemon restart and can be cancelled.
6. The bridge never requires ChatGPT credentials or claims unattended Plus inference.
7. Public documentation clearly distinguishes user-mediated ChatGPT from authorized automatic adapters.

## 13. Open decisions

- Product name and npm package scope.
- GPL-3.0 retention versus relicensing (requires rights review).
- CLI-only versus dashboard-first onboarding.
- Whether to add a browser extension limited to user-initiated handoff.
- Explicit permission/authorization requirements before any future automatic ChatGPT integration.

## 14. References

- OpenAI consumer Terms of Use: https://openai.com/en-GB/policies/row-terms-of-use/
- OpenAI Service Terms: https://openai.com/en-GB/policies/service-terms/

This architecture is a proposed product specification, not a claim that ChatGPT Plus supports programmatic access.
