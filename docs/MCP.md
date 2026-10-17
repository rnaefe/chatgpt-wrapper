# Using Wrapper from an MCP client

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

The response contains a task `id`. Call `get_task` with that ID while its state is `QUEUED`, `RUNNING` or `VALIDATING`. Wait between polls. A `COMPLETED` response includes `result.text`, artifact IDs, provenance and validation results.

```json
{ "id": "<task UUID returned by submit_task>" }
```

`get_artifact` accepts an artifact's SHA-256 ID, not the task UUID. Text artifacts return text; images use MCP image content. MCP delivery is limited to 10 MiB per artifact. Larger artifacts require authenticated local HTTP retrieval.

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

Capabilities are `code.generate`, `code.review`, `reason.analyze` and `image.generate`. The default deadline is 300 seconds; valid deadlines are 1–1800 seconds. Code generation must return a nonempty fenced code block or unified diff. Validation does not establish correctness or satisfy acceptance criteria on behalf of a reviewer.

`allowedPaths` restricts paths in returned unified diffs. It does not give Wrapper filesystem access, read source files, or apply a patch. Include only the source you intend to send in the objective.

An optional `idempotencyKey` deduplicates an identical request. Reusing it with different arguments is a conflict. Requests contain prompts and may contain image inputs; keep them out of public issue reports unless you have replaced them with a harmless example.

## Images

Local image inputs require `IMAGE_INPUT_ROOTS`; URL inputs require exact HTTPS hosts in `ALLOWED_IMAGE_HOSTS`. See [security boundaries](SECURITY.md). Image generation and extraction depend on controls exposed by the provider UI and were not covered by the live code probes.

## Diagnose a failure

`list_errors` returns recent IDs, statuses and error codes without prompt text. `get_metrics` summarizes retained task history; see [metric definitions](OBSERVABILITY.md). For browser errors and sign-in problems, follow [troubleshooting](TROUBLESHOOTING.md).
