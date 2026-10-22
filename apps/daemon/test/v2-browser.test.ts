import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "@chatgpt-wrapper/core";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";
import { Worker } from "../src/worker.js";
const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright-extra", () => ({
  chromium: { launchPersistentContext: mocks.launch },
}));
import { PlaywrightAdapter } from "../src/playwright-adapter.js";

const conversationId = "12345678-1234-4234-8234-123456789abc";
let browser: Browser;
let directory: string;
let engine: string;
let store: Store;
let worker: Worker;
let mode: "normal" | "no-selector" | "no-history" = "normal";
const visits: string[] = [];
const interactions: Array<{ kind: string; model?: string; prompt?: string }> =
  [];
let launches = 0;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "wrapper-v2-browser-"));
  engine = join(directory, "engine.js");
  await build({
    entryPoints: [
      join(dirname(fileURLToPath(import.meta.url)), "../src/page-engine.ts"),
    ],
    outfile: engine,
    bundle: true,
    format: "iife",
    globalName: "WrapperPage",
    platform: "browser",
    target: "chrome120",
  });
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  rmSync(directory, { recursive: true, force: true });
});
afterEach(async () => {
  await worker?.stop();
  store?.close();
  vi.clearAllMocks();
});

async function setup() {
  visits.length = 0;
  interactions.length = 0;
  launches = 0;
  mode = "normal";
  mocks.launch.mockImplementation(async () => {
    launches++;
    const context = await browser.newContext();
    await context.exposeBinding("fixtureInteraction", (_source, event) =>
      interactions.push(event),
    );
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      visits.push(url.pathname);
      const continued = url.pathname.startsWith("/c/") && mode !== "no-history";
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
        <button hidden aria-label="New chat" onclick="window.fixtureInteraction({kind:'hidden-new-chat'})">New chat</button>
        <button aria-label="New chat in Fixture project" onclick="window.fixtureInteraction({kind:'project-new'})">New chat</button>
        <button aria-label="New chat" onclick="window.fixtureInteraction({kind:'new-chat'})">New chat</button>
        ${mode !== "no-selector" ? '<button data-testid="model-switcher">Current</button><div role="menu" hidden><button role="menuitem">Requested Model</button></div>' : ""}
        <section id="turns">${continued ? '<article><div data-message-author-role="user">OLD USER</div></article><article><div data-message-author-role="assistant"><div class="markdown">OLD REPLY</div></div><button aria-label="Copy">Copy</button></article>' : ""}</section>
        <textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>
        <script>
        const control = document.querySelector('[data-testid="model-switcher"]');
        if(control) control.onclick = () => document.querySelector('[role="menu"]').hidden = false;
        const option = document.querySelector('[role="menuitem"]');
        if(option) option.onclick = () => { control.textContent = option.textContent; document.querySelector('[role="menu"]').hidden = true; window.fixtureInteraction({kind:'select',model:control.textContent}); };
        document.querySelector('[data-testid="send-button"]').onclick = () => {
          const prompt = document.querySelector('textarea').value;
          window.fixtureInteraction({kind:'send',model:control?.textContent,prompt});
          history.pushState({},'', '/c/${conversationId}');
          const user = document.createElement('article');
          const userBody = document.createElement('div'); userBody.setAttribute('data-message-author-role','user'); userBody.textContent = prompt; user.append(userBody); document.querySelector('#turns').append(user);
          const assistant = document.createElement('article'); assistant.setAttribute('data-talvt-turn-state','complete'); assistant.innerHTML = '<div data-message-author-role="assistant"><div class="markdown">${continued ? "Fresh continued reply." : "Fresh initial reply."}</div></div><button aria-label="Copy">Copy</button>'; document.querySelector('#turns').append(assistant);
          document.querySelector('textarea').value = '';
        };
        </script></body></html>`,
      });
    });
    return context;
  });
  store = new Store(mkdtempSync(join(directory, "store-")));
  worker = new Worker(store, new PlaywrightAdapter(directory, engine, true));
}
async function run(extra: Record<string, unknown> = {}) {
  const submitted = store.submit(
    taskRequestSchema.parse({
      capability: "reason.analyze",
      objective: "Explain the fixture.",
      timeoutSeconds: 30,
      ...extra,
    }),
  ).task;
  await worker.tick();
  return store.get(submitted.id)!;
}

it("selects before sending once, persists identity, and continues only the requested history", async () => {
  await setup();
  const first = await run({ model: "Requested Model" });
  expect(first.status).toBe("COMPLETED");
  expect(first.result).toMatchObject({
    text: "Fresh initial reply.",
    conversationId,
    conversationUrl: `https://chatgpt.com/c/${conversationId}`,
    provenance: { adapter: "chatgpt-playwright", model: "Requested Model" },
  });
  expect(interactions.map((event) => event.kind)).toEqual([
    "new-chat",
    "select",
    "send",
  ]);
  expect(interactions.at(-1)?.model).toBe("Requested Model");
  const initialCount = interactions.length;
  const second = await run({
    model: "Requested Model",
    conversationId: first.result!.conversationId,
  });
  expect(second.status).toBe("COMPLETED");
  expect(second.result).toMatchObject({
    text: "Fresh continued reply.",
    conversationId,
    provenance: { model: "Requested Model" },
  });
  expect(second.result!.text).not.toContain("OLD REPLY");
  expect(visits).toContain(`/c/${conversationId}`);
  expect(interactions.slice(initialCount).map((event) => event.kind)).toEqual([
    "select",
    "send",
  ]);
  expect(launches).toBe(2);
  expect(
    interactions.filter((event) => event.kind === "new-chat"),
  ).toHaveLength(1);
  expect(
    interactions.some(
      (event) =>
        event.kind === "project-new" || event.kind === "hidden-new-chat",
    ),
  ).toBe(false);
  expect(store.get(first.id)?.result?.conversationId).toBe(conversationId);
}, 20000);

it.each(["missing", "unknown"])(
  "never sends when the requested model is %s",
  async (kind) => {
    await setup();
    if (kind === "missing") mode = "no-selector";
    const task = await run({
      model: kind === "unknown" ? "Unavailable Model" : "Requested Model",
    });
    expect(task).toMatchObject({
      status: "NEEDS_HUMAN",
      error: {
        code:
          kind === "missing"
            ? "MODEL_SELECTION_UNAVAILABLE"
            : "MODEL_NOT_FOUND",
      },
    });
    expect(interactions.filter((event) => event.kind === "send")).toEqual([]);
  },
);

it("never sends or starts a new chat when existing conversation history is absent", async () => {
  await setup();
  mode = "no-history";
  const task = await run({ conversationId });
  expect(task).toMatchObject({
    status: "NEEDS_HUMAN",
    error: { code: "CONVERSATION_UNAVAILABLE" },
  });
  expect(visits).toEqual([`/c/${conversationId}`]);
  expect(interactions).toEqual([]);
}, 15000);
