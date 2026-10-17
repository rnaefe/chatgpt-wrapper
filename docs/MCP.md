# Using Wrapper from an MCP client

> **Published v0.4.2 vs development source:** The npm release provides `submit_task`, `get_task`, `list_tasks`, `cancel_task`, `get_artifact`, `get_metrics` and `list_errors`. This guide also documents `wait_task`, `get_status` and image analysis/editing present in the development source; those additional tools may not be in your installed version. For v0.4.2, use `get_task` to check progress after `submit_task`.

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

The response contains a task `id`. In the published v0.4.2 release, call `get_task` with that ID to check the status and retrieve its event history. When the task is `COMPLETED`, the result includes `result.text`, artifact IDs, provenance and validation results. In the development source, `wait_task` can await completion for up to 30 seconds without polling; on timeout it returns the current state, and `waitMs: 0` takes an immediate snapshot.

Call `get_status` to inspect provider readiness, supported capabilities, browser state and queue counts without opening the browser.

```json
{ "id": "<task UUID returned by submit_task>" }
```

`get_artifact` accepts an artifact's SHA-256 ID, not the task UUID. Text artifacts return text. Images return MCP image content plus a JSON text block containing `localPath`, `displayMarkdown`, and `downloadMarkdown`. Put both Markdown values directly in the final chat reply: some clients show image tool output only to the agent, so a text acknowledgement alone does not deliver the image to the user.

PNG, JPEG, WebP, GIF and AVIF images are automatically saved with a proper extension under `<DATA_DIR>/image-exports/`. Files use content-addressed names and private permissions. Repeated retrieval reuses the same filename. Exports remain until manually removed, independently of artifact retention. Paths refer to the MCP server host; remote clients must transfer the file to their own accessible workspace before embedding it.

Inline MCP delivery is limited to 10 MiB per artifact. Larger supported images still get a local file and Markdown links, without a base64 image block. If saving fails, inline delivery remains available for images within the limit and the text block reports `IMAGE_EXPORT_FAILED`. Unsupported image export formats retain inline delivery when within the limit; otherwise use authenticated local HTTP retrieval.

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

Capabilities are:

| Capability       | Result                              | Input images          |
| ---------------- | ----------------------------------- | --------------------- |
| `code.generate`  | Code or diff                        | Optional              |
| `code.review`    | Review text                         | Optional              |
| `reason.analyze` | Analysis text                       | Optional              |
| `image.generate` | Generated image                     | Optional references   |
| `image.analyze`  | Description, OCR or comparison text | At least one required |
| `image.edit`     | Edited image                        | At least one required |

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
