const base = "http://localhost:8181/";
const token = "apiv3_sensor_demo";
const database = "sensor_demo";
const headers = { Authorization: `Bearer ${token}` };

const create = await fetch(new URL("api/v3/configure/database", base), {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ db: database }),
});
if (!create.ok && create.status !== 409) {
  throw new Error(
    `Create database: HTTP ${create.status} ${await create.text()}`,
  );
}

// Timestamps are hourly, from 30 minutes to 23.5 hours before execution.
const nowSeconds = Math.floor(Date.now() / 1000);
const temperatures = { alpha: 21, beta: 28, gamma: 24 };
const lines = Object.entries(temperatures).flatMap(([sensor, value]) =>
  Array.from(
    { length: 24 },
    (_, hour) =>
      `temperature,sensor=${sensor} value=${value}.0 ${nowSeconds - hour * 3600 - 1800}`,
  ),
);
const write = new URL("api/v3/write_lp", base);
write.searchParams.set("db", database);
write.searchParams.set("precision", "second");
const response = await fetch(write, {
  method: "POST",
  headers,
  body: lines.join("\n"),
});
if (!response.ok) {
  throw new Error(
    `Write points: HTTP ${response.status} ${await response.text()}`,
  );
}
console.log(`Wrote ${lines.length} points to ${database}.temperature`);
