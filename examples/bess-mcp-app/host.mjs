import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

const frame = document.querySelector("iframe");
const bridge = new AppBridge(
  null,
  { name: "BESS browser host", version: "1.0.0" },
  { serverTools: {}, message: { text: {} } },
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
bridge.onmessage = async (params) => {
  const prompt = params.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  const response = await fetch("/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const started = await response.json();
  if (!response.ok) throw Error(started.error || "Agent could not start");
  const poll = async () => {
    try {
      const response = await fetch(`/agent/${started.id}`);
      const run = await response.json();
      if (!response.ok) throw Error(run.error);
      await bridge.sendToolResult({
        content: [],
        structuredContent: { kind: "agent", ...run },
      });
      if (run.status === "running") setTimeout(poll, 1000);
    } catch (error) {
      await bridge.sendToolResult({
        content: [],
        structuredContent: {
          kind: "agent",
          status: "failed",
          error: error.message,
        },
      });
    }
  };
  void poll();
  return {};
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
