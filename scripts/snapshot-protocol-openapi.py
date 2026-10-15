"""Pin the public OpenAPI operations exercised by the scripted HTTP fixtures.

Usage: python3 scripts/snapshot-protocol-openapi.py /path/to/docs-v2
Requires PyYAML. This only reads the source checkout and writes test fixtures.
"""

import json
from pathlib import Path
import subprocess
import sys

import yaml

source = Path(sys.argv[1]).resolve()
commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
destination = Path(__file__).resolve().parent.parent / "tests/fixtures/openapi"
operations = {
    "/api/v3/query_sql": "post",
    "/api/v3/query_influxql": "post",
    "/api/v3/configure/database": "get",
    "/health": "get",
    "/ping": "get",
}


def references(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref":
                yield item
            else:
                yield from references(item)
    elif isinstance(value, list):
        for item in value:
            yield from references(item)


for product in ["core", "enterprise"]:
    relative = f"api-docs/influxdb3/{product}/influxdb3-{product}-openapi.yaml"
    spec = yaml.safe_load((source / relative).read_text())
    paths = {path: {method: spec["paths"][path][method]} for path, method in operations.items()}
    components = {}
    pending = list(references(paths))
    seen = set()
    while pending:
        ref = pending.pop()
        if ref in seen:
            continue
        seen.add(ref)
        _, root, group, name = ref.split("/")
        if root != "components":
            raise ValueError(f"Unsupported reference: {ref}")
        value = spec["components"][group][name]
        components.setdefault(group, {})[name] = value
        pending.extend(references(value))
    snapshot = {
        "provenance": {"repository": "influxdata/docs-v2", "commit": commit, "path": relative},
        "openapi": spec["openapi"],
        "info": spec["info"],
        "paths": paths,
        "components": components,
    }
    (destination / f"{product}-openapi.json").write_text(json.dumps(snapshot, indent=2) + "\n")

subprocess.run(
    ["npx", "--no-install", "prettier", "--write", *[str(destination / f"{product}-openapi.json") for product in ["core", "enterprise"]]],
    cwd=destination.parents[2],
    check=True,
)
