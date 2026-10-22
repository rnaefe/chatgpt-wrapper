# Using Wrapper from an MCP client

> **Version 0.6.0:** Includes eleven MCP tools, with `submit_batch`, `get_batch`, selected file attachments, Search research, model selection, conversation continuation and task progress. Provider features remain dependent on the account and browser UI.

Setup registers the server as `wrapper`. Your client discovers its tools after restarting. In Codex, ask explicitly to use Wrapper; tool names may appear with the server prefix.

## Submit and collect a response

Call `submit_task`:

```json
{
  "capability": "code.generate",
  "objective": "Write an exported TypeScript clamp(value, min, max) function. Reject min > max. Return a TypeScript code block and a short usage example.",
  "acceptanceCriteria": ["Reject inverted bounds", "Include a usage example"],
  "timeoutSeconds": 120
}
```

The response contains a task `id`. Call `wait_task` with that ID to await completion for up to 30 seconds without polling; on timeout it returns the current state, and `waitMs: 0` takes an immediate snapshot. `get_task` provides a snapshot with event history. When the task is `COMPLETED`, the result includes `result.text`, artifact IDs, provenance and validation results.

Call `get_status` to inspect provider readiness, supported capabilities, browser state and queue counts without opening the browser.

```json
{ "id": "<task UUID returned by submit_task>" }
```

`get_artifact` accepts an artifact's SHA-256 ID, not the task UUID. Text artifacts return text. Images return MCP image content plus a JSON text block containing `localPath`, `displayMarkdown`, and `downloadMarkdown`. Put both Markdown values directly in the final chat reply: some clients show image tool output only to the agent, so a text acknowledgement alone does not deliver the image to the user.

PNG, JPEG, WebP, GIF and AVIF images are automatically saved with a proper extension under `<DATA_DIR>/image-exports/`. Files use content-addressed names and private permissions. Repeated retrieval reuses the same filename. Exports remain until manually removed, independently of artifact retention. Paths refer to the MCP server host; remote clients must transfer the file to their own accessible workspace before embedding it.

Inline MCP delivery is limited to 10 MiB per artifact. Larger supported images still get a local file and Markdown links, without a base64 image block. If saving fails, inline delivery remains available for images within the limit and the text block reports `IMAGE_EXPORT_FAILED`. Unsupported image export formats retain inline delivery when within the limit; otherwise use authenticated local HTTP retrieval.

## Attach selected files

Use `files` to upload selected code files, PDF, DOCX, text, Markdown, CSV, JSON and other supported source formats. Local paths require explicit absolute roots in the worker's `FILE_INPUT_ROOTS` environment setting. Restart the worker after changing this setting. Wrapper does not scan directories or execute files. Symlinks outside configured roots, hidden files, directories, executables and arbitrary archives are unsupported.

```json
{
  "capability": "code.review",
  "objective": "Review these files together against the requirements.",
  "files": [
    { "source": "path", "path": "/approved/project/src/cache.ts" },
    { "source": "path", "path": "/approved/project/docs/requirements.pdf" }
  ]
}
```

Clients can instead send `{ "source": "base64", "name": "context.txt", "mime": "text/plain", "data": "aGVsbG8=" }`. Filenames must be basenames with supported extensions. Base64, MIME and basic PDF/DOCX header checks do not constitute a document security scan. Files are uploaded to ChatGPT, not parsed or executed locally. The prompt describes only basenames and attachment order, excluding local paths and base64 payloads. Images and files share 8 attachments, 10 MiB each and 20 MiB combined per task. Upload readiness uses visible UI and remains provider dependent.

## Submit and collect batches

`submit_batch` accepts 1–20 ordinary task requests and an optional batch `idempotencyKey`. Tasks and the durable batch record commit together; invalid tasks or conflicting task keys create no partial batch. Task-level idempotency keys are also supported. The existing worker executes one task at a time; batches are independent jobs, not dependency pipelines.

```json
{
  "idempotencyKey": "review-and-research-01",
  "tasks": [
    {
      "capability": "code.review",
      "objective": "Review this implementation: ..."
    },
    {
      "capability": "research.search",
      "objective": "Research the design tradeoffs using primary sources."
    }
  ]
}
```

Save the returned batch `id`. `get_batch` takes `{ "id": "<batch UUID>" }` and returns task results, progress, status `counts` and `terminal`. Use `wait_task` on unfinished task IDs between snapshots; do not resubmit slow batches. Terminal includes failures, so inspect each task status. Retention can remove tasks: `missingTaskIds` lists those tasks and `terminal` remains false; do not wait for expired tasks. The batch disappears when all tasks expire. Batch submission shares the 29 MiB HTTP body limit; split large attachment batches across requests. HTTP routes are `POST /v1/batches` and `GET /v1/batches/:id`.

## Research with sources

```json
{
  "capability": "research.search",
  "objective": "Research this topic, compare the evidence and cite primary sources.",
  "timeoutSeconds": 300
}
```

Research visibly enables ChatGPT's Search tool before submission. If activation cannot be confirmed, it stops with `RESEARCH_UNAVAILABLE` and `NEEDS_HUMAN`; there is no silent fallback to ordinary analysis. The prompt requests citations, and links from the current assistant turn are retained alongside the answer. Responses without valid HTTP(S) source links fail validation. Completed results include `result.sources`, up to 50 deduplicated `{ "url", "title" }` entries. Link extraction does not independently verify source contents or prove claim support. This uses Search rather than the separate Deep Research product. Files, model selection and conversation continuation can be combined with research.

## Select a model or continue a conversation

`model` is the exact visible label in the browser's model picker; Wrapper trims surrounding whitespace, accepts 1–100 characters, and rejects control characters. There is no model enum or default model name.

```json
{
  "capability": "reason.analyze",
  "objective": "Analyze the tradeoffs in this proposal.",
  "model": "<exact visible model label>"
}
```

A completed result may include `result.conversationId` and `result.conversationUrl`. Use the returned conversation ID to submit a follow-up:

```json
{
  "capability": "reason.analyze",
  "objective": "Expand on the second tradeoff from your previous answer.",
  "conversationId": "<conversation UUID from result.conversationId>"
}
```

`conversationId` accepts only a UUID, canonicalized to lowercase, rather than a URL or path. The task ID returned by `submit_task` identifies the queued task; the conversation ID identifies the provider conversation. Omit `conversationId` to start a fresh chat. Omit `model` to keep the browser's current selection. Both fields can be supplied together, and both participate in request idempotency.

If the requested model is unavailable or the conversation cannot be verified, execution fails closed before prompt submission. Wrapper does not fall back to another model, start a replacement conversation, or retry the prompt automatically. Continuity depends on the account's accessible browser UI; local fixtures do not establish live provider availability or successful continuity.

## Follow task progress

Tasks now include an optional `progress` snapshot with `stage`, `message`, `updatedAt` and a monotonically increasing `revision`. Older task records may omit it. `get_task`, `list_tasks` and `wait_task` expose the snapshot; task events also retain the stage history.

Pass the latest `progress.revision` as `afterProgressRevision` to `wait_task` (use `0` when absent):

```json
{ "id": "<task UUID>", "waitMs": 30000, "afterProgressRevision": 0 }
```

The wait returns on a newer stage, any terminal outcome, or timeout. After a nonterminal response, share meaningful `progress.message` changes with the user and continue waiting with the returned revision. Without this parameter, waiting remains terminal-only. A client agent decides whether to display these updates in chat; Wrapper does not insert chat messages itself.

Stages are `queued`, `opening_browser`, `preparing_chat`, `selecting_model`, `preparing_research`, `uploading_images`, `uploading_files`, `submitting_prompt`, `waiting_response`, `receiving_response`, `downloading_images`, `validating`, `saving_result` and `completed`. Model selection and image stages are skipped when unnecessary. `waiting_response` means the submitted user turn was confirmed, not merely that Send was clicked. Stages describe observed activity, not a percentage or completion estimate. Failure or cancellation preserves the last stage; always check the task status.

For terminal monitoring:

```sh
chatgpt-wrapper watch <task-id>
```

The command prints a timestamp, status and stage when they change. It never prints prompts or results. Exit codes are `0` for completion, `1` for another terminal result or connection failure, and `130` when Ctrl+C stops watching. Ctrl+C does not cancel the task. Existing `--data-dir` and `--port` options select the runtime to observe.

## Handle terminal states

| State                 | Client action                                                           |
| --------------------- | ----------------------------------------------------------------------- |
| `COMPLETED`           | Review the returned response before applying anything                   |
| `FAILED`              | Read the error code; inspect or correct the request before resubmitting |
| `CANCELLED`           | Stop polling; execution was cancelled                                   |
| `NEEDS_AUTH`          | Ask the user to run `connect`, then submit a new task explicitly        |
| `NEEDS_HUMAN`         | Ask the user to review the reported browser/verification problem        |
| `BLOCKED_BY_PROVIDER` | Review the provider message and account limits before trying again      |

These states are terminal. Signing in does not replay an interrupted task. Do not submit a duplicate just because a response is slow: inspect the existing task first. `cancel_task` uses the task UUID and may interrupt work already submitted to ChatGPT; it does not remove the conversation from the provider.

## Request boundaries

Image inputs are limited to 8 files, 10 MiB per image and 20 MiB combined per task. Base64 totals are checked before queueing; file and URL totals are checked before browser upload. The HTTP request body limit is 29 MiB to accommodate base64 encoding and task metadata. Generated image downloads stop as soon as an image exceeds 10 MiB.

| Capability        | Result                              | Input images          |
| ----------------- | ----------------------------------- | --------------------- |
| `code.generate`   | Code or diff                        | Optional              |
| `code.review`     | Review text                         | Optional              |
| `reason.analyze`  | Analysis text                       | Optional              |
| `research.search` | Research text and source links      | Optional              |
| `image.generate`  | Generated image                     | Optional references   |
| `image.analyze`   | Description, OCR or comparison text | At least one required |
| `image.edit`      | Edited image                        | At least one required |

Image editing requires an actual output image; a prose description alone fails validation. Image analysis requires nonempty text. These capabilities use the same saved provider session and remain dependent on the controls and features available in that account.

The default deadline is 300 seconds; valid deadlines are 1–1800 seconds. Code generation must return a nonempty fenced code block or unified diff. Validation does not establish correctness or satisfy acceptance criteria on behalf of a reviewer.

`allowedPaths` restricts paths in returned unified diffs. It does not give Wrapper filesystem access, read source files, or apply a patch. Include only the source you intend to send in the objective.

An optional `idempotencyKey` deduplicates an identical request. Reusing it with different arguments is a conflict. Requests contain prompts and may contain image inputs; keep them out of public issue reports unless you have replaced them with a harmless example.

## Images

Local image inputs require `IMAGE_INPUT_ROOTS`; URL inputs require exact HTTPS hosts in `ALLOWED_IMAGE_HOSTS`. See [security boundaries](SECURITY.md). Image generation and extraction depend on controls exposed by the provider UI. For example, submit an edit with an explicitly allowed local reference:

```json
{
  "capability": "image.edit",
  "objective": "Change the sky to sunset colors; preserve the subject and composition.",
  "images": [{ "source": "path", "path": "/absolute/allowed/reference.png" }]
}
```

Use `image.analyze` with the same input shape for OCR, visual descriptions or comparisons. Schema, worker and browser fixtures cover these flows; they do not establish live provider quality or availability.

## Diagnose a failure

`list_errors` returns recent IDs, statuses and error codes without prompt text. `get_metrics` summarizes retained task history; see [metric definitions](OBSERVABILITY.md). For browser errors and sign-in problems, follow [troubleshooting](TROUBLESHOOTING.md).
