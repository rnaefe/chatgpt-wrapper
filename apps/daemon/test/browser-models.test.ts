import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readSelectedModel, selectModel } from "../src/browser-models.js";

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
const signal = () => new AbortController().signal;
async function fixture(
  options = "",
  switcher = '<button data-testid="model-switcher">Current</button>',
  confirms = true,
) {
  await page?.close();
  page = await browser.newPage();
  await page.setContent(`${switcher}<button id="send">Send</button><div role="menu" hidden>${options}</div>
    <script>
    window.sent = false;
    document.querySelector('#send').onclick = () => window.sent = true;
    const control = document.querySelector('[data-testid="model-switcher"]');
    if (control) control.onclick = () => document.querySelector('[role="menu"]').hidden = false;
    document.querySelectorAll('[role="menuitem"], [role="option"]').forEach(item => item.onclick = () => {
      ${confirms ? 'control.textContent = item.innerText.split("\\n")[0];' : ""}
      document.querySelector('[role="menu"]').hidden = true;
    });
    </script>`);
}
it("returns the current normalized exact label without opening the menu", async () => {
  await fixture();
  expect(await selectModel(page, "  CURRENT  ", signal())).toBe("Current");
  expect(await page.locator('[role="menu"]').isVisible()).toBe(false);
});
it("selects an exact visible title with a description and confirms the switcher", async () => {
  await fixture(
    '<div role="menuitem">Target Model<br>Helpful description</div><div role="menuitem">Target Model Pro</div>',
  );
  expect(await selectModel(page, " target   MODEL ", signal())).toBe(
    "Target Model",
  );
  expect(
    await page.evaluate(() => (window as unknown as { sent: boolean }).sent),
  ).toBe(false);
});
it.each(["", '<button disabled data-testid="model-switcher">Current</button>'])(
  "rejects unavailable controls",
  async (control) => {
    await fixture("", control);
    await expect(selectModel(page, "Target", signal())).rejects.toMatchObject({
      code: "MODEL_SELECTION_UNAVAILABLE",
      status: "NEEDS_HUMAN",
    });
  },
);
it("rejects hidden, disabled, outside-menu and fuzzy options without fallback", async () => {
  await fixture(
    '<div role="menuitem" hidden>Target</div><button role="menuitem" disabled>Target</button><div role="menuitem">Target Pro</div>',
  );
  await page.locator("body").evaluate((body) => {
    const node = document.createElement("div");
    node.setAttribute("role", "option");
    node.textContent = "Target";
    body.append(node);
  });
  await expect(selectModel(page, "Target", signal())).rejects.toMatchObject({
    code: "MODEL_NOT_FOUND",
  });
  expect(await page.locator('[data-testid="model-switcher"]').innerText()).toBe(
    "Current",
  );
});
it("rejects selection without a confirmed switcher change", async () => {
  await fixture('<div role="menuitem">Target</div>', undefined, false);
  await expect(selectModel(page, "Target", signal())).rejects.toMatchObject({
    code: "MODEL_SELECTION_UNCONFIRMED",
  });
}, 10000);
it("honors cancellation before any UI interaction", async () => {
  await fixture('<div role="menuitem">Target</div>');
  const controller = new AbortController();
  controller.abort(new Error("Cancelled test"));
  await expect(selectModel(page, "Target", controller.signal)).rejects.toThrow(
    "Cancelled test",
  );
  expect(await page.locator('[role="menu"]').isVisible()).toBe(false);
});
it("honors cancellation while waiting for options without selecting", async () => {
  await fixture('<div role="menuitem">Other</div>');
  const controller = new AbortController();
  const selection = selectModel(page, "Target", controller.signal);
  const result = expect(selection).rejects.toThrow("Cancelled in menu");
  await page.locator('[role="menu"]').waitFor({ state: "visible" });
  controller.abort(new Error("Cancelled in menu"));
  await result;
  expect(await page.locator('[data-testid="model-switcher"]').innerText()).toBe(
    "Current",
  );
});

async function effortFixture(confirms = true) {
  await page?.close();
  page = await browser.newPage();
  await page.setContent(`<button aria-label="Select ChatGPT model">Thinking effort<span>Medium</span></button>
    <div role="menu" data-radix-menu-content hidden>
      <div data-model-picker-view="simple" data-active="true"><span role="menuitem">Medium</span><span role="menuitem">Power</span><div role="menuitem" aria-label="Select model" data-model-picker-view-toggle="true">Select model</div></div>
      <div data-model-picker-view="models" aria-hidden="true" inert data-active="false">
        <div role="menuitemradio" aria-checked="true" data-model-selected="true">Fixture Alpha</div>
        <div role="menuitemradio" aria-checked="false" data-model-selected="false">Fixture Beta</div>
      </div>
    </div><script>
      window.selectedClicks = 0;
      const menu = document.querySelector('[role="menu"]');
      const simple = document.querySelector('[data-model-picker-view="simple"]');
      const models = document.querySelector('[data-model-picker-view="models"]');
      function activate(node, active) { node.setAttribute('data-active', String(active)); node.setAttribute('aria-hidden', String(!active)); node.inert = !active; }
      document.querySelector('button').onclick = () => { menu.hidden = false; activate(simple,true); activate(models,false); };
      document.querySelector('[data-model-picker-view-toggle]').onclick = () => { activate(simple,false); activate(models,true); };
      document.querySelectorAll('[role="menuitemradio"]').forEach(item => item.onclick = () => {
        window.selectedClicks++;
        ${confirms ? `document.querySelectorAll('[role="menuitemradio"]').forEach(option => { option.setAttribute('aria-checked', String(option === item)); option.setAttribute('data-model-selected', String(option === item)); });` : ""}
        menu.hidden = true;
      });
      document.addEventListener('keydown', event => { if(event.key === 'Escape') menu.hidden = true; });
    </script>`);
}
it("reveals the active model view and confirms selected state after the effort picker closes", async () => {
  await effortFixture();
  expect(await selectModel(page, "fixture beta", signal())).toBe(
    "Fixture Beta",
  );
  expect(await page.locator("button").innerText()).toBe(
    "Thinking effortMedium",
  );
  expect(await page.locator('[role="menu"]').isVisible()).toBe(false);
  expect(
    await page.evaluate(
      () => (window as unknown as { selectedClicks: number }).selectedClicks,
    ),
  ).toBe(1);
});
it("recognizes an already selected model without clicking its option", async () => {
  await effortFixture();
  expect(await selectModel(page, "Fixture Alpha", signal())).toBe(
    "Fixture Alpha",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { selectedClicks: number }).selectedClicks,
    ),
  ).toBe(0);
  expect(await page.locator('[role="menu"]').isVisible()).toBe(false);
});
it("reads explicit selected state rather than the effort trigger label", async () => {
  await effortFixture();
  expect(await readSelectedModel(page, signal())).toBe("Fixture Alpha");
  expect(await page.locator('[role="menu"]').isVisible()).toBe(false);
});
it("does not accept a hidden selected state or an effort value as a model", async () => {
  await effortFixture();
  await page
    .locator("[data-model-picker-view-toggle]")
    .evaluate((node) => node.remove());
  await expect(
    selectModel(page, "Fixture Alpha", signal()),
  ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
  await expect(selectModel(page, "Medium", signal())).rejects.toMatchObject({
    code: "MODEL_NOT_FOUND",
  });
});
it("requires explicit selected state confirmation when the trigger only shows effort", async () => {
  await effortFixture(false);
  await expect(
    selectModel(page, "Fixture Beta", signal()),
  ).rejects.toMatchObject({ code: "MODEL_SELECTION_UNCONFIRMED" });
}, 10000);
it("rejects the effort trigger text itself as a requested model", async () => {
  await effortFixture();
  await expect(
    selectModel(page, "Thinking effortMedium", signal()),
  ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
});
