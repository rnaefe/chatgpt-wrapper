import { it, expect } from "vitest";
import { openProfile } from "../src/playwright-adapter.js";
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
