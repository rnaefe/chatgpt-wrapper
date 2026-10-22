import { expect, it, vi } from "vitest";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-extra";
import { Store } from "@chatgpt-wrapper/core";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";
import { openProfile, PlaywrightAdapter } from "../src/playwright-adapter.js";
import { Worker } from "../src/worker.js";

type Observation = { kind: string; [key: string]: unknown };
async function fixture(
  options: {
    search?: boolean;
    citations?: boolean;
    inlineSearch?: boolean;
    draft?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "wrapper-research-files-"));
  const engine = join(directory, "fixture-engine.js");
  await build({
    entryPoints: [
      fileURLToPath(new URL("../src/page-engine.ts", import.meta.url)),
    ],
    outfile: engine,
    bundle: true,
    format: "iife",
    globalName: "WrapperPage",
    platform: "browser",
    target: "chrome120",
    legalComments: "none",
  });
  const localPath = join(directory, "notes.txt");
  const contents = "fixture attachment: exact UTF-8 content — research context";
  const encoded = Buffer.from("additional base64 research material").toString(
    "base64",
  );
  await writeFile(localPath, contents);
  const context = await openProfile(join(directory, "profile"), true);
  const observed: Observation[] = [];
  await context.exposeBinding(
    "fixtureRecord",
    (_source, event: Observation) => {
      observed.push(event);
    },
  );
  const answer = "Research answer from the attached context.";
  const citations =
    options.citations === false
      ? ""
      : '<aside><a href="https://example.org/report?edition=2#findings">Primary report</a></aside>';
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== "https://chatgpt.com")
      return route.abort();
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><main>
      ${options.search === false ? "" : '<button data-testid="search-tool" aria-pressed="false">Search</button>'}
      <input type="file" multiple accept=".txt,.pdf,.md,.json">
      <div id="upload-status" hidden></div>
      ${options.inlineSearch ? '<div id="prompt-textarea" contenteditable="true" data-composer-markdown class="ProseMirror" role="textbox"></div>' : '<textarea id="prompt-textarea"></textarea>'}<button data-testid="send-button">Send</button>
      </main><script>
      const search = document.querySelector('[data-testid="search-tool"]');
      const composer = document.querySelector('#prompt-textarea');
      if (search) search.onclick = () => {
        if (${Boolean(options.inlineSearch)}) {
          composer.innerHTML = '<span data-inline-selection-pill data-system-hint-type="search" data-prompt-link-href="chatgpt-system-hint://search" contenteditable="false">Web search</span>' + (${Boolean(options.draft)} ? 'My unfinished user draft' : '');
        } else search.setAttribute('aria-pressed', 'true');
        window.fixtureRecord({kind:'search'});
      };
      const input = document.querySelector('input');
      const busy = document.querySelector('#upload-status');
      const send = document.querySelector('[data-testid="send-button"]');
      input.onchange = async () => {
        busy.hidden = false; busy.setAttribute('aria-busy','true'); send.disabled = true;
        const files = await Promise.all(Array.from(input.files, async file => ({name:file.name, content:await file.text()})));
        await window.fixtureRecord({kind:'upload', files});
        setTimeout(() => { busy.hidden = true; busy.removeAttribute('aria-busy'); send.disabled = false; }, 100);
      };
      send.onclick = async () => {
        const prompt = composer instanceof HTMLTextAreaElement ? composer.value : composer.innerText;
        const pillPresent = Boolean(composer.querySelector('[data-inline-selection-pill][data-system-hint-type="search"]'));
        await window.fixtureRecord({kind:'send', prompt, pillPresent, searchSelected: search?.getAttribute('aria-pressed'), uploadBusy:busy.getAttribute('aria-busy')});
        const user = document.createElement('div'); user.dataset.messageAuthorRole='user'; user.textContent=prompt; document.querySelector('main').append(user);
        if (composer instanceof HTMLTextAreaElement) composer.value=''; else composer.replaceChildren();
        setTimeout(() => { const article=document.createElement('article'); article.innerHTML=${JSON.stringify(`<div data-message-author-role="assistant"><div class="markdown">${answer}</div>${citations}</div><button aria-label="Copy">Copy</button>`)}; document.querySelector('main').append(article); }, 100);
      };
      </script>`,
    });
  });
  const launch = vi
    .spyOn(chromium, "launchPersistentContext")
    .mockResolvedValue(context);
  const store = new Store(directory);
  const adapter = new PlaywrightAdapter(directory, engine, true);
  const worker = new Worker(store, adapter, 0);
  let storeClosed = false;
  const previousRoots = process.env.FILE_INPUT_ROOTS;
  process.env.FILE_INPUT_ROOTS = directory;
  try {
    const task = store.submit(
      taskRequestSchema.parse({
        capability: "research.search",
        objective: "Research the attached context and cite sources.",
        timeoutSeconds: 20,
        files: [
          { source: "path", path: localPath },
          {
            source: "base64",
            name: "extra.txt",
            mime: "text/plain",
            data: encoded,
          },
        ],
      }),
    ).task;
    await worker.tick();
    const result = store.get(task.id)!;
    await worker.stop();
    store.close();
    storeClosed = true;
    const reopened = new Store(directory);
    try {
      expect(reopened.get(task.id)).toEqual(result);
    } finally {
      reopened.close();
    }
    return { task: result, observed, localPath, contents, encoded };
  } finally {
    if (previousRoots === undefined) delete process.env.FILE_INPUT_ROOTS;
    else process.env.FILE_INPUT_ROOTS = previousRoots;
    launch.mockRestore();
    await worker.stop();
    if (!storeClosed) store.close();
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
}

it("transfers attachments and visibly enables Search before sending, then persists observed sources", async () => {
  const result = await fixture();
  expect(result.task).toMatchObject({
    status: "COMPLETED",
    result: {
      sources: [
        {
          url: "https://example.org/report?edition=2",
          title: "Primary report",
        },
      ],
    },
  });
  expect(result.observed.map((event) => event.kind)).toEqual([
    "search",
    "upload",
    "send",
  ]);
  expect(result.observed[1].files).toEqual([
    { name: "notes.txt", content: result.contents },
    { name: "extra.txt", content: "additional base64 research material" },
  ]);
  expect(result.observed[2]).toMatchObject({
    searchSelected: "true",
    uploadBusy: null,
  });
  const sent = String(result.observed[2].prompt);
  expect(sent).toContain("notes.txt");
  expect(sent).toContain("extra.txt");
  expect(sent).not.toContain(result.localPath);
  expect(sent).not.toContain(result.encoded);
}, 30000);

it("requires human attention before uploading or sending when Search is unavailable", async () => {
  const result = await fixture({ search: false });
  expect(result.task).toMatchObject({
    status: "NEEDS_HUMAN",
    error: { code: "RESEARCH_UNAVAILABLE" },
  });
  expect(result.observed).toEqual([]);
}, 30000);

it("fails validation when the research response contains no source links", async () => {
  const result = await fixture({ citations: false });
  expect(result.task).toMatchObject({
    status: "FAILED",
    error: { code: "VALIDATION_FAILED" },
  });
  expect(result.task.result).toBeUndefined();
  expect(result.observed.map((event) => event.kind)).toEqual([
    "search",
    "upload",
    "send",
  ]);
}, 30000);

it("preserves the real inline Search token while inserting the research prompt", async () => {
  const result = await fixture({ inlineSearch: true });
  expect(result.task).toMatchObject({
    status: "COMPLETED",
    result: {
      sources: [
        {
          url: "https://example.org/report?edition=2",
          title: "Primary report",
        },
      ],
    },
  });
  expect(result.observed.map((event) => event.kind)).toEqual([
    "search",
    "upload",
    "send",
  ]);
  expect(result.observed[2].pillPresent).toBe(true);
  expect(result.observed[2].prompt).toContain(
    "Research the attached context and cite sources.",
  );
  expect(result.observed[2].prompt).toContain("Web search");
}, 30000);

it("protects unsent user text alongside the active Search token", async () => {
  const result = await fixture({ inlineSearch: true, draft: true });
  expect(result.task).toMatchObject({
    status: "NEEDS_HUMAN",
    error: { code: "UNSENT_DRAFT" },
  });
  expect(result.observed.some((event) => event.kind === "send")).toBe(false);
}, 30000);
