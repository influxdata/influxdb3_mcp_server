import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "BESS MCP App", version: "1.0.0" }, {});
const $ = (id) => document.getElementById(id);
let initialized = false;

function renderSnapshot(data) {
  const { result, connection } = data;
  $("connection").textContent = `${connection.database} · ${connection.host}`;
  if (!initialized) {
    initialized = true;
    $("prompt").value =
      `In ${connection.database}, which battery pack needs attention? Inspect the schema and fresh cell readings. Show the SQL and result completeness. Keep the answer under 120 words.`;
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
  if (data?.kind === "agent") {
    $("ask").disabled = data.status === "running";
    $("status").textContent =
      data.status === "running"
        ? `Agent investigating… ${(data.events || []).map((e) => e.tool).join(" → ")}`
        : data.status === "completed"
          ? "Agent finished."
          : "Agent could not finish.";
    $("answer").textContent = data.answer || "";
    $("agent-evidence").hidden = !data.events?.length;
    $("trace").textContent = (data.events || [])
      .map(
        (e) =>
          `${e.tool} · ${e.status}\n${JSON.stringify(e.arguments, null, 2)}`,
      )
      .join("\n\n");
    $("agent-error").textContent = data.error || "";
  }
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
    "This host does not support sending prompts. Use a compatible host or the example browser host.";
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
  } catch (error) {
    $("agent-error").textContent = error.message;
    $("ask").disabled = false;
  }
};
