import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  statSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright-extra", () => ({
  chromium: { launchPersistentContext: mocks.launch },
}));
import {
  PlaywrightAdapter,
  profileDirectory,
  validateImagePath,
  validateImageUrl,
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
  it("reports image transfer stages only when images are present", async () => {
    const { adapter } = setup(headless);
    const progress = vi.fn();
    const input = {
      first: () => input,
      nth: () => input,
      count: vi.fn().mockResolvedValue(1),
      getAttribute: vi.fn().mockResolvedValue("image/*"),
      setInputFiles: vi.fn(),
    };
    const absent = { first: () => absent, count: vi.fn().mockResolvedValue(0) };
    const page = {
      goto: vi.fn(),
      locator: (selector: string) =>
        selector === 'input[type="file"]' ? input : absent,
      waitForTimeout: vi.fn(),
      exposeBinding: vi.fn(),
      mainFrame: vi.fn(),
      url: () => "https://chatgpt.com/",
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          value: {
            text: "Done",
            model: "ChatGPT",
            images: [{ src: "blob:fixture" }],
          },
        })
        .mockImplementation(async () => {
          expect(progress.mock.calls.at(-1)).toEqual(["downloading_images"]);
          return { data: "aW1hZ2U=", mime: "image/png" };
        }),
    };
    input.setInputFiles.mockImplementation(async () => {
      expect(progress.mock.calls.at(-1)).toEqual(["uploading_images"]);
    });
    mocks.launch.mockResolvedValue({
      pages: () => [page],
      close: vi.fn().mockResolvedValue(undefined),
    });
    const output = await adapter.execute(
      {
        ...request,
        images: [
          {
            source: "base64",
            name: "fixture.png",
            mime: "image/png",
            data: "aW1hZ2U=",
          },
        ],
      },
      new AbortController().signal,
      progress,
    );
    expect(progress.mock.calls.map(([stage]) => stage)).toEqual([
      "opening_browser",
      "preparing_chat",
      "uploading_images",
      "downloading_images",
    ]);
    expect(output.images).toHaveLength(1);
    expect(input.setInputFiles).toHaveBeenCalledOnce();
  });
  it("forwards only trusted page stages and ignores callbacks after cancellation", async () => {
    const { adapter } = setup(headless);
    const controller = new AbortController();
    const frame = {};
    let report: (source: { frame: unknown }, stage: string) => void = () => {};
    const progress = vi.fn();
    const page = {
      exposeBinding: vi.fn(async (_name, callback) => {
        report = callback;
      }),
      mainFrame: () => frame,
      goto: vi.fn(),
      url: () => "https://chatgpt.com/",
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementation(async () => {
          report({ frame: {} }, "waiting_response");
          report({ frame }, "completed");
          report({ frame }, "submitting_prompt");
          report({ frame }, "waiting_response");
          report({ frame }, "receiving_response");
          controller.abort(new Error("cancelled"));
          report({ frame }, "receiving_response");
          throw new Error("closed");
        }),
    };
    mocks.launch.mockImplementation(async () => {
      expect(progress.mock.calls).toEqual([["opening_browser"]]);
      return {
        pages: () => [page],
        close: vi.fn().mockResolvedValue(undefined),
      };
    });
    page.goto.mockImplementation(async () => {
      expect(progress.mock.calls.at(-1)).toEqual(["preparing_chat"]);
    });
    await expect(
      adapter.execute(request, controller.signal, progress),
    ).rejects.toThrow("cancelled");
    expect(page.exposeBinding).toHaveBeenCalledWith(
      "__wrapperReportProgress",
      expect.any(Function),
    );
    expect(progress.mock.calls.map(([stage]) => stage)).toEqual([
      "opening_browser",
      "preparing_chat",
      "submitting_prompt",
      "waiting_response",
      "receiving_response",
    ]);
  });
  it("uses a private persistent profile and returns completed output once", async () => {
    const { dir, adapter } = setup(headless);
    const page = {
      exposeBinding: vi.fn(),
      mainFrame: vi.fn(),
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
        {
          exposeBinding: vi.fn(),
          mainFrame: vi.fn(),
          goto: vi.fn(),
          url: () => "https://chatgpt.com/",
          evaluate,
        },
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
        {
          exposeBinding: vi.fn(),
          mainFrame: vi.fn(),
          goto: vi.fn(),
          url: () => "https://chatgpt.com/",
          evaluate,
        },
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
    exposeBinding: vi.fn(),
    mainFrame: vi.fn(),
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
    const page = {
      exposeBinding: vi.fn(),
      mainFrame: vi.fn(),
      goto: vi.fn(),
      url: () => "https://chatgpt.com/",
      evaluate,
    };
    mocks.launch.mockResolvedValue({ pages: () => [page], close });
    await expect(
      adapter.execute(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: error.code, status: error.status });
    expect(adapter.status().state).toBe(error.status);
    expect(close).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledTimes(2);
    evaluate.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
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
      {
        exposeBinding: vi.fn(),
        mainFrame: vi.fn(),
        goto: vi.fn(),
        url: () => "https://chatgpt.com/",
        evaluate,
      },
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

describe("image input boundaries", () => {
  it("requires explicit HTTPS host allowlisting", () => {
    const previous = process.env.ALLOWED_IMAGE_HOSTS;
    try {
      delete process.env.ALLOWED_IMAGE_HOSTS;
      expect(() =>
        validateImageUrl("https://images.example.test/a.png"),
      ).toThrow();
      process.env.ALLOWED_IMAGE_HOSTS = "images.example.test";
      expect(
        validateImageUrl("https://images.example.test/a.png").hostname,
      ).toBe("images.example.test");
      expect(() =>
        validateImageUrl("https://internal.example.test/a.png"),
      ).toThrow();
      expect(() =>
        validateImageUrl("https://images.example.test:8443/a.png"),
      ).toThrow();
      expect(() =>
        validateImageUrl("https://user:secret@images.example.test/a.png"),
      ).toThrow();
    } finally {
      if (previous === undefined) delete process.env.ALLOWED_IMAGE_HOSTS;
      else process.env.ALLOWED_IMAGE_HOSTS = previous;
    }
  });

  it("limits local images to real files within the configured roots and rejects symlink escapes", async () => {
    const { dir } = setup();
    const other = mkdtempSync(join(tmpdir(), "wrapper-secret-"));
    directories.push(other);
    const good = join(dir, "good.png");
    const secret = join(other, "secret.png");
    const linked = join(dir, "escape.png");
    writeFileSync(good, Buffer.from([137, 80, 78, 71]));
    writeFileSync(secret, Buffer.from([137, 80, 78, 71]));
    symlinkSync(secret, linked);
    const previous = process.env.IMAGE_INPUT_ROOTS;
    try {
      delete process.env.IMAGE_INPUT_ROOTS;
      await expect(validateImagePath(good)).rejects.toMatchObject({
        code: "IMAGE_PATH_NOT_ALLOWED",
      });
      process.env.IMAGE_INPUT_ROOTS = dir;
      await expect(validateImagePath(good)).resolves.toBe(realpathSync(good));
      await expect(validateImagePath(secret)).rejects.toMatchObject({
        code: "IMAGE_PATH_NOT_ALLOWED",
      });
      await expect(validateImagePath(linked)).rejects.toMatchObject({
        code: "IMAGE_PATH_NOT_ALLOWED",
      });
    } finally {
      if (previous === undefined) delete process.env.IMAGE_INPUT_ROOTS;
      else process.env.IMAGE_INPUT_ROOTS = previous;
    }
  });
});
