---
name: autocad-bridge
description: "Use when driving a live AutoCAD drawing through an in-process HTTP bridge (localhost:5599) — generic CAD verbs reusable across projects."
triggers:
  - Inspecting entities, layers, blocks, or XData in a live AutoCAD drawing via HTTP
  - Finding/selecting/zooming entities, managing named sets, running raw CAD commands
  - Setting up an AutoCAD debug bridge for a non-Raindrop project
---

# AutoCAD Debug Bridge (generic CAD verbs)

An in-process HTTP bridge on `localhost:5599` that exposes **generic AutoCAD
operations** to an agent. This document covers the CAD-generic verbs only —
the ones that don't depend on any particular plugin's domain model. In
Raindrop these live in the same `DebugBridgeService` partial class as the
Raindrop-specific verbs (see `raindrop-bridge-usage`); the intent is that the
generic set can be factored into a standalone reusable library for any AutoCAD
project.

## Lifecycle

- Starts inside the plugin's DEBUG build (auto-starts on AutoCAD Idle), or
  via the `RD_DEBUGBRIDGE` command.
- Bound to loopback only — no admin/urlacl needed.
- `GET /ping` is the cheap liveness + drawing/units check.

## Generic verbs (project-agnostic)

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/ping` | Plugin version, drawing path, units. Works on corrupted drawings. |
| GET | `/summary` | Entity counts by category. Good first orienting call. |
| GET | `/layers?search=&prefix=` | Layers + entity counts + visibility state. Resolve fuzzy layer names. |
| GET | `/entities?app=` | Entities carrying an XData app name. |
| GET | `/xdata?handle=|app=` | Read XData tags on entities. |
| GET | `/blockdef` | Block definitions (with their contents/XData). |
| POST | `/blockdef-relayer-text` | Move nested text off block definitions to a target layer. |
| POST | `/find {producer}` | Resolve entities to handles. Producers: `layer`, `kind`, `app`, `handles`, `set`, `selected`, `insidePolyline`, `zone`/`zones`, `filter`, `ofValve`. `closedPolylines:true` post-filters to closed polylines. `saveAs` stores as a named set. |
| GET/POST/DELETE | `/sets` | Named entity-set lifecycle. |
| POST | `/select` | Set the pick-first selection to a handle collection. |
| GET | `/clear` | Clear the selection. |
| POST | `/zoom` | Zoom to a collection/point. |
| POST | `/show` | Highlight/display entities. |
| POST | `/run` | Fire a raw CAD command with no selection. Hangs if it prompts. |
| POST | `/exec` | Set pick-first selection then fire a raw `IR_*` command. Same hang risk. |
| GET | `/redraw` | Regen the active viewport. |
| POST | `/prompt {kind,msg}` | Delegate a pick to the user, get handles back. Blocks until they pick. |

## Entity collection (the core primitive)

`POST /find` is the workhorse — turn a selection criterion into a list of
handles. Compose producers; `closedPolylines:true` is how you get only closed
boundary polylines from a layer. `saveAs` persists the result as a named set
so later calls don't need the handle list.

```bash
curl -s -X POST http://localhost:5599/find -H "Content-Type: application/json" \
  -d '{"layer":"Perimeter Sprays","closedPolylines":true,"saveAs":"my-boundaries"}'
```

## Error-handling caveats

- **Purged entities:** iterating model space on a drawing with purged entities
  throws `ePermanentlyErased`. `/ping` still works (doesn't touch model space);
  `/summary` crashes. Wrap every `tr.GetObject(id, ...)` in a try/catch in the
  bridge code. This is the single most common "every endpoint errors but /ping
  works" cause.
- **Raw command verbs (`/run`, `/exec`) are dangerous** — a prompting command
  hangs the bridge until Esc in AutoCAD. Prefer purpose-built verbs.
- `POST /find` drops non-polyline/non-closed results when `closedPolylines` is
  set — check the `summary`/`skippedNonPolyline` fields.

## Tool manifest rule (if this powers an LLM)

The model's knowledge of what it can do comes entirely from the tool manifest
the bridge advertises (`/capabilities` → `BuildToolManifest()`), pushed to the
model at connect time — the model host/relay holds no copy. **Any new endpoint
MUST gain a `T("...")` entry in the manifest or the model can't see it.** A
verb that works in curl but is missing from `/capabilities` is invisible to the
LLM. When the manifest and routing switch drift, the model "doesn't know it can
do X" — fix the manifest, rebuild, redeploy. See
`raindrop-development/references/enki-relay-tool-manifest.md` for the exact
`T(...)`/`P(...)` signature and a worked example.

## Factoring into a reusable library (the plan)

The generic verbs above depend only on the AutoCAD API + a small `Active`
singleton — no plugin domain model. To reuse them in another AutoCAD project:

1. Convert the `switch`-based router + `partial class` into a
   **handler-registration** pattern: a `CadBridgeCore` library owns the
   `HttpListener` loop + generic verbs + an `IRouteHandler` registration API.
2. The consuming project registers its domain endpoints (e.g. Raindrop's
   `/op`, `/inventory`, `/zones`) into the core.
3. Partial classes can't span assemblies — this is the key reason the split is
   a refactor, not a file move.

Not yet done — the bridge is still one monolithic partial class. This document
is the target design for the generic half.
