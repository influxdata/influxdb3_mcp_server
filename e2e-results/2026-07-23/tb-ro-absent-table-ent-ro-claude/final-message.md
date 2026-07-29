No table named "smoke" exists in any database (only a database named "smoke" with a table called "seed_marker", and other unrelated tables). Since no matching table was found, I did not run a `select *`.

```json
{
  "found": false,
  "table_name": "smoke",
  "searched_databases": ["_internal", "home", "host_system", "loadcap_probe", "smoke"],
  "note": "No table literally named 'smoke' exists. A database named 'smoke' exists but its only table is 'seed_marker'.",
  "result": null
}
```
