import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

const frame = document.querySelector("iframe");
const bridge = new AppBridge(
  null,
  { name: "BESS browser host", version: "1.0.0" },
  { serverTools: {} },
  { hostContext: { theme: "light", displayMode: "inline" } },
);
bridge.oncalltool = async (params) => {
  const response = await fetch("/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "MCP call failed");
  return result;
};
bridge.oninitialized = async () => {
  await bridge.sendToolResult(
    await bridge.oncalltool({ name: "open_bess", arguments: {} }),
  );
};
await bridge.connect(
  new PostMessageTransport(frame.contentWindow, frame.contentWindow),
);
frame.srcdoc = await (await fetch("/resource")).text();
