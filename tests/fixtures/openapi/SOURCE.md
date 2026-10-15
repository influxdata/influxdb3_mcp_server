# Pinned InfluxDB OpenAPI specs

The scenario contract test (`tests/scenario-contract.test.ts`) checks every
fake-server scenario against the published spec for its product.

| File | Source | Commit | Spec version |
| --- | --- | --- | --- |
| `influxdb3-core-openapi.json` | `influxdata/docs-v2` `api-docs/influxdb3/core/influxdb3-core-openapi.yaml` | `9c047fa25a70120245c3e56f35e2bfa5bc626a19` | v3.12.0 |

Each file is the upstream YAML converted to JSON, unedited. Pin the
Enterprise spec here when the first Enterprise scenario is added.

To refresh, pick a docs-v2 commit, then rerun the contract test and recheck
any scenario it reports:

```sh
SHA=<docs-v2 commit>
gh api -H "Accept: application/vnd.github.raw" \
  "repos/influxdata/docs-v2/contents/api-docs/influxdb3/core/influxdb3-core-openapi.yaml?ref=$SHA" \
  | node -e 'const y=require("js-yaml");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(y.load(s),null,2)+"\n"))' \
  > tests/fixtures/openapi/influxdb3-core-openapi.json
```

Update the commit and version in the table in the same change.
