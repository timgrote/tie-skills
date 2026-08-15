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
3. **`POST /op {"name":"sprinkler-block-check","series":"<key>"}`** → verify insertable block artwork BEFORE committing. **This is the gate that saves you:** a series whose nozzles map to an `Auto` placeholder block (`allInsertable:false`, `missingBlocks:['Auto']`) will place invisible heads. Do NOT commit such a series — tell the user the drawing lacks that block artwork.
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
- Manufacturer strings have spaces: `Rain Bird`, `Hunter`, `Toro`.
- Adjustable gear-drive rotors (Rain Bird 5000, Hunter I-20/I-25) may have NO block artwork in a given drawing (`Auto` placeholder) — verify with block-check; only fixed-arc MPR nozzles (e.g. `Rain Bird_1800 MPR_30`) reliably have real blocks.

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
