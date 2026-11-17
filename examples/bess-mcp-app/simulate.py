"""Feed simulated BESS readings using a credential unavailable to the agent."""
import argparse
from dataclasses import replace
import json
import os
from pathlib import Path
import signal
import time
import urllib.request
import urllib.parse

from simulator.signals import CellReading, InverterReading, PackReading, Site

ROOT = Path(__file__).resolve().parent
CONTROL = ROOT / ".runtime/scenario.json"


def set_event(mode, duration):
    CONTROL.parent.mkdir(mode=0o700, exist_ok=True)
    temporary = CONTROL.with_suffix(".tmp")
    temporary.write_text(json.dumps({"mode": mode, "started_at": time.time(), "duration_s": duration}))
    temporary.replace(CONTROL)
    print(f"Scenario: {mode}, duration: {duration}s")


def line(record, timestamp):
    # IDs come from the seeded simulator, not from request input.
    if isinstance(record, CellReading):
        return f"cell_readings,site={record.site},pack_id={record.pack_id},module_id={record.module_id},cell_id={record.cell_id} voltage={record.voltage},temperature_c={record.temperature_c} {timestamp}"
    if isinstance(record, PackReading):
        return f"pack_readings,site={record.site},pack_id={record.pack_id} current_a={record.current_a},soc={record.soc},soh={record.soh} {timestamp}"
    if isinstance(record, InverterReading):
        return f"inverter_readings,site={record.site} power_kw={record.power_kw} {timestamp}"
    raise TypeError("Unexpected simulator record")


def run(duration):
    config = json.loads((ROOT / "connection.json").read_text())
    host, database = config["host"].rstrip("/"), config["database"]
    credential = Path(os.environ.get("INFLUXDB_WRITE_TOKEN_FILE", ROOT / ".secrets/write.json"))
    token = json.loads(credential.read_text())["token"]
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    # Confirm that the selected database is accessible before the first write.
    request = urllib.request.Request(host + "/api/v3/query_sql", headers=headers,
        data=json.dumps({"db": database, "q": "SELECT table_name FROM information_schema.tables WHERE table_schema = 'iox'", "format": "json"}).encode())
    with urllib.request.urlopen(request, timeout=20) as response:
        json.load(response)
    if not CONTROL.exists():
        set_event("normal", 0)
    site, active = Site(site="S1", n_packs=4, seed=42), True

    def stop(*_):
        nonlocal active
        active = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    start, tick = time.monotonic(), 0
    while active and (duration is None or time.monotonic() - start < duration):
        cycle = time.monotonic()
        control = json.loads(CONTROL.read_text())
        age = time.time() - control["started_at"]
        heat = control["mode"] == "heat" and 0 <= age < control["duration_s"]
        lines = []
        for record in site.tick(tick):
            if heat and isinstance(record, CellReading) and (record.pack_id, record.module_id, record.cell_id) == ("pack-0", "mod-3", "cell-5"):
                record = replace(record, temperature_c=min(80.0, 28.0 + 5.0 * age))
            lines.append(line(record, time.time_ns()))
        params = urllib.parse.urlencode({"db": database, "precision": "nanosecond", "accept_partial": "false"})
        request = urllib.request.Request(host + "/api/v3/write_lp?" + params,
            data="\n".join(lines).encode(), headers={**headers, "Content-Type": "text/plain"})
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()
        tick += 1
        if tick % 10 == 0:
            print(f"Wrote {tick} batches of {len(lines)} simulated readings to {database}.", flush=True)
        time.sleep(max(0, 1 - (time.monotonic() - cycle)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["run", "heat", "reset"])
    parser.add_argument("--duration", type=int)
    args = parser.parse_args()
    if args.duration is not None and args.duration <= 0:
        parser.error("duration must be positive")
    if args.action == "run":
        run(args.duration)
    else:
        set_event("heat" if args.action == "heat" else "normal", args.duration or 180)
