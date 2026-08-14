# Loki Query Guide — Raindrop Logging Server

The Raindrop plugin ships Serilog → Grafana Loki telemetry. The server is at `logging.raindropirrigationsoftware.com`. The push endpoint (ingestion) is open; the query API requires an API key.

## Server Architecture

| Component | Location | Access |
|-----------|----------|--------|
| Loki | `https://logging.raindropirrigationsoftware.com/loki/api/v1/push` (POST) | Public (ingestion) |
| Loki query API | `https://logging.raindropirrigationsoftware.com/loki/api/v1/{query,query_range,labels,label/*,series}` | API key required |
| Grafana | `https://logging.raindropirrigationsoftware.com/grafana/` | Grafana auth (separate) |
| Server SSH | `ssh -i ~/.ssh/digitalocean_logging root@64.23.189.157` | SSH key |

Full server docs: `docs/logging-architecture.md` in the Raindrop repo.

## Authentication

The API key is stored in `~/.claude/.env` as `LOKI_API_KEY`. Query endpoints require it via the `X-API-Key` header:

```bash
curl -s -H "X-API-Key: $LOKI_API_KEY" \
  "https://logging.raindropirrigationsoftware.com/loki/api/v1/labels"
```

Do NOT use `Authorization: Bearer` — that's nginx basic auth, returns 401. The `X-API-Key` header is the correct mechanism (enforced at the nginx layer via a `map` directive).

## LogQL Query Patterns

### Discover labels
```bash
curl -s -H "X-API-Key: $KEY" ".../loki/api/v1/labels"
# → {"status":"success","data":["app","service_name"]}

curl -s -H "X-API-Key: $KEY" ".../loki/api/v1/label/app/values"
# → {"status":"success","data":["raindrop"]}
```

Only two labels: `app` (always `raindrop`) and `service_name` (always `raindrop`). All other fields are **structured metadata** in the JSON log line, queryable via `| json` pipeline.

### Query range (the main query endpoint)

```bash
# All raindrop logs, last 7 days, 100 entries
curl -s -H "X-API-Key: $KEY" \
  ".../loki/api/v1/query_range?query={app=\"raindrop\"}|json&limit=100&start=<ns>&end=<ns>&direction=forward"
```

Parameters:
- `query` — LogQL expression (URL-encoded)
- `limit` — max entries returned (default 100)
- `start` / `end` — nanosecond Unix timestamps (e.g. `str(int(time.time() * 1e9))`)
- `direction` — `forward` (chronological) or `backward`

### Useful LogQL filters

All log lines are JSON. Use `| json` to parse fields, then filter:

```logql
# Crash/fatal events
{app="raindrop"} |~ "(?i)(crash|exception|fatal)" | json

# Unhandled exceptions and crash recovery
{app="raindrop"} |~ "(Unhandled Exception|Recovered crash|IsTermination)" | json

# Drawing switch events
{app="raindrop"} |= "Drawing Switched" | json

# Drawing open/close events
{app="raindrop"} |= "Drawing Opened" | json
{app="raindrop"} |= "Drawing Closed" | json

# All events from a specific machine
{app="raindrop"} |= "SABINE" | json

# All events at error/warning level
{app="raindrop"} |~ "\"level\":\"(error|warning|critical)\"" | json
```

### Querying from execute_code (Python)

The API key lives in `~/.claude/.env` as `LOKI_API_KEY=<hex>`. Read and extract it:

```python
import json, subprocess, urllib.parse, time

# Extract the API key from ~/.claude/.env
env_path = "C:/Users/tim/.claude/.env"
with open(env_path) as f:
    for line in f:
        if line.startswith("LOKI_API_KEY="):
            LOKI_API_KEY = line.strip().split("=", 1)[1]
            break

BASE = "https://logging.raindropirrigationsoftware.com/loki/api/v1"

def loki_query(query, limit=100, hours_back=168):
    now_ns = str(int(time.time() * 1e9))
    start_ns = str(int((time.time() - hours_back * 3600) * 1e9))
    params = urllib.parse.urlencode({
        "query": query, "limit": str(limit),
        "start": start_ns, "end": now_ns, "direction": "forward"
    })
    url = f"{BASE}/query_range?{params}"
    r = subprocess.run(
        ["curl", "-s", "--max-time", "30",
         "-H", f"X-API-Key: {LOKI_API_KEY}", url],
        capture_output=True, text=True
    )
    return json.loads(r.stdout)

def parse_entries(result):
    entries = []
    if "data" in result and "result" in result["data"]:
        for stream in result["data"]["result"]:
            for ts, line in stream["values"]:
                entry = json.loads(line)
                entry["_ts"] = ts
                entries.append(entry)
    return entries

def ts_to_date(ts_ns):
    from datetime import datetime
    return datetime.utcfromtimestamp(int(ts_ns) / 1e9).strftime("%Y-%m-%d %H:%M:%S")
```

Note: The push endpoint (`POST /loki/api/v1/push`) is **open** (no auth) — Raindrop clients send logs without credentials. Only the query API requires the `X-API-Key` header.

## Log Entry Structure

Each log line is a JSON object. Key fields:

| Field | Description | Example |
|-------|-------------|---------|
| `level` | Log level: `info`, `warning`, `error`, `critical` | `"critical"` |
| `Action` | Lifecycle event name | `"Drawing Switched"`, `"Drawing Opened"`, `"Drawing Closed"`, `"Save"`, `"Loaded"` |
| `UserName` | License key suffix (e.g. `240ECA-V3`) or Windows username | `"teva"` |
| `UserDisplayName` | Display name if configured, else `UserName` | `"TIM"` |
| `MachineName` | Windows machine name | `"SABINE"` |
| `DrawingName` | Drawing file name | `"I-THF1.dwg"` |
| `DrawingPath` | Full path — **redacted to `"removed"` unless `IncludeDrawingPathsInLogs` is true** | `"D:\Dropbox\TIE\..."` or `"removed"` |
| `AppVersion` | Raindrop version | `"2026.7.22.30949"` |
| `AppName` | Build target | `"Raindrop_AutoCAD25"` |
| `BuildConfiguration` | `DEBUG` or `RELEASE` | `"RELEASE"` |
| `EnvironmentUserName` | `DOMAIN\user` | `"SABINE\teva"` |
| `message` / `MessageTemplate` | The log message (Serilog template) | |
| `StackTrace` | Full stack trace (for exceptions) | |
| `ExceptionType` | .NET exception type (for crashes) | `"System.InvalidOperationException"` |
| `IsTerminating` | Whether the exception terminated AutoCAD | `true` |

### User identity resolution

The `UserName` field is the **license key suffix** (e.g. `240ECA-V3`), NOT the person's name. When Tim refers to a person by name (e.g. "Ally"), cross-reference via:
1. Machine name (e.g. SABINE → teva)
2. License key suffix
3. Windows username (`EnvironmentUserName` field)

### Drawing path privacy

`IncludeDrawingPathsInLogs` defaults to `false` — drawing paths are redacted as `"removed"` in remote logs. The `DrawingName` field is always present. To get full paths, the user would need to enable `IncludeDrawingPathsInLogs` in Raindrop settings, but crash recovery logs (`Recovered crash from previous session`) include the full path regardless.

## Retention

Loki retention is approximately **30 days** (verified Jul 31, 2026: a 30-day `query_range` returned results from Jul 15; the Loki API rejects queries with a time range exceeding 30d1h with HTTP 400 `query length exceeds the limit`). Use `--since 30d` as the practical max window. Older events are not available via the query API.

## The `read-loki-logs` skill (helper script)

The repo has a local skill at `.claude/skills/read-loki-logs/` with `query.py` — a Python wrapper that handles auth (reads `LOKI_API_KEY` from `~/.claude/.env`), time-range math, and result formatting. Use it instead of raw curl:

```bash
python .claude/skills/read-loki-logs/query.py '<logql-query>' [--since 24h] [--limit 100] [--raw]
```

`--raw` returns the raw JSON (useful for piping into Python to extract structured fields like `CommandName`). Without `--raw`, it pretty-prints one event per line with timestamp, user, version, and the rendered message.

**Pitfall — the skill files can disappear from the working tree.** This happened on 2026-07-31: the skill was committed in `9c324107` but the files were missing from the working tree (possibly a `git rm` that got committed on another branch, or a force-push). If `python .claude/skills/read-loki-logs/query.py` fails with "file not found", restore it from git:

```bash
git checkout 9c324107 -- .claude/skills/read-loki-logs/
```

Then commit the restoration as part of your current work. The skill is tracked in the repo, so if it's missing, it's a working-tree issue, not a "never existed" issue.

## Pitfall: rendered lines show the message template, not interpolated values

Serilog log lines are stored as JSON with both a `Message` field (rendered) and a `MessageTemplate` field (the template with `{Placeholder}` tokens). For command-tracking logs, the **rendered `Message` shows the template** (`Command executed: {CommandName} by {UserName}...`), NOT the interpolated command name. This means a line filter like `|= "IR_MainlineAnalysis_old"` will **never match** even if that command ran — the actual command name lives in the structured `CommandName` field, not in the rendered message text.

**Wrong** (0 results even if the command ran):
```logql
{app="raindrop"} |= "IR_MainlineAnalysis_old"
```

**Right** — parse JSON and filter on the structured field:
```logql
{app="raindrop"} |= "Command executed:" | json | CommandName = "IR_MainlineAnalysis_old"
```

For substring/regex matches on a field, use `=~`:
```logql
{app="raindrop"} |= "Command executed:" | json | CommandName =~ "(?i).*Mainline.*"
```

To enumerate all distinct commands in a window, query raw JSON and extract `CommandName` from each entry (see the Python example above — `parse_entries` + a `collections.Counter` on `entry["CommandName"]`).

## Grafana

A Grafana instance is available at `https://logging.raindropirrigationsoftware.com/grafana/` for interactive dashboard queries. It has its own auth (not the Loki API key, not default admin/admin). Useful for ad-hoc exploration when you have credentials, but the API is more efficient for scripted queries.
