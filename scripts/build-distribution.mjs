import { build } from "esbuild";
import { readFile, mkdir, copyFile, chmod } from "node:fs/promises";
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("dist", { recursive: true });
await build({
  entryPoints: {
    cli: "apps/daemon/src/cli.ts",
    daemon: "apps/daemon/src/index.ts",
    mcp: "apps/daemon/src/mcp.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: Object.keys(manifest.dependencies),
  legalComments: "eof",
});
await copyFile("apps/daemon/dist/page-engine.js", "dist/page-engine.js");
await chmod("dist/cli.js", 0o755);
