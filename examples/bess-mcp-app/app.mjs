import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "BESS MCP App", version: "1.0.0" }, {});
const $ = (id) => document.getElementById(id);
let initialized = false;

function renderSnapshot(data) {
  const { result, connection } = data;
  $("connection").textContent = `${connection.database} · ${connection.host}`;
  if (!initialized) {
    initialized = true;
    if (!$("prompt").value.trim())
      $("prompt").value =
        `In ${connection.database}, which battery pack needs attention using the demo threshold above 70°C? Inspect the schema and fresh cell readings. Show the SQL and result completeness. Keep the answer under 120 words.`;
  }
  const rows = result.rows || [];
  const packs = new Map();
  for (const row of rows) {
    if (!packs.has(row.pack_id)) packs.set(row.pack_id, []);
    packs.get(row.pack_id).push(row);
  }
  $("packs").replaceChildren();
  for (const [id, cells] of [...packs].sort(([a], [b]) => a.localeCompare(b))) {
    const maximum = Math.max(...cells.map((c) => Number(c.temperature_c)));
    const card = document.createElement("div");
    card.className = `pack${maximum > 70 ? " hot" : ""}`;
    const name = document.createElement("span");
    name.textContent = id;
    const value = document.createElement("strong");
    value.textContent = `${maximum.toFixed(1)}°C`;
    card.append(name, value);
    $("packs").append(card);
  }
  const hottest = [...rows].sort(
    (a, b) => b.temperature_c - a.temperature_c,
  )[0];
  $("heatmap").replaceChildren();
  if (hottest) {
    $("finding").textContent =
      hottest.temperature_c > 70
        ? `${hottest.pack_id} is above the demo threshold.`
        : "No fresh cells above the demo threshold.";
    $("location").textContent =
      `Hottest: ${hottest.module_id} / ${hottest.cell_id} · ${Number(hottest.temperature_c).toFixed(1)}°C`;
    for (const row of packs.get(hottest.pack_id)) {
      const module = /^mod-(\d+)$/.exec(row.module_id);
      const cell = /^cell-(\d+)$/.exec(row.cell_id);
      if (!module || !cell || Number(module[1]) >= 16 || Number(cell[1]) >= 12)
        continue;
      const pixel = document.createElement("div");
      pixel.className = "cell";
      pixel.style.gridColumn = String(Number(module[1]) + 1);
      pixel.style.gridRow = String(Number(cell[1]) + 1);
      pixel.style.background =
        row.temperature_c > 70
          ? "#d30971"
          : row.temperature_c > 35
            ? "#9b2aff"
            : "#5ee4e4";
      pixel.title = `${row.module_id} / ${row.cell_id}: ${Number(row.temperature_c).toFixed(1)}°C`;
      $("heatmap").append(pixel);
    }
  } else {
    $("finding").textContent = "No fresh cell readings.";
    $("location").textContent =
      "Check the simulator and refresh the telemetry.";
  }
  $("coverage").textContent =
    `${rows.length} cells · ${result.metadata?.completeness || "unknown completeness"} · ${new Date(data.checked_at).toLocaleTimeString()}`;
  $("snapshot-evidence").textContent =
    `${data.arguments.q}\n\n${JSON.stringify({ metadata: result.metadata, warnings: result.warnings }, null, 2)}`;
  $("snapshot-error").textContent = "";
}

app.ontoolresult = (raw) => {
  if (raw.isError) {
    $("snapshot-error").textContent =
      raw.content?.find((c) => c.type === "text")?.text || "MCP call failed";
    return;
  }
  const data = raw.structuredContent;
  if (data?.kind === "snapshot") renderSnapshot(data);
};
await app.connect();
$("refresh").disabled = false;
$("refresh").onclick = async () => {
  $("refresh").disabled = true;
  try {
    app.ontoolresult(
      await app.callServerTool({ name: "read_bess_snapshot", arguments: {} }),
    );
  } catch (error) {
    $("snapshot-error").textContent = error.message;
  } finally {
    $("refresh").disabled = false;
  }
};
const messaging = Boolean(app.getHostCapabilities()?.message?.text);
$("ask").textContent = "Ask agent";
$("ask").disabled = !messaging;
if (!messaging)
  $("status").textContent =
    "This browser preview has no agent. Open BESS in your MCP Apps client to send the prompt, or copy it into your connected client’s chat.";
$("ask").onclick = async () => {
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  $("ask").disabled = true;
  $("agent-error").textContent = "";
  $("status").textContent = "Sending the prompt to the agent…";
  try {
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: prompt }],
    });
    if (result.isError) throw Error("The host rejected the prompt.");
    $("status").textContent =
      "Prompt sent. Continue in your agent client’s chat.";
    $("ask").disabled = false;
  } catch (error) {
    $("agent-error").textContent = error.message;
    $("ask").disabled = false;
  }
};

let refreshTimer;
for (const action of ["heat", "reset"]) {
  $(action).disabled = false;
  $(action).onclick = async () => {
    for (const id of ["heat", "reset"]) $(id).disabled = true;
    clearTimeout(refreshTimer);
    try {
      const result = await app.callServerTool({
        name: action === "heat" ? "heat_bess" : "reset_bess",
        arguments: {},
      });
      if (result.isError)
        throw Error(
          result.content?.find((c) => c.type === "text")?.text ||
            "Scenario change failed",
        );
      $("scenario-status").textContent =
        action === "heat"
          ? "Heating pack-0 / mod-3 / cell-5 to 80°C. Refreshing in 12 seconds. Active for 10 minutes."
          : "Returning to normal temperatures. Refreshing telemetry…";
      refreshTimer = setTimeout(
        async () => {
          try {
            const snapshot = await app.callServerTool({
              name: "read_bess_snapshot",
              arguments: {},
            });
            app.ontoolresult(snapshot);
            if (snapshot.isError)
              throw Error("Check the simulator and refresh telemetry.");
            $("scenario-status").textContent =
              action === "heat"
                ? "Hot-cell scenario selected. Check the telemetry, then ask your agent to investigate. Resets automatically after 10 minutes."
                : "Normal scenario selected. Check the telemetry, then ask your agent again.";
          } catch (error) {
            $("scenario-status").textContent = error.message;
          }
        },
        action === "heat" ? 12000 : 1500,
      );
    } catch (error) {
      $("scenario-status").textContent = error.message;
    } finally {
      for (const id of ["heat", "reset"]) $(id).disabled = false;
    }
  };
}
