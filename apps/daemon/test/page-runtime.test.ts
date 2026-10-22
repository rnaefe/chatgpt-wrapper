import { it, expect, vi } from "vitest";
import { openProfile, PlaywrightAdapter } from "../src/playwright-adapter.js";
import { chromium } from "playwright-extra";
import { Store } from "@chatgpt-wrapper/core";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";
import { Worker } from "../src/worker.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
it("installs the shared engine into a real headless page", async () => {
  const profile = await mkdtemp(join(tmpdir(), "wrapper-extra-fixture-"));
  const browser = await openProfile(profile, true);
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div contenteditable="true" data-composer-markdown></div>',
    );
    const source = await readFile(
      new URL("../dist/page-engine.js", import.meta.url),
      "utf8",
    );
    await page.evaluate(source + ";globalThis.WrapperPage=WrapperPage;");
    const ready = await page.evaluate(
      () =>
        (
          window as unknown as {
            WrapperPage: {
              pageReadiness: (doc: Document) => { ready: boolean };
            };
          }
        ).WrapperPage.pageReadiness(document).ready,
    );
    expect(ready).toBe(true);
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
}, 20000);

it("persists real browser progress through the binding and worker before completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wrapper-progress-browser-"));
  const browser = await openProfile(join(directory, "profile"), true);
  const store = new Store(directory);
  const engine = new URL("../dist/page-engine.js", import.meta.url).pathname;
  const adapter = new PlaywrightAdapter(directory, engine, true);
  const worker = new Worker(store, adapter, 0);
  const launch = vi
    .spyOn(chromium, "launchPersistentContext")
    .mockResolvedValue(browser);
  try {
    await browser.route("https://chatgpt.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>
        <script>
          document.querySelector('button').onclick = () => {
            setTimeout(() => {
              const user = document.createElement('div');
              user.dataset.messageAuthorRole = 'user';
              user.textContent = document.querySelector('textarea').value;
              document.body.append(user);
              setTimeout(() => {
                const article = document.createElement('article');
                article.innerHTML = '<div data-message-author-role="assistant"><div class="markdown">Fixture response</div></div><button aria-label="Copy">Copy</button>';
                document.body.append(article);
              }, 500);
            }, 500);
          };
        </script>`,
      }),
    );
    const task = store.submit(
      taskRequestSchema.parse({
        capability: "reason.analyze",
        objective: "Explain the fixture",
        timeoutSeconds: 15,
      }),
    ).task;
    const stages: string[] = [];
    const unsubscribe = store.onTaskChange((changed) => {
      const stage = changed.progress?.stage;
      if (stage && stages.at(-1) !== stage) stages.push(stage);
    });
    const running = worker.tick();
    await vi.waitFor(
      () =>
        expect(store.get(task.id)?.progress?.stage).toBe("waiting_response"),
      { timeout: 10000, interval: 20 },
    );
    expect(store.get(task.id)).toMatchObject({
      status: "RUNNING",
    });
    expect(
      store
        .events(task.id)
        .some((event) => event.progress?.stage === "waiting_response"),
    ).toBe(true);
    await vi.waitFor(
      () =>
        expect(store.get(task.id)?.progress?.stage).toBe("receiving_response"),
      { timeout: 5000, interval: 20 },
    );
    expect(store.get(task.id)?.status).toBe("RUNNING");
    await running;
    unsubscribe();
    expect(stages).toEqual([
      "queued",
      "opening_browser",
      "preparing_chat",
      "submitting_prompt",
      "waiting_response",
      "receiving_response",
      "validating",
      "saving_result",
      "completed",
    ]);
    expect(store.get(task.id)).toMatchObject({
      status: "COMPLETED",
      result: { text: "Fixture response" },
    });
  } finally {
    launch.mockRestore();
    await worker.stop();
    await browser.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 25000);
