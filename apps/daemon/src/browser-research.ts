import { ProviderError } from "@chatgpt-wrapper/adapters";
import type { Locator, Page } from "playwright";

const searchLabel = /^(Search|Search the web|Ara|Web'de ara|Web'de arama)$/i;
const unavailable = () =>
  new ProviderError(
    "RESEARCH_UNAVAILABLE",
    "ChatGPT Search could not be visibly enabled. Review the browser tab.",
    "NEEDS_HUMAN",
  );

/** Enable the visible Search tool and require an observable selected state. */
export async function enableResearch(
  page: Page,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  let toolsOpened = false;
  const candidates = () => {
    const standard = page
      .locator('[data-testid="search-tool"], [data-testid="search-mode"]')
      .or(
        page
          .getByRole("button", { name: searchLabel })
          .and(
            page.locator(
              "form button, button[aria-pressed], button[aria-checked]",
            ),
          ),
      )
      .or(page.getByRole("menuitemcheckbox", { name: searchLabel }))
      .or(page.getByRole("menuitem", { name: searchLabel }));
    // The live custom tools menu has navigation rows rather than ARIA menu items.
    // Only consider these rows after opening Tools, with an exact child label.
    return toolsOpened
      ? standard.or(
          page.locator('button[data-list-navigation-item="true"]').filter({
            has: page.locator("span").filter({ hasText: /^Web search$/i }),
          }),
        )
      : standard;
  };
  const selected = async () => {
    const controls = candidates();
    for (let i = 0; i < (await controls.count()); i++) {
      const control = controls.nth(i);
      if (
        (await control.isVisible()) &&
        ((await control.getAttribute("aria-pressed")) === "true" ||
          (await control.getAttribute("aria-checked")) === "true")
      )
        return true;
    }
    const activeTokens = page
      .locator(
        '[contenteditable="true"][data-composer-markdown], [role="textbox"]',
      )
      .locator(
        '[data-inline-selection-pill][data-system-hint-type="search"][data-prompt-link-href="chatgpt-system-hint://search"][contenteditable="false"]',
      );
    for (let i = 0; i < (await activeTokens.count()); i++) {
      const token = activeTokens.nth(i);
      if (
        (await token.isVisible()) &&
        /\bWeb search\b/i.test(await token.innerText())
      )
        return true;
    }
    const chips = page.locator(
      '[data-testid="active-search-chip"], [data-testid="search-tool-chip"][data-state="active"], [data-testid="search-mode"][data-state="active"]',
    );
    for (let i = 0; i < (await chips.count()); i++)
      if (await chips.nth(i).isVisible()) return true;
    return false;
  };
  const firstAvailable = async (controls: Locator) => {
    for (let i = 0; i < (await controls.count()); i++) {
      const control = controls.nth(i);
      if (
        (await control.isVisible()) &&
        (await control.isEnabled()) &&
        (await control.getAttribute("aria-disabled")) !== "true"
      )
        return control;
    }
    return undefined;
  };
  try {
    if (await selected()) return;
    let control = await firstAvailable(candidates());
    if (!control) {
      const tools = await firstAvailable(
        page.getByRole("button", {
          name: /^(Tools|More tools|Add files and more|Aç|Araçlar|\+)$/i,
        }),
      );
      if (!tools) throw unavailable();
      signal.throwIfAborted();
      await tools.click({ timeout: 2000 });
      toolsOpened = true;
      const menuDeadline = Date.now() + 2000;
      do {
        signal.throwIfAborted();
        control = await firstAvailable(candidates());
        if (control) break;
        await page.waitForTimeout(50);
      } while (Date.now() < menuDeadline);
    }
    if (!control) throw unavailable();
    signal.throwIfAborted();
    await control.click({ timeout: 2000 });
    const deadline = Date.now() + 2000;
    do {
      signal.throwIfAborted();
      if (await selected()) return;
      await page.waitForTimeout(50);
    } while (Date.now() < deadline);
    throw unavailable();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ProviderError) throw error;
    throw unavailable();
  }
}
