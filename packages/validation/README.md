# Text validation

For code generation, requires a nonempty fenced code block or unified diff. Checks nonempty text, a 20 MiB output limit, and paths in proposed unified diffs. Rejects absolute paths, parent traversal and paths outside the request's allowlist.

This is not a complete diff parser and does not verify code correctness or acceptance criteria. Results are never executed or applied.
