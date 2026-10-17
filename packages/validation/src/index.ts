import { producesImage, type TaskRequest } from "@chatgpt-wrapper/contracts";
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
