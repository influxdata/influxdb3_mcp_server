```json
[
  {
    "time": "2026-01-01T00:00:00",
    "cpu::usage_idle": 84.3,
    "cpu::usage_system": 3.2,
    "cpu::usage_user": 12.5
  },
  {
    "time": "2026-01-01T00:00:00",
    "cpu::usage_idle": 45.2,
    "cpu::usage_system": 9.7,
    "cpu::usage_user": 45.1
  }
]
```

Query: `SELECT /cpu::usage/ FROM metrics`  
Database: `host_system`  
Rows: 2 (not truncated)
