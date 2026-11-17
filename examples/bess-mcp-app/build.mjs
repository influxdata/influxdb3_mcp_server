import { build } from "esbuild";
import fs from "node:fs/promises";

await fs.mkdir("dist", { recursive: true });
const bundled = await build({
  entryPoints: ["app.mjs"],
  bundle: true,
  write: false,
  format: "esm",
  minify: true,
});
const html = (await fs.readFile("app.html", "utf8")).replace(
  "/*APP_SCRIPT*/",
  () => bundled.outputFiles[0].text.replaceAll("</script", "<\\/script"),
);
await fs.writeFile("dist/app.html", html);
await build({
  entryPoints: ["host.mjs"],
  bundle: true,
  outfile: "dist/host.js",
  format: "esm",
  minify: true,
});
await fs.writeFile(
  "dist/host.html",
  `<!doctype html><html><head><meta charset="utf-8"><title>BESS MCP App</title><link rel="icon" href="data:,"><style>body{margin:0}iframe{display:block;width:100%;height:100vh;border:0}</style></head><body><iframe title="BESS MCP App" sandbox="allow-scripts"></iframe><script type="module" src="/host.js"></script></body></html>`,
);
console.log("Built the BESS MCP App and browser host.");
