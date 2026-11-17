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
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BESS MCP App</title><link rel="icon" href="data:,"><style>
body{margin:0;background:#f8f9ff;color:#020a47;font:15px/1.45 system-ui,sans-serif}
.controls{padding:16px 28px;border-bottom:1px solid #c9cbdd;display:flex;align-items:center;gap:12px;flex-wrap:wrap;max-width:1100px;margin:auto}
button{font:inherit;font-weight:600;padding:9px 15px;border:1px solid #68359d;border-radius:7px;background:white;color:#68359d;cursor:pointer}
button:first-of-type{background:#68359d;color:white}button:disabled{opacity:.55;cursor:wait}
#scenario-status{flex-basis:100%;font-size:14px;margin:0}iframe{display:block;width:100%;height:100vh;border:0}
</style></head><body><section class="controls" aria-label="Simulator controls"><strong>Try the scenario</strong><button id="heat">Trigger hot cell</button><button id="reset">Reset scenario</button><p id="scenario-status" role="status">Simulator controls only. The agent uses read-only database tools.</p></section><iframe title="BESS MCP App" sandbox="allow-scripts"></iframe><script type="module" src="/host.js"></script></body></html>`,
);
console.log("Built the BESS MCP App and browser host.");
