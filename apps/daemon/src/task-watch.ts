import { terminalStatuses, type Task } from "@chatgpt-wrapper/contracts";

export type WatchApi = (
  path: string,
  body?: unknown,
  timeoutMs?: number,
  signal?: AbortSignal,
) => Promise<Response>;

export function validateWatchTaskId(id: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error("watch requires a UUID task ID.");
}

function singleLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

/** Observe a task without exposing its request, result, or error message. */
export async function watchTask(
  id: string,
  options: {
    api: WatchApi;
    write: (line: string) => void;
    signal?: AbortSignal;
    now?: () => Date;
  },
): Promise<number> {
  validateWatchTaskId(id);
  const { api, write, signal } = options;
  const now = options.now ?? (() => new Date());
  let previous: string | undefined;
  let revision = 0;
  let path = `/v1/tasks/${id}`;
  try {
    while (!signal?.aborted) {
      const task = (await (
        await api(path, undefined, 35_000, signal)
      ).json()) as Task;
      if (signal?.aborted) return 130;
      revision = task.progress?.revision ?? 0;
      const key = `${task.status}:${revision}`;
      if (key !== previous) {
        const progress = task.progress
          ? ` ${singleLine(task.progress.stage)}: ${singleLine(task.progress.message)}`
          : "";
        const code = task.error ? ` error=${singleLine(task.error.code)}` : "";
        write(`${now().toISOString()} ${task.status}${progress}${code}`);
        previous = key;
      }
      if (terminalStatuses.includes(task.status))
        return task.status === "COMPLETED" ? 0 : 1;
      path = `/v1/tasks/${id}/wait?waitMs=30000&afterProgressRevision=${revision}`;
    }
    return 130;
  } catch {
    if (signal?.aborted) return 130;
    write(`${now().toISOString()} WATCH_ERROR`);
    return 1;
  }
}
