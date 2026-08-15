---
name: raindrop-bridge-usage
description: "How to operate Raindrop through its localhost debug bridge (localhost:5599) — the LLM/operator manual for driving live drawings."
triggers:
  - Telling Enki or an agent to lay out, inspect, or modify sprinklers/boundaries in a live Raindrop drawing
  - Reading entity/layer/XData state, running inventory/analysis, or boundary layout via the bridge
---

# Raindrop Bridge Usage (LLM operator manual)

Raindrop is an AutoCAD/BricsCAD irrigation plugin. Its **debug bridge** is an
in-process HTTP server on `localhost:5599` (DEBUG builds / `RD_DEBUGBRIDGE`)
that lets an agent (Enki, or any LLM) inspect and drive a **live** drawing.
Hit the bridge first to see real drawing state before touching code.

## When the bridge is up

- `GET /ping` — plugin version, open drawing path, units, isRaindropDrawing. Works even on corrupted drawings (doesn't touch model space).
- `GET /summary` — counts of zones/sprinklers/pipes/etc. Good orienting first call.
- `GET /capabilities` — the full tool manifest the model is given. **A verb that works in curl but is missing from /capabilities is invisible to Enki.** See `raindrop-development/references/enki-relay-tool-manifest.md`.

## Inspect the drawing

- `GET /layers?search=<substr>` or `?prefix=` — list layers with entity counts + visibility. Resolves fuzzy names like "the sprinkler boundary layer" → `3284-Perimeter Spray`.
- `POST /find {layer?, kind?, closedPolylines?, saveAs?, handles?, selected?}` — resolve entities to handles. `closedPolylines:true` grabs only closed boundary polylines. `saveAs` holds them as a named set for later ops.
- `GET /xdata?handle=<h>` or `?app=<appName>` — read entity XData tags.
- `POST /op {"name":"sprinkler-raw","handles":[...]}` — per-head state (nozzle, radius, arc, aim, anchor).

## The boundary-layout workflow (the main thing)

Canonical sequence for "lay out sprinklers around these boundaries":

1. **`GET /layers?search=perimeter`** → resolve the boundary layer's real name.
2. **`POST /op {"name":"sprinkler-series","manufacturer":"..."}`** → pick a series key. **Pitfall:** Rain Bird is stored as `"Rain Bird"` (with a space) — filtering `manufacturer:"RainBird"` returns 0. Filter `"Rain Bird"` or omit the filter.
3. **`POST /op {"name":"sprinkler-block-check","series":"<key>"}`** → **ADVISORY, not authoritative.** A `false`/`allInsertable:false` here means the *catalog series* rows carry an `Auto` placeholder `BlockName` (gear-drive rotors: Rain Bird 5000, Hunter I-20/I-25). It does **NOT** mean the layout can't work — if a sprinkler is selected in the palette, or a real head exists in the drawing, the insert path resolves a live block and succeeds. **Do not refuse based on block-check alone. The authoritative test is `layout-boundary-preview` — it writes nothing, so just run it and trust its result over block-check.**
4. **`POST /find {"layer":"<name>","closedPolylines":true}`** → boundary handles.
5. **`POST /op {"name":"layout-boundary-preview","handles":[...],"series":"<key>"}`** → dry-run placements (position, arc, aim, adjustedRadius) without writing. Inspect before committing.
6. **`POST /op {"name":"layout-boundary-commit","handles":[...],"series":"<key>"}`** → insert real heads.

`series` is optional — omit to use the palette's currently-selected sprinkler.

## Reading layout results

`layout-boundary-preview`/`-commit` return a placement list plus counts:
`placed`, `validBoundaryCount`, `skippedBoundaryCount`, `degenerateBoundaryCount`
(`>0` = a stretch the series couldn't cover), `failedInsertCount`, and
`uncontainedPlacementCount` (`>0` = a head landed outside its boundary —
a pinch too narrow for the install offset; this makes `status:"error"` even
though heads were placed).

## Series discovery quirks

- `sprinkler-series` without a filter returns ~377 series (imperial). Filter by manufacturer.
- Manufacturer strings have spaces: `Rain Bird`, `Hunter`, `Toro`. (Filtering `manufacturer:"RainBird"` — no space — returns 0.)
- Adjustable gear-drive rotors (Rain Bird 5000, Hunter I-20/I-25) may have NO block artwork in a given drawing (`Auto` placeholder) — verify with block-check; only fixed-arc MPR nozzles (e.g. `Rain Bird_1800 MPR_30`) reliably have real blocks.
- Series keys are `Manufacturer_Model_Pressure`, e.g. `Rain Bird_1800 MPR_30`, `Rain Bird_5000_35`. Check the exact key from `sprinkler-series` output — `_30`/`_40` variants of some series don't exist and return an error, not an empty result.

## Verified end-to-end example (Unit Test-Feet.dwg, 2026-08-15)

Test drawing: `D:\Dropbox\Raindrop Dev Work\Unit Examples\Unit Test-Feet.dwg` (feet units).

Layer names on this drawing: `3284-Perimeter Spray` (5 boundaries) and `3284-Perimeter Rotor` (3 boundaries).

Spray layer, Rain Bird 1800 MPR_30 — **works end-to-end**:
```bash
curl -s -X POST localhost:5599/op -H "Content-Type: application/json" \
  -d '{"name":"layout-boundary-commit","handles":["144E","144F","1452","145C","1472"],"series":"Rain Bird_1800 MPR_30"}'
# → placed:159, validBoundaries:5, degenerate:0, failedInsert:0, but uncontainedPlacementCount:1
#   (159 real heads inserted; 1 landed outside its boundary → status:"error" despite the insert)
```

Rotor layer, Rain Bird 5000 — **blocked by missing artwork**:
```bash
curl -s -X POST localhost:5599/op -H "Content-Type: application/json" \
  -d '{"name":"sprinkler-block-check","series":"Rain Bird_5000_35"}'
# → allInsertable:false, missingBlocks:["Auto"]  — every 5000 variant maps to an Auto placeholder.
```
Every Rain Bird 5000 variant (`5000_25/35/45/55/65`, `5000-MPR_*`, `5000-PRS_*`) and Hunter rotors (`I-20`, `I-25`) share the `Auto` placeholder problem in this drawing. The tool correctly refuses to place invisible heads — tell the user the drawing lacks that block artwork rather than forcing a layout.

## The 5000 mystery — series-PRESSURE mismatch (2026-08-15, root-caused)

The rotor layout failed repeatedly with "no insertable heads found" until the real cause was found: **the series key must match the drawing's MAPPED set, not the static catalog.**

- `sprinkler-series` reads the **static catalog** (`AID_Application.*Sprinklers`). It lists `Rain Bird_5000_35` etc. — but those catalog rows carry `BlockName="Auto"` (an unresolved placeholder), so a layout with them fails.
- The **drawing's mapped** catalog — what the palette actually shows and what inserts — is `Rain Bird_5000_55`, with real `SPR0~...` rotor blocks (`liveBlock=true`). This is read via `ActiveDWGSprinklers()`, NOT the static catalog.
- **Lesson: before a boundary layout, query the drawing's mapped catalog (`sprinkler-catalog`) to find the ACTUAL series key present, and use that exact key.** Don't pick a series from `sprinkler-series` (catalog) and assume it's insertable in the drawing. The pressure suffix matters — `_55` vs `_35` are different series.

New bridge verb (added 2026-08-15): **`sprinkler-catalog`** dumps the drawing's mapped set — `{name:"sprinkler-catalog", manufacturer?:'Rain Bird', series?:'Rain Bird 5000'}` → each entry: id, series, manufacturer, model, nozzle, pressure, radius, flow, blockName, isFullCircle, hasLiveBlockDef. This is the ground truth for "what's actually insertable in THIS drawing."

## When the model "can't do X"

If Enki claims a supported action isn't available, the tool manifest is stale.
Any verb added to the bridge MUST get a `T("...")` entry in
`BuildToolManifest()` (`DebugBridgeService.Tools.cs`) or it's invisible to the
model. Fix the manifest, rebuild, redeploy — never a relay-side change.
See `raindrop-development/references/enki-relay-tool-manifest.md`.

## Units

Bridge coordinates/radii are **drawing units** (feet drawings are 1:1 with
catalog feet). Some engine responses convert catalog feet → drawing units
already; when in doubt check `GET /ping`'s `unit` field and the `drawingUnitFactor`
notes in the op's own docs.

## Troubleshooting workflow

1. `GET /ping` — is the bridge even up? Which drawing?
2. `GET /summary` — does model-space iteration crash? If `{"error":"ePermanentlyErased"}`, the drawing has purged entities (see `raindrop-development` skill § ePermanentlyErased).
3. Read XData on real entities before reading code — isolate data-vs-code issues.
4. When Tim is troubleshooting a live drawing, **investigate and report — do not edit code** unless he says fix it.
