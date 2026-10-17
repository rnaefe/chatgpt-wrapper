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
function setup(headless = true) {
  const dir = mkdtempSync(join(tmpdir(), "wrapper-pw-"));
  directories.push(dir);
  const engine = join(dir, "engine.js");
  writeFileSync(engine, "/* fixture */");
  return { dir, adapter: new PlaywrightAdapter(dir, engine, headless) };
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
describe.each([true, false])("worker lifecycle (headless=%s)", (headless) => {
  it("uses a private persistent profile and returns completed output once", async () => {
    const { dir, adapter } = setup(headless);
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
      expect.objectContaining({ headless }),
    );
    expect(statSync(profileDirectory(dir)).mode & 0o777).toBe(0o700);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
  it("surfaces challenge and closes context without replay", async () => {
    const { adapter } = setup(headless);
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
    const { adapter } = setup(headless);
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
it("closes visible sign-in and each task while preserving readiness", async () => {
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
    expect(close).toHaveBeenCalledTimes(1);
    await adapter.execute(request, new AbortController().signal);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: false }),
    );
    expect(close).toHaveBeenCalledTimes(2);
    expect(adapter.status().state).toBe("READY");
    await adapter.execute(request, new AbortController().signal);
    expect(mocks.launch).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(3);
    await adapter.close();
    expect(close).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  { code: "LOGIN_REDIRECT", message: "Session expired", status: "NEEDS_AUTH" },
  {
    code: "BROWSER_CHALLENGE",
    message: "Verification required",
    status: "NEEDS_HUMAN",
  },
  {
    code: "BROWSER_INTERRUPTED",
    message: "Connection interrupted",
    status: "NEEDS_HUMAN",
  },
])(
  "releases the profile after $code and permits a new task without replaying",
  async (error) => {
    const { dir } = setup();
    const adapter = new PlaywrightAdapter(dir, join(dir, "engine.js"), false);
    const close = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ error });
    const page = { goto: vi.fn(), url: () => "https://chatgpt.com/", evaluate };
    mocks.launch.mockResolvedValue({ pages: () => [page], close });
    await expect(
      adapter.execute(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: error.code, status: error.status });
    expect(adapter.status().state).toBe(error.status);
    expect(close).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledTimes(2);
    evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        value: { text: "Recovered", model: "ChatGPT" },
      });
    expect(
      (await adapter.execute(request, new AbortController().signal)).text,
    ).toBe("Recovered");
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  },
);

it("releases a visible profile after the user closes its window during evaluation", async () => {
  const { dir } = setup();
  const adapter = new PlaywrightAdapter(dir, join(dir, "engine.js"), false);
  const close = vi.fn().mockResolvedValue(undefined);
  const evaluate = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(
      new Error("Target page, context or browser has been closed"),
    );
  mocks.launch.mockResolvedValue({
    pages: () => [
      { goto: vi.fn(), url: () => "https://chatgpt.com/", evaluate },
    ],
    close,
  });
  await expect(
    adapter.execute(request, new AbortController().signal),
  ).rejects.toMatchObject({
    code: "BROWSER_INTERRUPTED",
    status: "NEEDS_HUMAN",
  });
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.launch).toHaveBeenCalledOnce();
  expect(adapter.canStart()).toBe(true);
});
