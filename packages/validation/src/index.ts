import {
  producesImage,
  type ResearchSource,
  type TaskRequest,
} from "@chatgpt-wrapper/contracts";
export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
export function validateText(text: string, request: TaskRequest): string[] {
  if (!text.trim() && !producesImage(request.capability))
    throw new Error("Provider returned an empty response");
  if (request.capability === "code.generate") {
    const code = text.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1[ \t]*$/m);
    const patch =
      /^--- (?:a\/|\/dev\/null)/m.test(text) &&
      /^\+\+\+ (?:b\/|\/dev\/null)/m.test(text);
    if ((!code || !code[2].trim()) && !patch)
      throw new Error(
        "Code generation requires a nonempty fenced code block or unified diff",
      );
  }
  if (
    request.capability === "research.search" &&
    extractResearchSources(text).length === 0
  )
    throw new Error(
      "Research requires at least one valid HTTP or HTTPS source link",
    );
  const checks = [
    ...(text.trim() ? ["nonempty text"] : ["text optional for image output"]),
    "output size bounded",
  ];
  if (Buffer.byteLength(text) > MAX_ARTIFACT_BYTES)
    throw new Error("Output exceeds 20 MiB");
  // Inspect unified-diff paths without applying or executing provider output.
  const paths = [...text.matchAll(/^(?:\+\+\+|---) (.+)$/gm)]
    .map((m) => m[1].split("\t")[0])
    .filter((p) => p !== "/dev/null")
    .map((p) => p.replace(/^[ab]\//, ""));
  for (const path of paths) {
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").includes("..")
    )
      throw new Error("Unsafe patch path");
    if (
      request.allowedPaths.length &&
      !request.allowedPaths.some(
        (p) => path === p || (p.endsWith("/") && path.startsWith(p)),
      )
    )
      throw new Error(`Patch path outside allowed scope: ${path}`);
  }
  if (paths.length)
    checks.push(
      "patch paths checked (patch syntax and acceptance criteria require client review)",
    );
  return checks;
}

export function validateImages(
  images: Array<{ data: Buffer; mime: string }>,
  request: TaskRequest,
): string[] {
  if (producesImage(request.capability) && images.length === 0)
    throw new Error("Provider did not return a generated image");
  return images.length ? ["generated images captured"] : [];
}

/** Observed source links only; extraction does not verify their claims or contents. */
export function extractResearchSources(text: string): ResearchSource[] {
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  const add = (raw: string, title: string) => {
    if (sources.length >= 50 || !/^https?:\/\//i.test(raw)) return;
    try {
      const url = new URL(raw);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return;
      url.hash = "";
      if (seen.has(url.href)) return;
      seen.add(url.href);
      sources.push({
        url: url.href,
        title: title.replace(/\s+/g, " ").trim().slice(0, 500) || url.hostname,
      });
    } catch {
      /* Ignore malformed URLs in provider text. */
    }
  };
  // Markdown links (including one balanced pair of parentheses in a URL).
  const links =
    /\[([^\]\n]*)\]\(<?((?:[^\s()<>]|\([^\s()<>]*\))+)>?(?:\s+["'][^"']*["'])?\)/gi;
  const remaining = text.replace(
    links,
    (_match, title: string, url: string) => {
      add(url, title);
      return " ";
    },
  );
  for (const match of remaining.matchAll(/https?:\/\/[^\s<>"'\[\]]+/gi)) {
    const url = match[0].replace(/[.,;:!?]+$/, "").replace(/\)+$/, "");
    add(url, "");
  }
  return sources;
}
