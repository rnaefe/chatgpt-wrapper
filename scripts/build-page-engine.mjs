import { build } from "esbuild";
await build({
  entryPoints: ["apps/daemon/src/page-engine.ts"],
  outfile: "apps/daemon/dist/page-engine.js",
  bundle: true,
  format: "iife",
  globalName: "WrapperPage",
  platform: "browser",
  target: "chrome120",
  legalComments: "none",
});
