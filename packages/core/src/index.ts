import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  terminalStatuses,
  type Task,
  type TaskRequest,
  type TaskStatus,
  type Artifact,
  type TaskEvent,
} from "@chatgpt-wrapper/contracts";

const DEFAULT_TASK_LIMIT = 50;
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{64}$/;
const RECOVERABLE_STATUSES = ["RUNNING", "VALIDATING"] as const;
const ALLOWED_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  QUEUED: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: [
    "VALIDATING",
    "FAILED",
    "CANCELLED",
    "NEEDS_AUTH",
    "NEEDS_HUMAN",
    "BLOCKED_BY_PROVIDER",
  ],
  VALIDATING: ["COMPLETED", "FAILED", "CANCELLED"],
};

export class ConflictError extends Error {}

export class Store {
  private readonly db: DatabaseSync;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    mkdirSync(join(directory, "artifacts"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "tasks.sqlite"));
    chmodSync(join(directory, "tasks.sqlite"), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL, key TEXT UNIQUE, fingerprint TEXT, created TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status, created);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
  }
  get(id: string): Task | undefined {
    const row = this.db.prepare("SELECT body FROM tasks WHERE id=?").get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  list(limit = DEFAULT_TASK_LIMIT, offset = 0, status?: TaskStatus): Task[] {
    const rows = status
      ? this.db
          .prepare(
            "SELECT body FROM tasks WHERE status=? ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
          )
          .all(status, limit, offset)
      : this.db
          .prepare(
            "SELECT body FROM tasks ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
          )
          .all(limit, offset);
    return rows.map((r) => JSON.parse(String(r.body)));
  }
  counts(): Record<string, number> {
    return Object.fromEntries(
      this.db
        .prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status")
        .all()
        .map((r) => [String(r.status), Number(r.n)]),
    );
  }
  submit(request: TaskRequest): { task: Task; reused: boolean } {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...request, idempotencyKey: undefined }))
      .digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (request.idempotencyKey) {
        const row = this.db
          .prepare("SELECT body,fingerprint FROM tasks WHERE key=?")
          .get(request.idempotencyKey);
        if (row) {
          if (row.fingerprint !== fingerprint)
            throw new ConflictError(
              "Idempotency key already used with different input",
            );
          this.db.exec("COMMIT");
          return { task: JSON.parse(String(row.body)), reused: true };
        }
      }
      const now = new Date().toISOString();
      const task: Task = {
        id: randomUUID(),
        status: "QUEUED",
        request,
        createdAt: now,
        updatedAt: now,
      };
      this.db
        .prepare("INSERT INTO tasks VALUES (?,?,?,?,?,?)")
        .run(
          task.id,
          task.status,
          JSON.stringify(task),
          request.idempotencyKey ?? null,
          fingerprint,
          now,
        );
      this.recordEvent(task, "Submitted");
      this.db.exec("COMMIT");
      return { task, reused: false };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private recordEvent(task: Task, detail?: string) {
    this.db
      .prepare("INSERT INTO events(task_id,body) VALUES (?,?)")
      .run(
        task.id,
        JSON.stringify({ status: task.status, at: task.updatedAt, detail }),
      );
  }
  events(id: string): TaskEvent[] {
    return this.db
      .prepare("SELECT body FROM events WHERE task_id=? ORDER BY seq")
      .all(id)
      .map((r) => JSON.parse(String(r.body)));
  }
  transition(
    id: string,
    status: TaskStatus,
    patch: Partial<Pick<Task, "result" | "error">> = {},
    detail?: string,
  ): Task {
    const task = this.get(id);
    if (!task) throw new Error("Task not found");
    if (terminalStatuses.includes(task.status)) return task;
    if (!ALLOWED_TRANSITIONS[task.status]?.includes(status))
      throw new Error(`Invalid transition ${task.status} -> ${status}`);
    const now = new Date().toISOString();
    const updated: Task = {
      ...task,
      ...patch,
      status,
      updatedAt: now,
      ...(status === "RUNNING" ? { startedAt: now } : {}),
      ...(terminalStatuses.includes(status) ? { finishedAt: now } : {}),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.db
        .prepare("UPDATE tasks SET body=?,status=? WHERE id=? AND status=?")
        .run(JSON.stringify(updated), status, id, task.status);
      if (!changed.changes)
        throw new ConflictError("Task changed concurrently");
      this.recordEvent(updated, detail);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return updated;
  }
  next(): Task | undefined {
    const row = this.db
      .prepare(
        "SELECT body FROM tasks WHERE status='QUEUED' ORDER BY created,id LIMIT 1",
      )
      .get();
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  recover() {
    // Never replay a potentially billable request after an ambiguous crash.
    for (const row of this.db
      .prepare(
        `SELECT id FROM tasks WHERE status IN (${RECOVERABLE_STATUSES.map(() => "?").join(",")})`,
      )
      .all(...RECOVERABLE_STATUSES))
      this.transition(
        String(row.id),
        "FAILED",
        {
          error: {
            code: "WORKER_RESTARTED",
            message:
              "Worker stopped during execution. Submit a new task after reviewing provider activity.",
          },
        },
        "Interrupted execution; not replayed",
      );
  }
  putArtifact(
    data: Buffer,
    mime: string,
    source: string,
    kind: Artifact["kind"] = "text",
  ): Artifact {
    const id = createHash("sha256").update(data).digest("hex");
    const existing = this.artifact(id);
    if (existing) return existing;
    const artifact: Artifact = {
      id,
      mime,
      bytes: data.length,
      createdAt: new Date().toISOString(),
      source,
      kind,
    };
    const path = join(this.directory, "artifacts", id);
    if (!existsSync(path))
      writeFileSync(path, data, { mode: 0o600, flag: "wx" });
    this.db
      .prepare("INSERT OR IGNORE INTO artifacts VALUES (?,?)")
      .run(id, JSON.stringify(artifact));
    return artifact;
  }
  artifact(id: string): Artifact | undefined {
    if (!ARTIFACT_ID_PATTERN.test(id)) return undefined;
    const row = this.db
      .prepare("SELECT body FROM artifacts WHERE id=?")
      .get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  artifactData(id: string): Buffer {
    if (!this.artifact(id)) throw new Error("Artifact not found");
    const data = readFileSync(join(this.directory, "artifacts", id));
    if (createHash("sha256").update(data).digest("hex") !== id)
      throw new Error("Artifact integrity check failed");
    return data;
  }
  /** Remove old terminal tasks and only artifacts no remaining task references. */
  pruneOlderThan(cutoff: Date): { tasks: number; artifacts: number } {
    if (!Number.isFinite(cutoff.getTime()))
      throw new Error("Invalid retention cutoff");
    const rows = this.db
      .prepare("SELECT id,body FROM tasks WHERE status IN (" +
        terminalStatuses.map(() => "?").join(",") + ")")
      .all(...terminalStatuses);
    const expired = rows.filter((row) => {
      const task = JSON.parse(String(row.body)) as Task;
      return task.finishedAt && task.finishedAt < cutoff.toISOString();
    });
    if (!expired.length) return { tasks: 0, artifacts: 0 };
    const orphanIds: string[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const deleteEvents = this.db.prepare("DELETE FROM events WHERE task_id=?");
      const deleteTask = this.db.prepare("DELETE FROM tasks WHERE id=?");
      for (const row of expired) {
        deleteEvents.run(row.id);
        deleteTask.run(row.id);
      }
      const referenced = new Set<string>();
      for (const row of this.db.prepare("SELECT body FROM tasks").all()) {
        const task = JSON.parse(String(row.body)) as Task;
        for (const artifact of task.result?.artifacts ?? [])
          referenced.add(artifact.id);
      }
      const deleteArtifact = this.db.prepare("DELETE FROM artifacts WHERE id=?");
      for (const row of this.db.prepare("SELECT id FROM artifacts").all()) {
        const id = String(row.id);
        if (!referenced.has(id) && ARTIFACT_ID_PATTERN.test(id)) {
          deleteArtifact.run(id);
          orphanIds.push(id);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    // Metadata commits first; a failed file deletion leaves only a harmless orphan file.
    for (const id of orphanIds)
      rmSync(join(this.directory, "artifacts", id), { force: true });
    return { tasks: expired.length, artifacts: orphanIds.length };
  }

  close() {
    this.db.close();
  }
}
