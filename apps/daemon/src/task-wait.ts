import type { Store } from "@chatgpt-wrapper/core";
import { terminalStatuses, type Task } from "@chatgpt-wrapper/contracts";

/** Wait on committed task changes, without polling SQLite or replaying requests. */
export function waitForTask(
  store: Store,
  id: string,
  waitMs: number,
  signal?: AbortSignal,
  afterProgressRevision?: number,
): Promise<Task | undefined> {
  const changed = (task: Task) =>
    terminalStatuses.includes(task.status) ||
    (afterProgressRevision !== undefined &&
      (task.progress?.revision ?? 0) > afterProgressRevision);
  const current = store.get(id);
  if (!current || changed(current) || !waitMs || signal?.aborted)
    return Promise.resolve(current);
  return new Promise((resolve) => {
    const finish = (task: Task | undefined) => {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener("abort", abort);
      resolve(task);
    };
    const unsubscribe = store.onTaskChange((task) => {
      if (task.id === id && changed(task)) finish(task);
    });
    const timer = setTimeout(() => finish(store.get(id)), waitMs);
    const abort = () => finish(store.get(id));
    signal?.addEventListener("abort", abort, { once: true });
  });
}
