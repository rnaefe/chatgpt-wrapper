import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({
  chromium: { launchPersistentContext: mocks.launch },
}));
import {
  PlaywrightAdapter,
  profileDirectory,
} from "../src/playwright-adapter.js";
const directories: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "wrapper-pw-"));
  directories.push(dir);
  const engine = join(dir, "engine.js");
  writeFileSync(engine, "/* fixture */");
  return { dir, adapter: new PlaywrightAdapter(dir, engine, true) };
}
const request = {
  capability: "code.generate" as const,
  objective: "Test",
  acceptanceCriteria: [],
  allowedPaths: [],
  timeoutSeconds: 30,
};
afterEach(() => {
  vi.clearAllMocks();
  directories
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
describe("headless worker lifecycle", () => {
  it("uses a private persistent profile and returns completed output once", async () => {
    const { dir, adapter } = setup();
    const page = {
      goto: vi.fn(),
      url: () => "https://chatgpt.com/",
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({
          value: { text: "```ts\nconst x = 1;\n```", model: "ChatGPT" },
        }),
    };
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.launch.mockResolvedValue({ pages: () => [page], close });
    const result = await adapter.execute(request, new AbortController().signal);
    expect(result.adapter).toBe("chatgpt-playwright");
    expect(result.text).toContain("const x = 1");
    expect(mocks.launch).toHaveBeenCalledWith(
      join(dir, "playwright-profile"),
      expect.objectContaining({ headless: true }),
    );
    expect(statSync(profileDirectory(dir)).mode & 0o777).toBe(0o700);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
  it("surfaces challenge and closes context without replay", async () => {
    const { adapter } = setup();
    const close = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({
        error: {
          code: "BROWSER_CHALLENGE",
          message: "Resolve challenge",
          status: "NEEDS_HUMAN",
        },
      });
    mocks.launch.mockResolvedValue({
      pages: () => [
        { goto: vi.fn(), url: () => "https://chatgpt.com/", evaluate },
      ],
      close,
    });
    await expect(
      adapter.execute(request, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "BROWSER_CHALLENGE",
      status: "NEEDS_HUMAN",
    });
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
  it("closes an active context on cancellation", async () => {
    const { adapter } = setup();
    const controller = new AbortController();
    let rejectEvaluation: (e: Error) => void = () => {};
    const close = vi.fn(async () => rejectEvaluation(new Error("closed")));
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectEvaluation = reject;
            controller.abort(new Error("cancelled"));
          }),
      );
    mocks.launch.mockResolvedValue({
      pages: () => [
        { goto: vi.fn(), url: () => "https://chatgpt.com/", evaluate },
      ],
      close,
    });
    await expect(adapter.execute(request, controller.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(close).toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
it("keeps the visible login context for subsequent MCP tasks", async () => {
  const { dir } = setup();
  const adapter = new PlaywrightAdapter(dir, join(dir, "engine.js"), false);
  const close = vi.fn().mockResolvedValue(undefined);
  const page = {
    goto: vi.fn(),
    url: () => "https://chatgpt.com/",
    evaluate: vi.fn(async (fn: unknown, request?: unknown) =>
      request
        ? { value: { text: "export const verified = true;", model: "ChatGPT" } }
        : typeof fn === "string"
          ? undefined
          : { ready: true },
    ),
  };
  const context = {
    pages: () => [page],
    close,
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  };
  mocks.launch.mockResolvedValue(context);
  try {
    const connected = adapter.connect();
    await connected;
    expect(adapter.status().state).toBe("READY");
    expect(close).not.toHaveBeenCalled();
    await adapter.execute(request, new AbortController().signal);
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: false }),
    );
    expect(close).not.toHaveBeenCalled();
    await adapter.close();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
