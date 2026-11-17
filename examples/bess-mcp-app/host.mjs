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

let refreshTimer;
for (const action of ["heat", "reset"]) {
  document.getElementById(action).onclick = async () => {
    const status = document.getElementById("scenario-status");
    const buttons = ["heat", "reset"].map((id) => document.getElementById(id));
    buttons.forEach((button) => {
      button.disabled = true;
    });
    clearTimeout(refreshTimer);
    try {
      const response = await fetch("/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Scenario change failed");
      status.textContent =
        action === "heat"
          ? "Heating pack-0 / mod-3 / cell-5 to 80°C. Refreshing in 12 seconds. Active for 10 minutes."
          : "Returning to normal temperatures. Refreshing telemetry…";
      refreshTimer = setTimeout(
        async () => {
          try {
            const snapshot = await bridge.oncalltool({
              name: "read_bess_snapshot",
              arguments: {},
            });
            await bridge.sendToolResult(snapshot);
            if (snapshot.isError)
              throw Error(
                "Telemetry refresh failed. Check the simulator and refresh manually.",
              );
            status.textContent =
              action === "heat"
                ? "Hot-cell scenario selected. Check the telemetry, then ask the agent to investigate. Resets automatically after 10 minutes."
                : "Normal scenario selected. Check the telemetry, then ask the agent again.";
          } catch (error) {
            status.textContent = error.message;
          }
        },
        action === "heat" ? 12000 : 1500,
      );
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  };
}
