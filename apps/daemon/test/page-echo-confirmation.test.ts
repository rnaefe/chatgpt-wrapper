import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let browser: Browser;
let engine: string;
beforeAll(async () => {
  const bundled = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/page-engine.ts", import.meta.url)),
    ],
    write: false,
    bundle: true,
    format: "iife",
    globalName: "WrapperPage",
    platform: "browser",
    target: "chrome120",
  });
  engine = bundled.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

it.each([
  {
    name: "split rendered paragraphs and an inline Search pill",
    mixed: false,
    split: true,
  },
  {
    name: "old primary role nodes with fresh search-key turns",
    mixed: true,
    split: false,
  },
  {
    name: "mixed selectors and split rendered paragraphs together",
    mixed: true,
    split: true,
  },
  {
    name: "nested role/search representations and split paragraphs",
    mixed: true,
    split: true,
    nested: true,
  },
])(
  "confirms the sent prompt once with $name",
  async ({ mixed, split, nested }) => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<!doctype html><body>
      ${mixed ? '<article><div data-message-author-role="user">Old user.</div></article><article><div data-message-author-role="assistant"><div class="markdown">Stale answer.</div></div><button aria-label="Copy">Copy</button></article>' : ""}
      <textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>
      <script>
        window.sends = 0;
        document.querySelector('button[data-testid="send-button"]').onclick = () => {
          window.sends++;
          const prompt = document.querySelector('textarea').value;
          const user = document.createElement('article');
          user.setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-4:0:user');
          const content = document.createElement('div');
          if (${!!nested}) content.setAttribute('data-message-author-role', 'user');
          user.append(content);
          const pill = document.createElement('button'); pill.textContent = 'Search'; user.append(pill);
          if (${split}) {
            for (const paragraph of prompt.split('\\n\\n')) { const p = document.createElement('p'); p.className = 'whitespace-pre-wrap'; p.textContent = paragraph; content.append(p); }
          } else { const body = document.createElement('div'); body.className = 'whitespace-pre-wrap'; body.textContent = prompt; content.append(body); }
          document.body.append(user);
          const assistant = document.createElement('article');
          assistant.setAttribute('data-talvt-turn-state','complete');
          assistant.innerHTML = '<div data-chatgpt-search-unit-key="fallback-turn-5:0:assistant"><div class="markdown">Fresh sourced answer.</div><img src="https://example.invalid/favicon.ico"></div><button aria-label="Copy">Copy</button>';
          if (${!!nested}) assistant.querySelector('.markdown').parentElement.setAttribute('data-message-author-role', 'assistant');
          document.body.append(assistant);
          document.querySelector('textarea').value = '';
        };
      </script>`);
      await page.evaluate(engine + ";globalThis.WrapperPage = WrapperPage;");
      const result = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            WrapperPage: {
              executeInPage: (
                doc: Document,
                request: unknown,
                signal: AbortSignal,
                options: unknown,
              ) => Promise<{ text: string }>;
            };
          }
        ).WrapperPage;
        return api.executeInPage(
          document,
          {
            capability: "research.search",
            objective: "Explain public node:sqlite documentation.",
            acceptanceCriteria: [],
            allowedPaths: [],
            timeoutSeconds: 0.5,
          },
          new AbortController().signal,
          { pollMs: 5, stableMs: 10 },
        );
      });
      expect(result.text).toBe("Fresh sourced answer.");
      expect((result as { images?: unknown[] }).images).toEqual([]);
      expect(
        await page.evaluate(
          () => (window as unknown as { sends: number }).sends,
        ),
      ).toBe(1);
    } finally {
      await page.close();
    }
  },
);

it.each([
  "data-message-id",
  "data-turn-id",
  "data-chatgpt-search-unit-key",
  "reuse:data-message-id",
])(
  "confirms a fresh %s after history virtualizes and rejects rerendered identical old turns",
  async (attribute) => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        '<main></main><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>',
      );
      await page.evaluate(engine + ";globalThis.WrapperPage = WrapperPage;");
      const result = await page.evaluate(
        async ({ attribute, reuse }) => {
          const request = {
            capability: "research.search",
            objective: "Explain public node:sqlite documentation.",
            acceptanceCriteria: [],
            allowedPaths: [],
            timeoutSeconds: 1,
          };
          const api = (
            window as unknown as {
              WrapperPage: {
                promptFor: (request: unknown) => string;
                executeInPage: (
                  doc: Document,
                  request: unknown,
                  signal: AbortSignal,
                  options: unknown,
                ) => Promise<{ text: string }>;
              };
            }
          ).WrapperPage;
          const prompt = api.promptFor(request);
          const main = document.querySelector("main")!;
          const append = (id: string, role: string, text: string) => {
            const article = document.createElement("article");
            // Identity belongs to the containing turn, not the role node itself.
            article.setAttribute(
              attribute,
              attribute === "data-chatgpt-search-unit-key"
                ? `${id}:0:${role}`
                : `${id}-${role}`,
            );
            const body = document.createElement("div");
            body.setAttribute("data-message-author-role", role);
            if (role === "assistant") {
              const markdown = document.createElement("div");
              markdown.className = "markdown";
              markdown.textContent = text;
              body.append(markdown);
            } else body.textContent = text;
            article.append(body);
            if (role === "assistant") {
              const copy = document.createElement("button");
              copy.setAttribute("aria-label", "Copy");
              article.append(copy);
            }
            main.append(article);
          };
          for (let i = 1; i <= 3; i++) {
            append(`old-${i}`, "user", prompt);
            append(`old-${i}`, "assistant", "Stale identical history answer.");
          }
          const reused = Array.from(main.children).slice(-2);
          let sends = 0;
          document
            .querySelector('[data-testid="send-button"]')!
            .addEventListener("click", () => {
              sends++;
              main.replaceChildren();
              // Recreated historical DOM has the identical prompt at index zero.
              // It must not confirm submission merely because its Element is new.
              if (reuse) main.append(...reused);
              else {
                append("old-3", "user", prompt);
                append("old-3", "assistant", "Stale identical history answer.");
              }
              setTimeout(() => {
                if (reuse) {
                  reused[0].setAttribute(attribute, "fresh-4-user");
                  reused[1].setAttribute(attribute, "fresh-5-assistant");
                  reused[1].querySelector(".markdown")!.textContent =
                    "Fresh virtualized answer.";
                } else {
                  main.replaceChildren();
                  append("fresh-4", "user", prompt);
                  append("fresh-5", "assistant", "Fresh virtualized answer.");
                }
              }, 80);
            });
          const output = await api.executeInPage(
            document,
            request,
            new AbortController().signal,
            { pollMs: 5, stableMs: 10 },
          );
          return { output, sends };
        },
        {
          attribute: attribute.replace("reuse:", ""),
          reuse: attribute.startsWith("reuse:"),
        },
      );
      expect(result.output.text).toBe("Fresh virtualized answer.");
      expect(result.sends).toBe(1);
    } finally {
      await page.close();
    }
  },
);
