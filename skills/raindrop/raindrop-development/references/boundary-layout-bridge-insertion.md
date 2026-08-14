# Bridge layout insertion — harness algorithm → CAD (investigated 2026-08-02)

Tim's goal: read a selected boundary polyline through the debug bridge, run the harness's
improved layout algorithm on it, and insert the resulting sprinkler placements back into
the live CAD drawing — "I want to basically be able to have you use the bridge in this
project, find the selected boundary, run the layout, and then fire the sprinklers back
into CAD."

## Multi-boundary layout workflow (implemented 2026-08-13)

Tim's scenario: "I want to ask Enki to do a boundary layout on all boundaries on a
perimeter sprays layer with Rainbird 1800s." The bridge now supports this end-to-end
with three new capabilities:

### 0. Layer discovery — `GET /layers` (implemented 2026-08-13)

Lists every layer in the drawing with entity count and visibility state. Optional
`?search=` (case-insensitive substring) or `?prefix=` (case-insensitive prefix)
filters the list. This is the fuzzy-name resolution step when Enki needs to map
"the sprinkler boundary layer" to its actual name (`3284-Boundary Sprinkler`).

```bash
curl -s "http://localhost:5599/layers?search=boundary"
```

Response: `{ count, search, prefix, layers: [{name, entityCount, isOff, isFrozen, isLocked}] }`

Implemented in `DebugBridgeService.cs` (`BuildLayers`). Registered in the routing
switch + 404 endpoint list + tool manifest (`DebugBridgeService.Tools.cs`). The
entity-count scan is a single model-space traversal batched into a dictionary before
the layer-table loop, so cost is O(entities + layers), not O(entities × layers).

### 1. Series discovery — `sprinkler-series` op

Lists all non-strip sprinkler series from the active unit catalog. Optional
`manufacturer` filter. Returns series keys (Manufacturer_Model_Pressure) with
per-series head counts and nozzle/radius/flow/isFullCircle detail.

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" \
  -d '{"name":"sprinkler-series","manufacturer":"RainBird"}'
```

Response: `{ status, op, manufacturer, unitSystem, seriesCount, series: [{series, manufacturer, model, pressure, headCount, nozzles: [{id, nozzle, radius, flow, isFullCircle}]}] }`

Implemented in `DebugBridgeService.Phase4.cs`. Reads from `AID_Application.ImperialSprinklers` / `MetricSprinklers` depending on the drawing's unit setting. Filters out strip nozzles (same as `ResolveNonStripSeriesHeads`). Registered in `OpNames` array.

### 3. Closed-polyline filtering — `closedPolylines` flag on `/find`

Post-filters any producer's results to closed Polyline entities only. Composes with
`layer`, `selected`, `handles`, `insidePolyline` — anything that produces ids.

```bash
curl -s http://localhost:5599/find -X POST -H "Content-Type: application/json" \
  -d '{"layer":"Perimeter Sprays","closedPolylines":true,"saveAs":"my-boundaries"}'
```

Response includes `skippedNonPolyline` count. The `saveAs` named set lets subsequent
calls reference the boundary collection by name without managing handle lists.

Implemented in `DebugBridgeService.Tier2.cs` (`FindCollection`) + documented in
`DebugBridgeService.Tools.cs` (`ProducerParams`).

### 4. Medial axis + width stats — `boundary-vertices` op (implemented 2026-08-13)

The `boundary-vertices` op now returns `area` and `medialAxis` for each closed
polyline. The medial axis is computed via `Boundary.ComputeMedialAxis()` in
`Geometry/Boundary.cs` — a grid-based distance-field ridge detection (non-maximum
suppression on the inscribed-radius field). Width at each ridge point = 2× the
inscribed radius (diameter of the largest circle that fits inside the boundary
at that point).

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" \
  -d '{"name":"boundary-vertices","handles":["<handle>"]}'
```

Response includes:
```json
{ "area": 800.25,
  "medialAxis": {
    "pointCount": 42,
    "minWidth": 8.5,
    "maxWidth": 28.0,
    "avgWidth": 18.3,
    "resolution": 0.5,
    "points": [{"x": 10.2, "y": 5.1}, ...]
  }
}
```

The width stats tell Enki whether a boundary is narrow enough for a single
perimeter pass or needs interior heads — the layout planning signal. `minWidth`
is the narrowest pinch, `maxWidth` the widest bulge, `avgWidth` the average
along the spine.

Grid resolution defaults to 1/50th of the longest bounding-box side (capped at
0.5 units minimum). The `MedialAxisResult` class is in `Geometry/Boundary.cs`
alongside `Boundary` and `ClosestResult`.

### 5. The full Enki workflow (with layer discovery)

```
1. GET /layers?search=boundary
   → [{name:"3284-Boundary Sprinkler", entityCount:5, ...}]
   Enki picks the right layer name

2. POST /op {"name":"sprinkler-series","manufacturer":"RainBird"}
   → Enki picks "RainBird_1800_30" from the list

3. POST /op {"name":"sprinkler-block-check","series":"RainBird_1800_30"}
   → verifies insertable block artwork exists

4. POST /find {"layer":"3284-Boundary Sprinkler","closedPolylines":true,"saveAs":"bounds"}
   → "3 entities, saved as set 'bounds'"

5. POST /op {"name":"layout-boundary-preview","handles":[...],"series":"RainBird_1800_30"}
   → preview placements (no CAD writes)

6. POST /op {"name":"layout-boundary-commit","handles":[...],"series":"RainBird_1800_30"}
   → stamp heads into CAD
```

**Remaining gap:** `layout-boundary-preview`/`-commit` take `handles` directly, not a
`set` producer. Adding `set` support to those ops would let Enki say
`{"name":"layout-boundary-commit","set":"my-boundaries","series":"RainBird_1800_30"}`
instead of passing the handle array — one less round-trip through `/find`.

**Note on `layout-boundary-preview`/`-commit` multi-boundary support:** These already
accept multiple handles and loop through `LayoutHeadsOnBoundaries` — this was not a
gap, just undocumented. The engine skips non-polyline/open/degenerate boundaries and
reports `skippedBoundaryCount` + `degenerateBoundaryCount` in the response.

## What the bridge can do TODAY

### Read a selected polyline

**`boundary-vertices`** (`POST /op`) — reads a selected polyline's `(vertex, bulge)` pairs,
builds a `Boundary`, and returns raw vertex coordinates, bulge values, perimeter, and
interior vertex angles. This is read-only, no CAD writes.

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" \
  -d '{"name":"boundary-vertices","handles":["<handle>"]}'
```

Returns: `{ vertices: [{index, x, y, bulge}, ...], perimeter, area, vertexAngles: [{index, angleDegrees}, ...], medialAxis: {pointCount, minWidth, maxWidth, avgWidth, resolution, points: [{x,y}]} }`

The bridge builds the same `Boundary(IReadOnlyList<(Vec2 vertex, double bulge)>)` that the
harness now uses (post-port — the classes are the same, modulo `Vec2` vs `Point2D`).

### Insert a single sprinkler at a point

**`POST /insert-sprinkler`** — inserts one sprinkler block at a specified position with
rotation and radius:

```bash
curl -s http://localhost:5599/insert-sprinkler -X POST -H "Content-Type: application/json" -d '{
  "sprinkler": "Rain Bird_1800 U-Series_U-12H_30",
  "point": [50.0, 20.0, 0.0],
  "rotation": 1.57,
  "radius": 11.0
}'
```

The underlying `InsertSprinklerBlockAtPoint` (SprinklerFactory.cs:1219) accepts:
- `SprinklerDefinition` (resolved from the `sprinkler` key — Manufacturer_Model_Nozzle_Pressure)
- `Point3d insPoint` (drawing units)
- `double rotation` (block rotation radians)
- `double arcRadius` (drawing-unit radius for the coverage arc)
- `double? aimRadians` (coverage aim direction — NOT exposed in the `/insert-sprinkler` endpoint)
- `double? arcDegrees` (coverage arc angle — NOT exposed in the `/insert-sprinkler` endpoint)

**Gap:** the `/insert-sprinkler` endpoint does NOT expose `aimRadians` or `arcDegrees`.
It passes `aimRadians: CoverageTweak.AimFromSymbolRotation(rotation, def)` but no
`arcDegrees`. The underlying method supports both (the `layout-boundary-commit` path uses
them at line 2058), but the individual insert endpoint doesn't surface them.

### Run Raindrop's perimeter engine + commit

**`layout-boundary-preview`** (`POST /op`) — reads boundary polylines by handle, runs
Raindrop's `BoundaryPerimeterLayoutEngine` (perimeter-only, same as `IR_LayoutOnBoundary`),
returns placements without inserting:

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" \
  -d '{"name":"layout-boundary-preview","handles":["<handle>"]}'
```

Returns: `{ placements: [{head, x, y, angle, rotation, arcFitDelta, adjustedRadius, boundaryIndex}, ...] }`

**`layout-boundary-commit`** — same but inserts sprinkler blocks. The insert path
(SprinklerFactory.cs:2058) passes the layout engine's computed `aimRadians` and
`arcDegrees` to `InsertSprinklerBlockAtPoint`, so each head gets the correct coverage arc
stamped directly (issue #694 fix — skips the layer-filtered `OrientHeadFromBoundary`
override that was re-deriving from a snapshot that could exclude the picked boundary).

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" \
  -d '{"name":"layout-boundary-commit","handles":["<handle>"]}'
```

**Both use Raindrop's perimeter-only engine**, NOT the harness's enhanced algorithm
(meadows + interior fill + cap fill + geometric arcs). The harness algorithm lives in
the boundary-layout harness Core, not in Raindrop's assembly yet.

### Bulk insert with direct arc stamping — `insert-sprinklers` (IMPLEMENTED 2026-08-02)

**`insert-sprinklers`** (`POST /op`) — fires N sprinkler placements into CAD in ONE
transaction (atomic: one commit, one `RefreshDisplay`). This closes the
`arcDegrees`/`aimRadians` gap that `/insert-sprinkler` still has (Option C below is the
per-head version; this is the batch version the harness→CAD workflow actually wants).
Registered in `OpNames` (Phase4.cs:53) alongside `layout-boundary-preview`/`-commit`.

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" -d '{
  "name": "insert-sprinklers",
  "placements": [
    { "sprinkler": "Rain Bird_1800 U-Series_U-12H_30",
      "point": [50.0, 20.0, 0.0], "rotation": 1.5708, "radius": 11.0,
      "arcDegrees": 180.0, "aimRadians": 0.785 },
    { "sprinkler": "Rain Bird_1800 U-Series_U-15Q_30",
      "point": [65.0, 20.0, 0.0], "radius": 14.0,
      "arcDegrees": 110.9, "aimRadians": 1.26 }
  ]
}'
```

Per-placement fields (drawing units, NOT catalog feet — the caller converts via
`DrawingUnitFactor`, same as `/insert-sprinkler`):

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `sprinkler` | yes | — | SprinklerDefinition ID, resolved via `TryResolveSprinklerDefinition` (same path as `/insert-sprinkler`) |
| `point` | yes | — | `[x,y,z]` drawing units |
| `rotation` | no | `0.0` | Block reference rotation radians (symbol orientation) |
| `radius` | no | `def.Radius * DrawingUnitFactor()` | Coverage radius, drawing units |
| `arcDegrees` | no | catalog nozzle arc (via `ApplyNozzleArc`) | Coverage arc angle degrees (e.g. 180, 90, 110.9) |
| `aimRadians` | no | `CoverageTweak.AimFromSymbolRotation(rotation, def)` | Coverage aim direction radians (arc bisector) |

**The `callerProvidedArc` contract (same as `layout-boundary-commit`):** when BOTH
`arcDegrees` and `aimRadians` are provided (and arcDegrees > 0 and <= 360), the insert
stamps both directly and SKIPS `OrientHeadFromBoundary` — the same path
`layout-boundary-commit` uses (SprinklerFactory.cs:2058). When either is missing, falls
back to `ApplyNozzleArc` (catalog nozzle arc). When `aimRadians` is omitted but
`arcDegrees` is provided, the aim is derived from `rotation` via
`CoverageTweak.AimFromSymbolRotation(rotation, def)` (strip-aware), same as
`/insert-sprinkler`.

**Partial-failure semantics:** a failed placement (bad sprinkler ID, missing point,
block creation failure) is recorded per-index with an `error` field without aborting
the batch. The transaction still commits the successful inserts. `status` is
`"ok"` (all placed), `"partial"` (some failed), or `"error"` (all failed). If
all-or-nothing semantics are wanted, swap the `tr.Commit()` for a per-error abort.

**Response shape:**
```json
{ "status": "ok", "op": "insert-sprinklers", "placed": 2, "failed": 0,
  "results": [ { "index": 0, "handle": "1A2B", "sprinkler": "...",
                 "point": [50.0,20.0,0.0], "radius": 11.0,
                 "arcDegrees": 180.0, "aimRadians": 0.785 }, ... ] }
```

**Harness→CAD workflow (now end-to-end feasible):**
1. `boundary-vertices` on the selected polyline → `(vertex, bulge)` pairs
2. Harness CLI runs the meander algorithm on those vertices → placements
   (position, radius, arc, rotation, flow)
3. `insert-sprinklers` with the harness placements → all heads in one call

The conversion from harness output to the request body is just mapping each
`SprinklerHead` to `{"sprinkler": profileId, "point": [x,y,0], "rotation": rotation_radians,
"radius": adjustedRadius, "arcDegrees": arc, "aimRadians": rotation_radians}` — the
harness already computes all of these.

## What's needed to run the HARNESS algorithm and insert into CAD

Three options, in order of work required:

### Option A — Port the harness algorithm into Raindrop + add a bridge endpoint

The cleanest path. Port `RaindropMeanderAlgorithm` + `RaindropLayoutEngine` +
`SprinklerArcMatcher` + `ArcInference` from the harness Core into Raindrop. The
`Boundary` class is already shared (same in both projects post-port). Add a new
bridge op (e.g. `layout-harness-preview` / `layout-harness-commit`) that:
1. Reads the selected polyline's `(vertex, bulge)` pairs (same as `boundary-vertices`)
2. Builds a `Boundary` from them
3. Runs `RaindropMeanderAlgorithm.Run(boundary, options)`
4. For each placement, calls `InsertSprinklerBlockAtPoint(tr, head, pos, blockRotation,
   radius, aimRadians, arcDegrees)` — same insert path `layout-boundary-commit` uses

**Work:** ~4 files to port (the algorithm layer), ~1 new bridge endpoint. The Boundary +
CurveSeg geometry layer is already shared.

### Option B — Agent-driven workflow (no new code, using existing endpoints)

The agent can do this right now with existing bridge endpoints, but with limitations:
1. `boundary-vertices` to read the selected polyline
2. Feed the vertices into the harness CLI (needs a small CLI wrapper that takes vertices
   instead of a DXF file, or write a temp DXF)
3. Run the harness algorithm
4. For each placement, call `/insert-sprinkler` individually

**Limitation:** `/insert-sprinkler` doesn't expose `arcDegrees` or `aimRadians`, so
inserted heads would get default arcs (from `ApplyNozzleArc`), not the harness's
geometrically inferred arcs. The agent can set rotation, but not the coverage arc angle.

**Speed:** one HTTP round-trip per head — slow for 15+ heads.

### Option C — Extend `/insert-sprinkler` to accept `arcDegrees` and `aimRadians` (smallest code change)

**Superseded for the harness workflow by `insert-sprinklers`** (the bulk op above), which
already accepts both fields and batches in one transaction. `/insert-sprinkler` itself
still does NOT expose `arcDegrees`/`aimRadians` — it derives aim from rotation and runs
`ApplyNozzleArc` for the arc. If a single-head insert with direct arc stamp is ever
needed, the same ~10-line change below applies; but for harness→CAD use
`insert-sprinklers`.

~10 lines of C# in `DebugBridgeService.Sprinkler.cs`:

```csharp
// In RunInsertSprinkler, after parsing rotation/radius:
double? aimRadians = spec["aimRadians"]?.ToObject<double>();
double? arcDegrees = spec["arcDegrees"]?.ToObject<double>();

// Pass to InsertSprinklerBlockAtPoint:
Sprinkler inserted = SprinklerFactory.InsertSprinklerBlockAtPoint(tr, def, point, rotation, radius,
    aimRadians: aimRadians ?? CoverageTweak.AimFromSymbolRotation(rotation, def),
    arcDegrees: arcDegrees);
```

Then the agent-driven workflow (Option B) can insert with correct arcs by passing
the harness's computed `arc` and `rotation` fields as `arcDegrees` and `aimRadians`.

**This is the minimal viable path to get harness results into CAD today.**

## The insert path in detail (SprinklerFactory.InsertSprinklerBlockAtPoint)

The method at SprinklerFactory.cs:1219 is the single insert point for all sprinkler
placement. Key parameters:

| Parameter | Type | What it does |
|-----------|------|-------------|
| `sprinklerDef` | `SprinklerDefinition` | The nozzle to insert (resolved from catalog) |
| `insPoint` | `Point3d` | Position in drawing units |
| `rotation` | `double` | Block rotation radians (symbol orientation) |
| `arcRadius` | `double` | Coverage radius in drawing units (persisted as AdjustedRadius XData) |
| `aimRadians` | `double?` | Coverage aim direction. If provided, stamps `sprinkler.rotation` directly. If null, seeds from `CoverageTweak.AimFromSymbolRotation`. |
| `arcDegrees` | `double?` | Coverage arc angle. If provided WITH aimRadians, stamps `sprinkler.Angle` directly and SKIPS `OrientHeadFromBoundary` (the layer-filtered override). If null, runs `ApplyNozzleArc`. |
| `arcOrigin` | `Point3d?` | Coverage emanation point (for strip heads — the layout point ON the polyline while the symbol sits offset). |

**The `callerProvidedArc` gate (issue #694):** when BOTH `aimRadians` and `arcDegrees`
are provided (and arcDegrees > 0 and <= 360), the method stamps the arc directly and
skips `OrientHeadFromBoundary`. This is critical: without this gate, the layer-filtered
override re-derives the arc from a boundary snapshot that may exclude the picked boundary
(wrong layer), producing wrong arcs. The `layout-boundary-commit` path already uses this
gate (line 2058-2059).

**The `PersistArcState` call (line 1293):** writes the arc angle, aim, anchor, and
adjusted radius to XData so the head's coverage survives a close/reopen. This is the
single persist path — all insert paths converge here.

## Key constraint: the bridge runs Raindrop's engine, not the harness

The `layout-boundary-preview` / `layout-boundary-commit` ops call
`SprinklerFactory.LayoutHeadsOnBoundaries` which calls
`BoundaryPerimeterLayoutEngine.Layout` — Raindrop's **perimeter-only** engine. This is
the same code path as `IR_LayoutOnBoundary`. It does NOT include:
- Interior fill (medial axis, cap fill)
- Geometric arc inference (`InferByHalfRadiusFromAnchor`)
- The bridge-head post-loop fix
- The floating-point epsilon tolerance fix

Porting the harness algorithm back into Raindrop is the plan — the whole point of the
harness is to validate it there first, then drop it in. The Boundary class port
(COMPLETED 2026-08-02) was the shared geometry layer that makes this possible. The
algorithm layer (RaindropLayoutEngine, RaindropMeanderAlgorithm, ArcInference,
SprinklerArcMatcher) is the next port step.
