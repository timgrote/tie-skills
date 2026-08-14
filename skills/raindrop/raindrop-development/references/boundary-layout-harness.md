# Boundary Layout Test Harness (`boundary-layout` repo)

CAD-free harness for iterating on Raindrop's `IR_LayoutOnBoundary` algorithm (and future
layout algorithms) without opening AutoCAD. Repo: **`https://github.com/timgrote/boundary-layout`**
(private), local at `C:\Users\tim\boundary-layout`.

Goal: lay out a boundary, compute & display uniformity, and **maximize uniformity**. Iterate
fast here, then carry the winning algorithm into Raindrop — with **zero re-porting** (see
"Portability" below).

## Architecture (the whole point)

Three layers, deliberately split so the algorithm core stays portable:

```
BoundaryLayout.Core  (netstandard2.0)  ← ALGORITHMS + geometry + uniformity; NO deps, NO IO.
BoundaryLayout.Cli   (net8.0)          ← thin adapter: netDxf read, runs algorithms, writes JSON.
visualizer/index.html                  ← single-file browser canvas reading result.json.
```

- **Core = netstandard2.0, zero NuGet deps.** That TFM is the *only* one that loads in BOTH
  modern .NET (console harness) and .NET Framework 4.8 (what AutoCAD / Raindrop plugin
  assemblies load). So a method you validate here can be dropped into the Raindrop plugin
  assembly unchanged — no C#→C# port, no TS→C# translation.
- **Keep netDxf / ALL file IO out of Core.** netDxf only exists in the CLI layer. Core takes
  plain `Point2D[]` / `Boundary` objects. This is what keeps Core byte-portable into Raindrop.
- **CLI → `result.json`** (DTO in `ResultFile.cs`), consumed by the canvas. The visualizer has
  zero coupling to Core — it just reads geometry + numbers.

Domain model in Core: `Point2D` (readonly struct), `Boundary` (area/perimeter/centroid/bounds/
`Contains` point-in-polygon), `SprinklerHead` (pos/radius/flow/arc/profile), `Layout`.
`Uniformity.Evaluate()` samples the boundary on a grid and reports **coverage %, CU
(Christiansen), DU (low-quarter)** — the metrics to optimize. DU is the one most irrigation
designers optimize.

**Boundary class — bulge/arc support (COMPLETED 2026-08-02):** The harness `Boundary` was
originally straight-segment-only (no bulge/arc support). It has been replaced with a port of
Raindrop's `Boundary` (`~/Raindrop/src/raindrop/Geometry/Boundary.cs`) + `CurveSeg.cs`, which
handle bulged polylines (arc segments between vertices) via the AutoCAD bulge convention
(`bulge = tan(includedAngle/4)`, + = CCW). `CurveSeg.Build(p1, p2, bulge)` produces either
a `LineCurveSeg` (bulge ≈ 0) or an `ArcCurveSeg` (derives center/radius/startAngle/signedSweep
once, in a single owned world frame). The Boundary tessellates arc segments into a dense
straight-segment polygon for point-in-polygon `Contains` (ray casting), while
`ClosestPoint`, `ClosestPointExcludingRange`, `IntersectCircle`, `PointAtPerimeterDistance`,
and `SegmentLength` all use the real arc geometry.

**Why this matters:** Tim flagged that real CAD polylines have bulges between vertices —
"I'm noticing we're showing a polygon and what we're going to be dealing with is polylines
which can have a bulge between vertices. I don't want to go putting this all together and then
finding out that it breaks when we put it back into CAD." The harness must handle bulged
boundaries so the algorithm doesn't break when ported back.

**Port details (verified — build 0 errors, pipeline runs, JSON correct):**
- `Vec2` → `Point2D` rename throughout
- `CurveSeg` classes are `internal` (same as Raindrop)
- `Boundary` constructor takes `IReadOnlyList<(Point2D vertex, double bulge)>` — same as
  Raindrop. A backward-compatible `Boundary(IReadOnlyList<Point2D>)` constructor (bulge=0
  for all segments) keeps existing callers working.
- **A parameterless `Boundary()` constructor was ADDED** (not in Raindrop) — needed because
  `SprinklerHead.cs` has `Layout.Boundary = new Boundary()` for default initialization. Creates
  an empty boundary (0 vertices); `Contains` returns false, `Area` falls back to `SignedArea`
  (0 for empty), `Bounds` returns (0,0,0,0), `ClosestPoint` returns default.
- `DxfReader.FromPolyline2D` passes `v.Bulge` from each `Polyline2DVertex` (netDxf's
  `Polyline2DVertex` has a `Bulge` property — confirmed by binary search of the DLL).
  `FromPolyline3D` uses the straight-segment constructor (Polyline3D vertices have no bulge).
- `OffsetInward` was DROPPED (unused in the harness — a superseded approach).
- `Centroid`, `Bounds`, `SignedArea` are kept as convenience methods (Raindrop's Boundary
  doesn't have them, but the harness's `LayoutEngine` and `Uniformity` depend on them).
  `Area` uses the tessellated polygon shoelace (from Raindrop) but falls back to
  `Math.Abs(SignedArea)` when the polygon is empty/degenerate (parameterless constructor case).
- `Vertices` changed from mutable `List<Point2D>` to read-only `IReadOnlyList<Point2D>`.
  All callers that did `b.Vertices.Add(...)` were updated to use the constructor:
  `DxfReader.FromPolyline2D` and `FromPolyline3D` now build vertex lists and pass to the
  constructor. `SampleGenerator.cs` needed NO changes (it writes DXF polylines, doesn't
  construct `Boundary` objects directly).
- `System.Linq` using removed from Boundary.cs (no longer needed — old version used it for
  `Vertices.ToList()` in `OffsetInward`, which was dropped).
- **JSON serialization verified:** `IReadOnlyList<Point2D>` serializes identically to the old
  `List<Point2D>` with `IncludeFields=true` — `vertices: [{x: ..., y: ...}, ...]` format intact.
  No changes needed to `ResultFile.cs` or `Program.cs` for serialization.

Algorithm contract: `IBoundaryLayoutAlgorithm { string Name; Layout Run(Boundary, LayoutOptions); }`.
Registered list in `Program.cs` — add yours there to see it in results + visualizer.

## Running it

```bash
dotnet build -c Release
# generate a sample DXF with 4 boundaries: narrow-strip, wide-rect, l-shape, blob
dotnet run -c Release --project src/BoundaryLayout.Cli -- --gensample --out samples/sample.dxf
# read DXF → run every algorithm → measure uniformity → write result.json
dotnet run -c Release --project src/BoundaryLayout.Cli -- samples/sample.dxf --radius 15 --flow 4.5 --grid 2 --out samples/result.json
# visualize: serve repo root, open visualizer/index.html, load result.json
python -m http.server 8090   # from repo root, not visualizer/ (samples/ lives at repo root)
```

## netDxf API gotchas (netDxf 2023.11.10 — verified by reflection)

These bit during the DXF reader build. In this netDxf version:

- **`LwPolyline` / `Polyline` do NOT exist.** The 2D lightweight polyline class is
  **`netDxf.Entities.Polyline2D`** with **`Polyline2DVertex`** vertexes. (`LwPolyline` in a
  `case`/type pattern → `CS0246`; `Polyline2D` is what actually ships.)
- `Polyline3D.Vertexes` are raw **`Vector3`** (no `.Position` member) — read `v.X`, `v.Y`.
  `Polyline2D.Vertexes` ARE objects with `.Position.X/.Y`.
- **`doc.Entities` is not enumerable** in this version — no `GetEnumerator`. Use typed
  collections: `doc.Entities.Polylines2D`, `doc.Entities.Polylines3D`, `doc.Entities.Circles`,
  `doc.Entities.Inserts`, etc.
- `Polyline2D()` has **no `(name, vertices)` constructor** — build via parameterless ctor,
  set `.Layer`, and `pl.Vertexes.Add(new Polyline2DVertex(x, y, 0))`, then `.IsClosed = true`.
- `Block` lives in **`netDxf.Blocks`** namespace (add `using netDxf.Blocks;`).
- `doc.Layers.Add(name)` returns a managed `Layer` object; to attach a layer by name you can
  just do `pl.Layer = new netDxf.Tables.Layer(name)`.
- Easier than grepping the DLL for type names: load the netDxf assembly by path in a throwaway
  console project and `Assembly.GetTypes().Where(t => t.Namespace == "netDxf.Entities")` to print
  the real class names (`Polyline2D`, `Polyline3D`, `Circle`, `Insert`, ...).

## netstandard2.0 project gotcha

`dotnet new classlib -f netstandard2.0` defaults to **C# 7.3**, so nullable reference types
`string?`/`List<X>?` fail with **CS8370**. Fix in the .csproj:
```xml
<LangVersion>latest</LangVersion>
<Nullable>enable</Nullable>
```

## System.Text.Json serialization — RESOLVED (three-part fix, verified 2026-08-02)

`result.json` was emitting `uniformity: {}` because **System.Text.Json only serializes public
PROPERTIES by default**, and `UniformityResult` used public fields. The fix has **three parts** —
each addresses a different layer. Don't fall for the single-line fix; all three are needed:

1. **Fields → auto-properties on the core DTO** (`UniformityResult`): `public double Coverage { get; set; }`
   etc. netstandard2.0 Core still has no `System.Text.Json` reference, so you **can't use
   `[JsonIgnore]` / `[JsonInclude]` attributes in the Core assembly** — attributes fail CS0234
   (`System.Text.Json` not referenced). So attribute-based exclusion is off the table in Core.

2. **Drop the bulky `SampleValues` list via a CLI-side snapshot DTO, not an attribute.**
   Because Core can't reference System.Text.Json, add a serializable `ResultFile.UniformitySnapshot`
   in the CLI with just the scalar metrics (coverage/CU/DU/flow/headCount/area) and a static
   `From(UniformityResult)` copy. Program.cs populates `Uniformity = UniformitySnapshot.From(uni)`.
   This is what keeps `SampleValues` (a potentially large per-sample list) out of the JSON.

3. **`IncludeFields = true` in `JsonSerializerOptions` so the readonly-struct `Point2D` serializes.**
   `Point2D` is a `readonly struct` with PUBLIC FIELDS (`public readonly double X; Y;`) — without
   `IncludeFields`, every `position`/`vertex` in the JSON writes `{}`. Add:
   ```csharp
   new JsonSerializerOptions { WriteIndented=true, PropertyNamingPolicy=JsonNamingPolicy.CamelCase,
                               IncludeFields=true }
   ```
   (This also serializes the `result.json` result; the CLI uses CamelCase naming, so the visualizer
   reads `coverage`/`cu`/`du`/`headCount`.)

After the fix, verify: `dotnet build -c Release` → 0 errors; re-run the pipeline; then
`python -c "import json; json.load(open('samples/result.json'))"` and confirm `uniformity` carries
real numbers and `position`/`vertex` objects have `x`/`y`.

## Baseline findings already reproduced (Raindrop's known bugs confirmed)

With `--radius 15`, sample DXF results:
- wide-rect: perimeter-only **45.7% coverage** (middle uncovered), lattice-fill 100%.
- l-shape: perimeter-only 89%, lattice 100%.
- blob: perimeter-only **50%**, lattice 100%.
- narrow-strip: both 100%.

Confirms the two gaps Tim wants to fix: **no interior fill when the boundary is wider than
perimeter reach** (wide-rect/blob) and **odd/concave shape failures** (l-shape).

## Sprinkler series from Raindrop TSVs → `data/sprinkler-series.json`

The harness carries the **real Raindrop sprinkler data**, not hardcoded values. Imperial TSV
sources live in `~/Raindrop/src/raindrop/data/imperial/` (mind the spaces in filenames — quote
them). Raindrop TSV columns, in order: `MANUFACTURER\tMODEL\tNOZZLE\tPRESSURE\tRADIUS\tFLOW\n`
(the first line is a `//`-comment header — skip it when parsing). Additional columns
(`BLOCKNAME`, `PLOTSIZE`) may follow.

**`tools/gen_sprinklers.py`** reads those TSVs and writes `data/sprinkler-series.json`. It's the
blessed path — regenerating from the TSV (not hand-editing JSON) avoids transcription errors and
is reproducible. The three series Tim wants (currently in the generator):

| `id` | TSV source | Pressure | Radius range |
|---|---|---|---|
| `rainbird-1800-mpr` | `Sprinklers_Imperial_RainBird - Sprays.tsv` | 30 psi | 5–15 ft |
| `hunter-mp-rotator` | `Sprinklers_Imperial_Hunter - MPRotators.tsv` | 40 psi | 10–35 ft |
| `hunter-i25` | `Sprinklers_Imperial_Hunter - Rotors.tsv` | 50 & 60 psi | 38–66 ft |

Run: `python tools/gen_sprinklers.py` (hardcoded RAINDROP path — update if the repo moves).

**Two model-matching gotchas verified this session:**
- **Series filters are substring match on the MODEL column, so they over-capture.** `is_1800`
  matches "1800 MPR" AND "1800 U-Series"; `is_i25` matches "I-25" AND "I-25HS"; the MP filter
  catches both "MP Rotator" and "MP800". That's deliberate (complete family), but flags up that a
  substring filter silently pulls in sibling model lines — if Tim wants "pure I-25 only" you must
  exact-match, and you must say so rather than silently including the HS variants.
- **Arc is derived from the nozzle suffix**, not stored in the TSV: `F`→360°, `H`→180°, `Q`→90°.
  This matters for perimeter placement (half/quarter arc on edge heads).

## `examples/` folder

`examples/` is where Tim drops DXF files (boundaries ± sprinklers) for you to chew on. Run:
```bash
dotnet run --project src/BoundaryLayout.Cli -- examples/<file>.dxf --radius 15 --flow 4.5 --grid 2 --out examples/result.json
```
then load `examples/result.json` in the visualizer. `--series data/sprinkler-series.json` is now
**auto-resolved** from repo root (no flag needed), and existing drawing sprinklers are emitted to
`result.json` under `existingSprinklers` so the visualizer can overlay them (blue) against the
algorithm output (yellow).

## Reading a REAL Raindrop drawing (verified on `examples/Example1.dxf`, 2026-08-02)

The reader (`DxfReader.cs`) + `SprinklerCatalog.cs` now handle Tim's actual drawings. The real-drawing
conventions, verified by reflection enumeration of the DXF:

- **Boundaries live on a layer whose name contains `boundary`** (e.g. `3284-Boundary`). Only closed
  polylines on boundary layers are treated as boundaries.
- **`...-Sprinkler-Radius` layers hold coverage circles, NOT boundaries.** A naive "every closed
  polyline is a boundary" reader will count 49 fake boundaries + 0 sprinklers on a real drawing.
  The conservative default in `IsBoundaryLayer()` returns false unless the layer contains
  "boundary" (explicitly excludes sprinkler/radius/dot/mask/valve/controller/defpoint).
- **Sprinkler heads are `Insert` entities whose BLOCK NAME encodes the full spec.** Block names you
  will actually see (manufacturer/model/nozzle/pressure are in the name — do not hardcode radius):
  - Spray/MP underscore form (5 fields, spaces live INSIDE fields): `SPR-<nz>_<manuf>_<model>_<fullNozzle>_<psi>`
    e.g. `SPR-12Q_Rain Bird_1800 U-Series_U-12Q_30`, `SPR-MP2000-Q_Hunter_MP Rotator_20Q_40`.
  - Rotor tilde form: `SPR0~<manuf>_<model>_<nozzle>_<psi>[_Full]` e.g. `SPR0~Hunter_I-25_10_60`.
  Parse by splitting on `_` ONLY (spaces are NOT delimiters — `Rain Bird` and `1800 U-Series` each
  live inside one field). Field layout for underscore form is index-fixed: [0]=`SPR-…`, [1]=manuf,
  [2]=model, [3]=fullNozzle, [4]=pressure. Rotor tilde form: rest[0]=manuf, [1]=model, [2]=nozzle,
  [3]=pressure (optional trailing `_Full`).

**`SprinklerCatalog`** loads `data/sprinkler-series.json` and resolves a block name → real
radius/flow/arc (Model/Nozzle/Pressure lookup, arc from nozzle suffix). Two gotchas that bit:
- **Read model/manufacturer from the PER-HEAD entry, not the series group's `model`.** The Rain Bird
  series group is labeled `1800 MPR` but its heads carry their own `model` (`1800 U-Series`).
  If you stamp the group model on every head, every U-Series block resolves null and falls back to
  radius 15. `HeadEntry` needs its own `Manufacturer`/`Model` props; fall back to the group's only
  when the head omits them.
- **`JsonSerializer.Deserialize` is case-sensitive.** `gen_sprinklers.py` writes lowercase keys
  (`nozzle`, `pressure`) but C# props are PascalCase — without `PropertyNameCaseInsensitive = true`
  the whole head list silently deserializes empty (0 entries, every Resolve → null → fallback).
- Fallback logic: try exact model+nozzle+pressure, then fuzzy model (substring), then pressure-set
  match, then any. This resolved all 49 heads in Example1 (Rain Bird AND MP AND I-25) correctly.

Verified result: `examples/Example1.dxf` → **5 boundaries** (two narrow strips, two wide rects,
plus a 5th wide rect Tim added on top of #4), 49→59 sprinklers with correct real radii/gpm/arc.
Wide rects reproduce the perimeter-only coverage gap (48%, DU 0).

## Visualizer: blank-canvas-on-load bug + auto-load (verified 2026-08-02)

Two things that make the `visualizer/index.html` actually pleasant to use — Tim repeatedly
asked for "just refresh the page / reload the result into my browser, don't make me browse for
the file."

- **Blank canvas until you click = the canvas-width-clears-bitmap bug.** Setting
  `canvas.width`/`canvas.height` **wipes the canvas bitmap**. If `resize()` sets those dims but
  doesn't redraw, then the `ResizeObserver`'s first real-size callback (which fires *after*
  auto-load) blanks the drawing and it stays empty until any interaction happens to re-render.
  Fix: make `resize()` call `render()` after sizing, AND guard `render()` with
  `if (!data || !data.boundaries) return;` so the initial `resize()` (called before data loads)
  doesn't throw on `data.boundaries[boundaryIdx]`.
- **Auto-load on refresh so you never browse for the file.** Read a default src from the query
  string (`?src=<path>`), else default to `'../samples/example1.json'`, then `fetch` it on
  `window load` and call `populate(); fitView(); render()`. Fall back to the file picker if the
  fetch fails (e.g. opened via `file://` where CORS blocks fetch). Serve from **repo root**
  (not `visualizer/`) so relative `../samples/...` resolves.
- **Verify render without trusting your eyes:** drive the page with the browser tools and check
  drawn pixels via the console, e.g.
  `ctx.getImageData(0,0,cv.width,cv.height).data.filter((v,i)=>i%4<3&&v>45).length` — a value in
  the hundreds of thousands confirms the boundary/heads/radius circles drew. (Audio/vision
  screenshot backends can 404; the pixel-count console check is the reliable signal.)
- **View persistence + default-to-active-algorithm (added 2026-08-02).** Tim repeatedly said "it
  should remember which one we're looking at" and "default to whichever you're working on."
  Implemented: persist `{boundaryName, algoName}` in `localStorage` (`bl-view`), keyed by NAME not
  index (so a regenerated result file with a different algorithm order doesn't break the restore).
  On load/`populate()`: restore the saved boundary; always default the algorithm to **index 0**,
  and make the active algorithm **be index 0 by putting it FIRST in the CLI's algorithm list in
  `Program.cs`**. This is the robust pattern Tim settled on after several rounds of the alternative
  failing: earlier code defaulted `fillAlgos()` to index 0 (showed perimeter-only → wrong dots),
  then a `/meander|raindrop|ported/` name-match default was tried, but a **stale `perimeter-only`
  value saved in `localStorage` kept winning the restore** and silently switched back to the wrong
  algorithm on every load — Tim: "it keeps switching to the perimeter-only baseline, I thought we
  had that sorted." The fix that stuck: **reorder so the algorithm you're actively working on is
  `algorithms[0]` in the CLI, and default unconditionally to `algoIdx=0` in `fillAlgos()`.**
  Never persist/restore the algorithm by name — that is exactly what re-introduced the bug. (Bump
  the localStorage key, e.g. `bl-view` → `bl-view2`, when you change the persistence scheme so a
  stale saved value can't resurrect an old default.)
**Existing sprinklers: now render blue coverage arcs with same arc inference (updated 2026-08-02).**
Originally the visualizer drew only blue dots for existing sprinklers (no coverage circles,
since the DXF's arc data was unreliable — all 360°). Tim then asked: "the blue sprinkler
should have the exact same coverage arc calculation as the yellow sprinklers. So their
arcs and radius and everything will match up exactly." The CLI now runs
**`InferByHalfRadiusFromAnchor`** (the anchor-based method — see
`boundary-layout-meander-engine.md` § "`InferByHalfRadiusFromAnchor`") on each existing
head, probing from the closest point ON the boundary (the anchor/install point) with an
explicit outward direction. This gives clean 180° edges / 90° corners regardless of how
far the symbol sits inside the boundary — matching the ported yellow heads' arcs exactly.
The inferred arc + rotation is stored in `ResultFile.BoundaryResult.ExistingHeads`. The
visualizer renders these as **blue coverage arcs** (same wedge rendering as yellow,
clipped to the boundary polygon) with blue labels. Both blue and yellow use the same depth
model for uniformity — apples-to-apples. The existing heads' DXF `arc=360` is replaced by
the inferred arc (e.g. 92° corners, 180° edges on I-25 boundaries).
- **Nozzle label format (updated 2026-08-02).** Tim asked to simplify labels to
  `nozzle * radius * arc°` (e.g. `25 * 66 * 93°` or `U-12Q * 12 * 90°`) — not the full
  profile ID which was too long. The nozzle name is cleaned up (strips `SPR0~Hunter_I-25_`,
  `Rain Bird_1800 U-Series_U-` prefixes). Blue labels are offset **1 ft** from the head,
  yellow labels offset **2 ft** — so they stack without overlapping (blue closer to head,
  yellow above it). Both blue and yellow use the same format so Tim can compare
  apples-to-apples.

## Coverage arc rendering (added 2026-08-02)

The visualizer now draws **coverage arcs** (pie wedges) instead of full circles for laid-out heads,
matching Raindrop's "complex design arc" (`WedgeEntities.BuildArcWedge`):

- **Full-circle heads** (`arc >= 359.5` or `<= 0.5`): thin circle outline only (no fill).
- **Part-circle heads** (90°, 180°, etc.): filled pie wedge — `moveTo(hub) → arc(rimStart→rimEnd)
  → closePath → fill + stroke`. The fill is translucent (`rgba(255,209,102,0.15)` selected /
  `0.06` non-selected), the stroke is a brighter yellow.
- **Rotation convention:** `h.rotation` is the bisector of the in-arc sector in degrees CCW from
  +X (world frame). Canvas Y is flipped (screen Y = -world Y), so negate the angle:
  `rotRad = -rotDeg * PI/180`. Sweep is centered on it: `startAng = rotRad - sweepRad/2`,
  `endAng = rotRad + sweepRad/2`.
- Selected boundary heads get brighter fill/stroke; non-selected boundaries get dimmer (same
  wedge shape, lower alpha).

This requires `SprinklerHead.Rotation` to be set by the algorithm (see the arc inference port in
`boundary-layout-meander-engine.md` § "Arc inference + arc matching"). Without arc inference,
every head has `arc=360` and the visualizer falls back to circle outlines — that's the
"rotation issue in corners" Tim reported.

**Coverage arcs clipped to the boundary polygon (added 2026-08-02):** The wedge
rendering extends outside the boundary for part-circle heads near edges — e.g. a
270° corner head on an I-25 rectangle has 3/4 of its arc outside the polygon. Tim:
"your sprinklers are calculating areas that are outside of the perimeter. Let's make
sure your coverage arcs are trimmed to the boundary." The fix: before drawing each
boundary's coverage arcs, `ctx.save()` → trace the boundary polygon as a path →
`ctx.clip()` → draw the wedges → `ctx.restore()`. Head dots and nozzle labels are
drawn AFTER `ctx.restore()` so they stay visible even when a head sits exactly on
the edge (not clipped away).

**Arcs pointing outside the boundary (fixed 2026-08-02):** `InferByHalfRadius` picks
"outward" vs "inward" from the closest-point direction, but that's degenerate for on-boundary
heads (distance ≈ 0) and ~half the arcs pointed outside the polygon. Tim: "you have the
coverage arcs for your heads pointing outside instead of inside." The fix is a **`Contains`
probe** after computing the inward bisector: if the bisector direction is outside the boundary,
flip it 180°. Tim explicitly referenced this: "we need to come up with some kind of inner test.
Contains, I think, is the one we use in Raindrop." After the fix: 0 heads pointing outside
across all 5 boundaries (was 7 on boundary #2 alone). See
`boundary-layout-meander-engine.md` § "The Contains-probe flip" for the implementation.

**`InferByHalfRadius` is the preferred arc inference method** (Tim asked for it by name — "half
the radius and calculated the angle from the intersection point of a circle that's half the
radius"). It draws a circle at R/2, intersects the boundary, and computes the inward arc from
the two intersection points. This produces the actual interior angle at corners (not just 90°)
and follows the boundary geometry. See `boundary-layout-meander-engine.md` for the full details
and why it replaced `InferByCurve`.

### Pitfall: "arcs pointing outside" — check the DATA, not the canvas (learned 2026-08-02)

When Tim reports "the coverage arcs are pointed outside the boundary," the instinct is to
fix the canvas rendering. **Resist that instinct.** The canvas rendering (`rotRad = -rotDeg`,
`startAng = rotRad - sweep/2`, `endAng = rotRad + sweep/2`, `anticlockwise=false`) is already
correct — it faithfully renders the world-coordinate bisector with the Y-flip. The bug is
almost always in the **C# rotation DATA**, not the canvas.

**What happened this session:** Tim reported arcs pointing outside on boundary #2. The C#
`InferByHalfRadius` had a Contains-probe flip bug (bisector picked the wrong side for
on-boundary heads). I fixed the C# code. Then Tim still reported arcs pointing outside — but
the preview pane was showing **stale JSON from before the fix** (auto-reload had fetched it,
but the HTML page itself hadn't been reloaded). I panicked and flipped the canvas sweep
direction (`anticlockwise=true`, swapped start/end) — which BROKE the rendering. I then
verified the math: the canvas bisector maps to `(cos(rotDeg), sin(rotDeg))` in world
coordinates, which IS the correct inward direction. I reverted the canvas change.

**The correct diagnostic sequence when Tim says "arcs point outside":**
1. **Check the JSON data first** — load `result.json`, for each head compute
   `probe = position + (radius/2) * (cos(rotation), sin(rotation))` and run a point-in-polygon
   `Contains` test against the boundary verts. If any probe is outside, the bug is in the C#
   arc inference (fix the rotation values), NOT the canvas.
2. **If the data is correct** (all probes inside) but Tim still sees outside arcs, THEN check
   whether the preview pane is showing stale HTML/JSON — reload via `open_preview` +
   `browser_navigate`.
3. **Only if both are correct and it still looks wrong**, investigate the canvas rendering
   math — but it's almost certainly correct. The formula:
   `rotRad = -rotDeg * PI/180` (Y-flip), `startAng = rotRad - sweepRad/2`,
   `endAng = rotRad + sweepRad/2`, `ctx.arc(sx, sy, r, startAng, endAng)` (anticlockwise=false).
   This renders the wedge centered on the world bisector, pointing in the world-CCW direction.
   Do NOT change this.

**Why the canvas rendering is correct:** canvas angle `theta` maps to world direction
`(cos(theta), -sin(theta))` (Y is flipped). Setting `rotRad = -rotDeg` means the canvas bisector
at angle `rotRad` points to world `(cos(-rotDeg), -sin(-rotDeg)) = (cos(rotDeg), sin(rotDeg))` —
exactly the world bisector. The sweep goes CCW in world = CW on canvas = increasing canvas
angle = `anticlockwise=false`.

**Programmatic verification when the model can't see the canvas:** the active model
(z-ai/glm-5.2) does NOT support vision — `browser_vision` and `vision_analyze` both return
`400: not a multimodal model`. To verify arc directions without eyes, run a Python script that
loads `result.json`, computes each head's bisector probe point, and checks `Contains` against
the boundary polygon. This is the definitive check — it tests the DATA, which is what the
canvas renders.

## Render ALL boundaries at once (added 2026-08-02)

Originally `render()` drew only `data.boundaries[boundaryIdx]` and `fitView()` zoomed to that one
boundary's bbox. On a multi-boundary drawing (Example1.dxf has **5** boundaries — Tim added a 5th
on top of the original 4), Tim saw only the selected boundary plus the global existing-sprinkler
overlay — the other boundaries were off-screen and invisible: "I don't see any of the boundaries,
other boundaries other than the first one, though I do see all my existing sprinklers." The
existing sprinklers showed because they're drawn as a global overlay regardless of selection, but
boundary polygons + laid-out heads for non-selected boundaries were never rendered.

Fix (three parts):
- **`render()` now iterates ALL boundaries each frame.** Selected: teal (`#4ecdc4`, 2px stroke)
  with its laid-out heads + radius circles + nozzle labels. Non-selected: dimmed (`#3a4a55`, 1px),
  but **still showing their meander (algo[0]) heads in yellow** — no labels, slightly smaller dot
  (3px vs 4px) — so Tim can compare all boundaries' proposed layouts at once. Each boundary gets a
  `#N` centroid label (translucent pill) so they're identifiable. Existing sprinklers stay as a
  global blue overlay (`#6fb7ff`).
  - **Why all heads, not just selected:** Tim explicitly asked "can you render all of the proposed
    heads that you load from the ported algorithm in yellow and make sure we are running that
    algorithm on all four boundaries." The first iteration only drew heads for the selected
    boundary — Tim saw yellow text on boundary #1 but nothing on #2–#4. The fix: every boundary
    renders its `algorithms[0]` (meander) heads in yellow; the selected boundary additionally
    honors the algorithm dropdown and draws labels. This lets Tim see all 4 boundaries' meander
    results simultaneously (15, 10, 16, 8 heads) without clicking through them.
- **`fitView()` computes the union bbox of ALL boundaries**, not just the selected one, so the
  whole drawing fits on screen at once. Falls back to the selected boundary only if the union is
  empty.

### Disambiguate same-named boundaries in the dropdown

Real drawings put multiple boundaries on one layer (Example1.dxf: 4 polylines all named
`3284-Boundary`). The boundary dropdown showed the same name 4 times — no way to tell them apart.
Fix: `populate()` appends `#N` (1-indexed) when a name repeats: `3284-Boundary #1` … `#4`. The
boundary-restore logic matches the disambiguated label first, falling back to a raw-name match
for backward compatibility with older saved state.

### Pitfall: auto-reload signature too narrow — stale uniformity data (learned 2026-08-02)

The auto-reload polls `result.json` every 2s and re-renders on change — but only if a
**signature** changes. The old signature was:
`boundaries.map(x => x.name + ':' + algorithms.map(a => a.name + ':' + a.layout.heads.length).join(',')).join('|')`
This only includes **algorithm head counts**, NOT `existingUniformity` or `existingHeads`.
So when the CLI changed the existing heads' arcs (from 360° to inferred arcs), the JSON
file on the server had the new data, but the auto-reload saw the same algo head counts and
**didn't update** — Tim saw stale CU=96% on boundary #5 when the actual was 76.4%.

**Fix:** the signature now includes `existingUniformity.cu` and `existingHeads.length`:
```
boundaries.map(x => x.name + ':' + algorithms.map(...).join(',') + ':ex:' + (existingUniformity?.cu.toFixed(3)) + ':' + (existingHeads?.length)).join('|')
```
**Rule:** the auto-reload signature must include EVERY field that affects what Tim sees on
screen — not just algorithm head counts but existing uniformity, existing head arcs,
and any other rendered data. When in doubt, hash the whole `boundaries` array.

The visualizer's auto-reload polls `result.json` every 2s and re-renders on change — but it does
NOT re-fetch `index.html` itself. So when you change the HTML (render logic, layout, dropdown),
the preview pane keeps running the old JS until you force a full page reload. To reload the
preview pane: `browser_navigate` to the visualizer URL (this loads fresh HTML), then verify via
`browser_console`. The auto-reload then keeps JSON fresh on top of the new HTML.

### Pitfall: preview pane has no right-click context menu

Tim tried to right-click the preview pane to reload it and got nothing — the Hermes preview pane
does NOT have a right-click context menu. When Tim says "how do I refresh the preview pane," the
answer is: **you can't from the UI** — ask the agent to `open_preview` (which reloads the page
fresh) or `browser_navigate` to the URL. Don't tell Tim to right-click or press Ctrl+R; neither
works in the preview pane.

## Windows path convention (Tim correction, applies repo-wide, not just this harness)

Tim explicitly flagged: **on this Windows host, write native `C:\Users\...` paths, NOT MSYS
`/c/Users/...`.** In `terminal` (which runs git-bash/MSYS), `cd "C:/Users/tim/...` with
forward slashes is fine for navigation (backslashes get eaten unquoted), but paths written into
code, config, and any user-facing text should be Windows-form `C:\Users\...`.

## Showing results to TIM (preview pane, NOT browser tabs — corrected 2026-08-02)

Tim repeatedly asked "refresh the browser / open that page / I'm not seeing it." Two hard-won
lessons about how to actually get results onto his screen:

1. **The `browser_*` tools drive a SEPARATE automated browser (Browserbase), not the tab on Tim's
   screen.** `browser_navigate`/`browser_console`/`browser_vision` verify and debug the page *for
   you*, but they do NOT update what Tim sees on his monitor.

2. **Do NOT open new browser tabs to show him results.** An earlier workflow used
   `cmd.exe /c start http://localhost:8090/...` (launches his default browser in a NEW tab), and
   Tim pushed back hard: "can you just refresh the existing tab or not" / "stop opening a new tab
   in my browser every time you want to show me results." Because the automated browser can't
   programmatically refresh Tim's local tab, the **right mechanism is the Hermes preview pane** —
   call the `open_preview` tool (url = the served visualizer URL) to display it right beside the
   chat. No tabs, no hunting for files.

**Workflow that works:** edit → rebuild/rerun the CLI → `curl -s -o /dev/null -w "%{http_code}"
<url>` (confirm the server is 200) → `open_preview` with the URL → the page's own **auto-reload**
(see above: re-fetches `result.json` every ~2s and re-renders on change) updates the pane
automatically, so a fresh run shows up without refreshing anything. Use `browser_*` only to verify
the render server-side (e.g. the pixel-count console check), then show Tim via `open_preview`.
If you ever DO need a real-browser launch, `cmd /c start <url>` still opens his default browser;
just prefer the preview pane and don't make a habit of spawning tabs.

## Rendering tweaks (updated 2026-08-02)

Tim asked for several visual adjustments across two sessions:
- **Head symbol size halved** — `selected?8:6` → `selected?4:3` px radius
  in the head-dot rendering loop. Tim: "Let's take our symbols down half the
  size that they are now."
- **Uniformity label distance halved** — `minY - 100` → `minY - 50` (50
  world-ft below the lowest vertex instead of 100). Tim: "Let's move the
  uniformity label so it's half the distance that it is now."
- **Vertex labels (A, B, C, D) on ALL boundaries** — Tim: "label the
  vertices of each boundary with A, B, C, D etcetera and caps so we can
  talk about it." **Correction:** first implementation only labeled the
  SELECTED boundary (`if (selected)`). Tim: "I am only seeing labels on
  the first polygon. I need labels on the points for all the polygons."
  Fix: labels now render on ALL boundaries — selected in teal
  (`#4ecdc4`), non-selected in dimmer blue-gray (`#6a8a9a`), 11px bold.
  Offset outward from the centroid so they don't overlap the vertex dots.

### XX marker — debug annotation for specific points (added 2026-08-02)

Tim asked to mark a specific computed point (the incenter of lines C-D,
D-E, F-G on boundary #2) in red with a label "XX" and its tangent circle,
so we can discuss it visually: "go ahead and label that point, mark it
in red, and label it XX." The visualizer renders this as a **red dashed
circle** (the incircle, radius = inradius), a **red dot** at the center,
and an **"XX" label** offset from the dot. This is a hardcoded debug
annotation in `render()` — not a general feature. To add more markers,
copy the pattern (hardcode coordinates, use `W2S` for screen transform,
`setLineDash([4,3])` for dashed circle).

### Why #3 heads look like 15s, not 35s (viewport scale, not data bug)

Tim noticed: "I want to understand why the head in number three are not
thirty-fives. They look like they're fifteens or something." The data is
correct — every head on boundary #3 has `r=35`. The visual issue is **viewport
scale**: the visualizer fits all 5 boundaries at once (spanning ~500ft ×
~160ft), so the zoom level is only a few pixels per foot. At that scale, a
35ft radius circle is only ~100px wide — visually similar to what a 15ft head
looks like on a zoomed-in 100ft-wide boundary. Zooming in (mouse wheel) shows
the true 35ft radius. This is a rendering perception issue, not a data bug —
always verify head radii in the JSON data before investigating rendering.

### Iterative cap fill (updated 2026-08-02 — multiple heads + depth threshold + HasThirdPoint abandoned)

The cap fill now **iterates**: place one full-circle head at the driest
3-edge incenter, recompute depth, find the next driest incenter, repeat
(up to 5 per boundary). `FindCapFillPosition` accepts a `dryThreshold`
parameter — when 0, it computes `meanDepth × 0.75` as the threshold and
only returns incenters below it. The loop breaks when no dry incenters
remain.

**`HasThirdPoint` gate — attempted and abandoned.** Tim's concept:
"keep a list of sprinklers that are tangent to the boundary in a third
spot. Anything that's on a boundary and not tangent — those sprinklers
probably need additional sprinklers." Implemented
`Uniformity.HasThirdPoint` checking if a head's throw overthrows or is
tangent to any edge it doesn't sit on. **Every perimeter head passes**
because even 90° corner heads geometrically overthrow a third edge (e.g.
E at r=30 reaches F-G at 28.7ft, and 28.7 < 30 − 0.5 = 29.5). But at
96% of throw, the triangular profile gives only 12% of peak PR —
negligible. The geometric circle reaches the edge but the actual water
doesn't. **Lesson: "overthrows a third edge" is necessary but not
sufficient for meaningful coverage.** A future approach should account
for the head's actual arc direction (90°/180° wedge) not just the throw
circle. `HasThirdPoint` is still in `Uniformity.cs` but unused — cap fill
is gated by depth threshold instead.

**Boundary #2 result (iterative cap fill):** 12→16 heads (5 fulls),
CU 72.1%→**88.2%**, DU 67.7%→**81.8%**. Four cap-fill heads at 3-edge
incenters:
- (179.3, 44.7) — incenter of B-C, D-E, F-G (the XX point)
- (194.1, 39.3) — incenter of D-E, C-D, E-F
- (153.7, 42.8) — incenter of C-D, B-C, G-H
- (201.2, 24.8) — incenter of E-F, F-G, D-E

## Sprinkler hover tooltip (added 2026-08-02)

Tim asked: "Can we add a tooltip if I mouse over each sprinkler that shows its nozzle radius and arc?"

**Implementation:** a `#tooltip` div positioned absolutely inside `#canvas-wrap`, shown on
hover within 14px of any head dot. The render loop populates a `hitHeads[]` array with
each head's screen position + data (num, boundaryLabel, radius, adjustedRadius, arc, flow,
nozzleName). The `mousemove` handler (when not dragging) finds the closest entry and shows
the tooltip; hides it when the mouse moves away.

**Tooltip contents (each item on its own line, per Tim's format preference):**
- Line 1: Boundary label (e.g. `#1`)
- Line 2: Sprinkler number (e.g. `Sprinkler #3`)
- Nozzle name (from `profileId`, e.g. `U-12Q`)
- Catalog radius + adjusted radius (e.g. `12 ft (adj 11.1)`)
- Arc degrees (geometric, e.g. `67.1°` or `360° (full)`)
- Flow in gpm

**Tim's format correction (2026-08-02):** initially the head number and boundary were combined
on one line (`#3 #1`). Tim asked to separate them: "Can you just put the boundary on the first
line and the number of the sprinkler on the second line and so on." Each piece of info gets
its own line — don't combine identifiers on a single line.

**Key details:**
- `hitHeads` is rebuilt every render frame (cleared at top of `render()`) — this handles
  pan/zoom changes automatically.
- The tooltip auto-flips if it would go off-screen (left edge clamps to right side, top
  edge clamps to below cursor).
- Tooltip hides during drag-pan so it doesn't follow the cursor while panning.
- The nozzle name comes from the JSON `profileId` field (e.g. `U-12Q`, `MP3500-H`) — the
  C# `SprinklerHead.ProfileId` is set by `SprinklerArcMatcher.Match` from the catalog.

## Blue sprinklers removed (2026-08-02)

Tim: "it's time we stop rendering the blue sprinklers. We are beating them
in every category." The visualizer no longer renders blue coverage arcs,
blue head dots, or blue uniformity labels. The existing-heads data is still
computed and stored in JSON (`existingHeads`, `existingUniformity`) for
future comparison, but not rendered. The uniformity label now shows only
the yellow (ported) layout: `CU 75.9%  DU 74.9%  heads 15  flow 352.5gpm`.

## Uniformity engine: Raindrop DepthField model (updated 2026-08-02)

The harness now computes and displays uniformity for BOTH the existing (blue/Raindrop) heads
AND the ported (yellow) heads on each boundary, so Tim can compare side-by-side.

### Depth model upgrade (matches Raindrop's DepthField)

The old `Uniformity.Evaluate` used a simple geometric model (`depth = 1 - d/r`, no arc
fraction, no flow). Upgraded to match Raindrop's `DepthField`:

- **Arc-fraction boost**: `PR = flow / (π·R² × arcFraction)` — a 90° head gets 4× the
  precipitation rate of a full-circle head with the same flow. `arcFraction = arc/360`, or
  `1.0` for full-circle.
- **Triangular profile**: `3(1−t)` where `t = d/R` (area-normalized linear decay, peak 3×
  at center, zero at rim). Ported from `~/Raindrop/src/raindrop/Irrigation/Uniformity/TriangularProfile.cs`.
- **Flow-based**: uses actual gpm per head from the catalog, not just geometry.
- The `Evaluate` method now takes `(Boundary, IReadOnlyList<SprinklerHead>)` so it works
  for both ported layouts AND existing drawing sprinklers.

### Per-boundary existing-sprinkler uniformity

`Program.cs` now evaluates existing (Raindrop/blue) sprinklers for each boundary: finds
heads within 3ft of the boundary perimeter OR inside the boundary, then runs
`Uniformity.Evaluate(boundary, existingForBoundary)`. The result goes into
`ResultFile.BoundaryResult.ExistingUniformity` (a `UniformitySnapshot`).

### Visualizer uniformity labels

Each boundary's centroid now shows two uniformity lines just below the `#N` label:
- **Blue** (`#6fb7ff`): existing Raindrop layout — `CU 92.0%  DU 87.0%`
- **Yellow** (`#ffe08a`): ported meander layout — `CU 93.8%  DU 90.4%`

The labels use the `existingUniformity` field from the JSON (blue) and
`algorithms[0].uniformity` (yellow, always the meander). Both lines have a dark background
pill for readability. Position: **100 world-ft below the lowest vertex** of each boundary
(horizontally centered on the centroid). Tim: "move the uniformity labels to be a hundred
units below the bottom edge, the lowest point of the boundary."

### Pitfall: `algo` variable scope in the boundary forEach (learned 2026-08-02)

When adding the uniformity label code inside the boundary-drawing `forEach` loop, I
referenced `algo` (a variable from the head-drawing loop below) which doesn't exist in
the boundary-drawing scope. This caused a silent `ReferenceError: algo is not defined`
that prevented the page from loading data. Fix: use `(b.algorithms||[])[0]` directly
(don't reference variables from a different forEach scope). Always check
`browser_console` for JS errors after changing the render function.

## Porting between repos — delegate_task pattern (2026-08-02)

When porting a class or subsystem from Raindrop into the harness (or vice versa), the
`delegate_task` tool works well for multi-file ports. Dispatch a leaf subagent with:
- The source files to read (full paths in Raindrop)
- The target files to write/replace (full paths in the harness)
- A detailed spec of what to rename (`Vec2` → `Point2D`), what to keep, what to drop,
  what to add back (harness conveniences like `Centroid`/`Bounds`)
- Build + verify commands to run after the port
- Key constraints (tab indentation, namespace, TFM compatibility)

The subagent reads the source, writes the target, builds, and verifies in ~100 seconds.
**After the subagent returns, ALWAYS re-verify yourself**: rebuild, run the pipeline on
Example1.dxf, and check the JSON output matches the pre-port baseline (same head count,
same CU/DU) — the subagent's self-report is a starting point, not a verified fact. This
session's CurveSeg port produced identical output (18 heads, CU 86.1%, DU 83.0%) which
confirmed the port was clean.

**Pitfall:** subagents can't use `clarify` (leaf role). Give them complete instructions
including all file paths and constraints — don't leave decisions for them to ask about.

## Explicitly NOT candidates (checked this session)

- **`sprout`** GitHub repo — browser sprinkler-layout sandbox, but **TypeScript/bun**, perimeter-
  only, and **no DXF import / no save-load / no JSON**. Dead end for CAD round-tripping.
- **`groundwork`** GitHub repo — PixiJS **DXF *viewer*** (import/read via `dxf-parser`, no DXF
  writer). Only reusable as a DXF-read reference, not a layout tool.
