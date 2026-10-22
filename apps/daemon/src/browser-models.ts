import type { Locator, Page } from "playwright";
import { ProviderError } from "@chatgpt-wrapper/adapters";

const switcherSelector =
  '[data-testid="model-switcher-dropdown-button"], [data-testid="model-switcher"], [aria-label="Select ChatGPT model"]';
const surfaceSelector =
  '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-testid="model-switcher-dropdown"], [data-testid="model-switcher-menu"]';
const optionSelector =
  '[role="menuitem"]:not([data-model-picker-view-toggle]), [role="menuitemradio"], [role="option"], [data-testid^="model-option"], [data-testid^="model-switcher-option"]';
const normalize = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();
const failure = (code: string, message: string) =>
  new ProviderError(code, message, "NEEDS_HUMAN");
const guard = (signal: AbortSignal) => signal.throwIfAborted();

// The picker keeps inactive views laid out in a track. Geometry alone does not
// establish visibility: their ancestors explicitly mark them hidden and inert.
async function visible(locator: Locator): Promise<boolean> {
  return (
    (await locator.isVisible()) &&
    (await locator.evaluate(
      (node) =>
        !node.closest('[aria-hidden="true"], [inert], [data-active="false"]'),
    ))
  );
}
async function available(locator: Locator): Promise<boolean> {
  return (
    (await visible(locator)) &&
    (await locator.isEnabled()) &&
    (await locator.getAttribute("aria-disabled")) !== "true"
  );
}
async function labels(locator: Locator, accessible = true): Promise<string[]> {
  return locator.evaluate((node, accessible) => {
    const labelled = node
      .getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .map((id) => node.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    const text = (node as HTMLElement).innerText || node.textContent || "";
    return [
      accessible ? node.getAttribute("aria-label") || labelled || "" : "",
      text,
      text.split(/\r?\n/).find((line) => line.trim()) || "",
    ]
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }, accessible);
}
async function switcherFor(page: Page): Promise<Locator | undefined> {
  const controls = page.locator(switcherSelector);
  for (let i = 0; i < (await controls.count()); i++)
    if (await available(controls.nth(i))) return controls.nth(i);
}
async function optionsFor(page: Page): Promise<Locator[]> {
  const result: Locator[] = [];
  const surfaces = page.locator(surfaceSelector);
  for (let i = 0; i < (await surfaces.count()); i++) {
    const surface = surfaces.nth(i);
    if (!(await visible(surface))) continue;
    const options = surface.locator(optionSelector);
    for (let j = 0; j < (await options.count()); j++)
      if (
        (await visible(options.nth(j))) &&
        (await options
          .nth(j)
          .evaluate(
            (node) => !node.closest('[data-model-picker-view="simple"]'),
          ))
      )
        result.push(options.nth(j));
  }
  return result;
}
async function revealModels(
  page: Page,
  switcher: Locator,
  signal: AbortSignal,
) {
  let hasSurface = false;
  const surfaces = page.locator(surfaceSelector);
  for (let i = 0; i < (await surfaces.count()); i++)
    if (await visible(surfaces.nth(i))) {
      hasSurface = true;
      break;
    }
  if (!hasSurface) {
    guard(signal);
    await switcher.click({ timeout: 1000 });
  }
  const toggles = page.locator(
    `${surfaceSelector
      .split(", ")
      .map((surface) => `${surface} [data-model-picker-view-toggle="true"]`)
      .join(", ")}`,
  );
  for (let i = 0; i < (await toggles.count()); i++) {
    const toggle = toggles.nth(i);
    if (await available(toggle)) {
      guard(signal);
      await toggle.click({ timeout: 1000 });
      break;
    }
  }
}
async function selected(option: Locator): Promise<boolean> {
  return (
    (await option.getAttribute("aria-checked")) === "true" ||
    (await option.getAttribute("aria-selected")) === "true" ||
    (await option.getAttribute("data-model-selected")) === "true"
  );
}
async function dismiss(page: Page, signal: AbortSignal) {
  guard(signal);
  await page.keyboard.press("Escape");
  guard(signal);
  await page.keyboard.press("Escape");
}

/** Read explicit selected UI state, including pickers whose trigger shows effort. */
export async function readSelectedModel(
  page: Page,
  signal: AbortSignal,
): Promise<string | undefined> {
  guard(signal);
  const switcher = await switcherFor(page);
  if (!switcher) return undefined;
  try {
    await revealModels(page, switcher, signal);
    const deadline = Date.now() + 2000;
    do {
      guard(signal);
      for (const option of await optionsFor(page))
        if (await selected(option)) {
          const observed = await labels(option, false);
          const label = observed.at(-1);
          await dismiss(page, signal);
          return label;
        }
      await page.waitForTimeout(50);
    } while (Date.now() < deadline);
    await dismiss(page, signal);
  } catch {
    guard(signal);
  }
  return undefined;
}

/** Select only an exact label exposed by the browser UI; never submit a prompt. */
export async function selectModel(
  page: Page,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  guard(signal);
  const requested = normalize(model);
  const switcher = await switcherFor(page);
  if (!switcher || !requested)
    throw failure(
      "MODEL_SELECTION_UNAVAILABLE",
      "The ChatGPT model selector is unavailable. Review the browser tab.",
    );
  const observed = async () => {
    const values = await labels(switcher, false);
    // This public picker variant exposes an effort control at the trigger;
    // only its model list can establish model identity.
    if (values.some((value) => /^thinking\s+effort/i.test(value)))
      return undefined;
    return values.find((label) => normalize(label) === requested);
  };
  const current = await observed();
  if (current) return current;
  try {
    await revealModels(page, switcher, signal);
  } catch {
    guard(signal);
    throw failure(
      "MODEL_SELECTION_UNAVAILABLE",
      "The ChatGPT model selector is unavailable. Review the browser tab.",
    );
  }
  let candidate: Locator | undefined;
  const deadline = Date.now() + 2000;
  do {
    guard(signal);
    for (const option of await optionsFor(page)) {
      if (
        (await labels(option)).some(
          (label) => normalize(label) === requested,
        ) &&
        ((await selected(option)) || (await available(option)))
      ) {
        candidate = option;
        break;
      }
    }
    if (candidate) break;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  guard(signal);
  if (!candidate)
    throw failure(
      "MODEL_NOT_FOUND",
      "The requested model is not available in the ChatGPT model menu. Review the browser tab.",
    );
  try {
    if (await selected(candidate)) {
      const label = (await labels(candidate)).find(
        (label) => normalize(label) === requested,
      )!;
      await dismiss(page, signal);
      return label;
    }
    guard(signal);
    await candidate.click({ timeout: 1000 });
    const confirmationDeadline = Date.now() + 5000;
    do {
      guard(signal);
      const label = await observed();
      if (label) {
        await dismiss(page, signal);
        return label;
      }
      await revealModels(page, switcher, signal);
      for (const option of await optionsFor(page)) {
        const match = (await labels(option)).find(
          (value) => normalize(value) === requested,
        );
        if (match && (await selected(option))) {
          await dismiss(page, signal);
          return match;
        }
      }
      await page.waitForTimeout(50);
    } while (Date.now() < confirmationDeadline);
  } catch {
    guard(signal);
  }
  throw failure(
    "MODEL_SELECTION_UNCONFIRMED",
    "The requested model selection could not be confirmed. Review the browser tab.",
  );
}
