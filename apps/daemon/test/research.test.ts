import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  extractResearchSources,
  validateText,
} from "@chatgpt-wrapper/validation";
import type { TaskRequest } from "@chatgpt-wrapper/contracts";
import { enableResearch } from "../src/browser-research.js";

it("extracts bounded observed sources, deduplicates fragments, and rejects unsafe URLs", () => {
  expect(
    extractResearchSources(
      "[Paper](https://example.com/a?q=1#one) [Again](https://example.com/a?q=1#two) [bad](javascript:alert(1)) [credentials](https://user:pass@example.org/)",
    ),
  ).toEqual([{ url: "https://example.com/a?q=1", title: "Paper" }]);
  expect(
    extractResearchSources(
      Array.from(
        { length: 70 },
        (_, i) => `[Source ${i}](https://example.com/${i})`,
      ).join(" "),
    ),
  ).toHaveLength(50);
});
it("rejects research with no usable source citation", () => {
  const request = {
    capability: "research.search",
    allowedPaths: [],
  } as unknown as TaskRequest;
  expect(() => validateText("I researched this [1].", request)).toThrow(
    "source link",
  );
  expect(() => validateText("[bad](ftp://example.com)", request)).toThrow(
    "source link",
  );
  expect(validateText("[Source](https://example.com)", request)).toContain(
    "nonempty text",
  );
});
let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});
afterAll(async () => {
  await browser?.close();
});
it("accepts a visibly selected Search tool", async () => {
  await page.setContent(
    '<button data-testid="search-tool" aria-pressed="true">Search</button>',
  );
  await enableResearch(page, new AbortController().signal);
});
it("selects Search through Tools and verifies its state", async () => {
  await page.setContent(
    `<button onclick="document.querySelector('div').hidden=false">Tools</button><div hidden><button role="menuitemcheckbox" aria-checked="false" onclick="this.setAttribute('aria-checked','true')">Search the web</button></div>`,
  );
  await enableResearch(page, new AbortController().signal);
  expect(
    await page.getByRole("menuitemcheckbox").getAttribute("aria-checked"),
  ).toBe("true");
});
it("fails closed when Search is absent or clicking does not select it", async () => {
  await page.setContent("<button>Research</button>");
  await expect(
    enableResearch(page, new AbortController().signal),
  ).rejects.toMatchObject({
    code: "RESEARCH_UNAVAILABLE",
    status: "NEEDS_HUMAN",
  });
  await page.setContent('<button data-testid="search-tool">Search</button>');
  await expect(
    enableResearch(page, new AbortController().signal),
  ).rejects.toMatchObject({ code: "RESEARCH_UNAVAILABLE" });
});
it("honors cancellation before UI interaction", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(enableResearch(page, controller.signal)).rejects.toThrow(
    "cancelled",
  );
});
it("selects the live custom Web search row and verifies its inline composer token", async () => {
  await page.setContent(`<button aria-label="Search" onclick="window.sidebarClicks++">Search</button>
    <button aria-label="Add files and more" onclick="window.toolsClicks++; document.querySelector('#tools').hidden=false">+</button>
    <div id="tools" hidden><button data-list-navigation-item="true" onclick="window.searchClicks++; document.querySelector('#composer').innerHTML='<span data-inline-selection-pill data-system-hint-type=&quot;search&quot; data-prompt-link-href=&quot;chatgpt-system-hint://search&quot; contenteditable=&quot;false&quot;>Web search</span>'; document.querySelector('#tools').hidden=true"><span>Web search</span><span>Find real-time news and info</span></button></div>
    <div id="composer" contenteditable="true" data-composer-markdown></div>
    <script>window.toolsClicks=0; window.searchClicks=0; window.sidebarClicks=0;</script>`);
  await enableResearch(page, new AbortController().signal);
  await enableResearch(page, new AbortController().signal);
  expect(
    await page.evaluate(() => ({
      tools: (window as any).toolsClicks,
      search: (window as any).searchClicks,
      sidebar: (window as any).sidebarClicks,
    })),
  ).toEqual({ tools: 1, search: 1, sidebar: 0 });
});
it("does not treat an inline search token outside the composer as active", async () => {
  await page.setContent(
    '<span data-inline-selection-pill data-system-hint-type="search" data-prompt-link-href="chatgpt-system-hint://search" contenteditable="false">Web search</span>',
  );
  await expect(
    enableResearch(page, new AbortController().signal),
  ).rejects.toMatchObject({ code: "RESEARCH_UNAVAILABLE" });
});
