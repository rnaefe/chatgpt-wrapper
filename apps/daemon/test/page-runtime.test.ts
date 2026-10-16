import { it, expect } from "vitest";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
it("installs the shared engine into a real headless page", async () => {
  const browser = await chromium.launch({ headless: true });
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
  }
}, 20000);
