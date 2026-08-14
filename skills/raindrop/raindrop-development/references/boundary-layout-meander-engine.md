# The REAL Raindrop boundary layout algorithm & its harness port

Source of truth for `IR_LayoutOnBoundary`. When a session needs "make the harness yellow
dots match where Raindrop actually puts heads," this is the algorithm to port/understand.
The ported version lives in the harness Core as **`RaindropLayoutEngine`** — registered as the
`raindrop-meander (ported)` `IBoundaryLayoutAlgorithm`, the faithful baseline to iterate on.

## Where it lives in Raindrop

`~/Raindrop/src/raindrop/Irrigation/BoundaryLayout/` (mind the space in `CAD Commands/` — see
the `search_files` path pitfall; use `grep -rn` in terminal instead):

| File | Role |
|---|---|
| `Commands.BoundaryLayout.cs` (in `CAD Commands/`) | `[CommandMethod("IR_LayoutOnBoundary")]` entry — selects closed polylines + uses the palette's **selected series** via `SprinklerFactory.LayoutHeadsOnBoundaries`. |
| `BoundaryPerimeterLayoutEngine.cs` | `Layout(boundary, seriesHeads)` orchestrator: breaks into runs, walks each, de-dupes corner anchors, then matches arcs. Also `SprinklerPlacement` DTO. |
| `PerimeterRunBreaker.cs` | Splits perimeter into corner-anchored **runs**: any vertex sharper than `breakAngleDegrees` (default **150°**) is a corner; last run wraps back to the first corner. No sharp corner → one run spanning the whole perimeter. |
| `BoundaryMeanderWalker.cs` | The core: walks one run with **two threads** toward the middle, then `RedistributeEvenly`. |
| `SprinklerArcMatcher.cs` | Picks the real fixed-arc nozzle whose buildable sweep is closest to the ideal angle; adjustable-arc unsuffixed nozzles pass the ideal through. |

Geometry dependency: `AID.Geometry.Boundary` (`~/Raindrop/src/raindrop/Geometry/Boundary.cs`)
that supports arcs (CurveSeg/bulge: `Vertices`, `Perimeter`, `SegmentLength(i)`,
`VertexAngleDegrees(i)`, `PointAtPerimeterDistance(d)`, `ClosestPoint`,
`ClosestPointExcludingRange(p, startArc, endArc)`). Nozzle-arc parsing lives in
`Irrigation/NozzleArc.cs` (regex-driven suffix → degrees). The harness `Boundary` is now
ported to use the same CurveSeg approach (COMPLETED 2026-08-02 — see
`references/boundary-layout-harness.md` § "Boundary class — bulge/arc support").

## How the meander walker works (the heart of it)

For each run (corner → next corner):

1. **Corner anchors** — `FirstHeadAt`: a head exactly at the run's start/end vertex, sized by
   distance to the **nearest OTHER vertex** (not the far-side across distance — from a corner the
   relevant target is the adjacent corner of a short connecting run).
2. **Two-thread march** — `GetInternalHead`: from each endpoint, step along (`StepIncrement = 0.5`
   arc-length) until the head would touch the opposite thread or the same-edge search commits;
   at each candidate pick the **smallest head whose throw reaches across** (`PickHeadForDistance`,
   the across-distance = `ClosestPointExcludingRange` with margin = series max radius).
3. **`RedistributeEvenly`** — replace any "bridge/gap patch": solve ONE overlap ratio
   `k = span / Σ(rᵢ + rᵢ₊₁)` shared by every consecutive pair, and reposition every interior
   head so `gap_i = k * (rᵢ + rᵢ₊₁)`. If `k >= 0.95` the catalog can't comfortably cover the run
   → **Degenerate** flag (surface this to the user; it's the "under-covered gap" failure mode).
   First and last placed heads never move.
4. **Corner de-dupe** — adjacent runs each anchor their shared vertex; drop within `epsilon 0.05`
   in real space (not arc length), and drop the wrapped last==first corner.

**Key sizing concept:** `AdjustedRadius` clamps the coverage-driven throw to
`[Head.Radius * 0.75, Head.Radius]`. The CAD side additionally applies an install-time inward
offset + rotation (`PlotSize`/`Offset` in `SprinklerFactory`), which is why drawn heads are offset
off the boundary line — the *coverage geometry* position is ON the boundary.

## Known behavior to expect (matches Tim's bug reports)

- Differential coverage: perimeter-only leaves wide-rect/blob interiors at ~48–50% (DU 0), while
  a lattice/meander interior fill gets 100%. The ported meander handles perimeter + *partial*
  interior but still leaves a wide middle thin (tested: 16 heads, 95.2% coverage, CU 44 on wide
  rects) — that residual gap is the iteration target.
- Odd/concave shapes (reflex vertices) break naive fixed-spacing perimeter; the run-breaker's
  per-sharp-corner runs with per-head sizing is what handles them. `VertexAngleDegrees` returns an
  UNSIGNED angle, so concave corners read as sharp too and get their own corner head.

### Pitfall: `AcrossDistance` exclusion window hides the true nearest edge (2026-08-02)

**Symptom:** A perimeter head's drawn radius circle is ~1.3× larger than the distance to the
nearest opposite edge — "way past the boundary." Tim noticed sprinkler #11 on boundary #2 had
r=30 when the distance to sprinkler #3 (across the boundary) was only ~23ft.

**Root cause:** `AcrossDistance(boundary, arc, maxRadius)` calls
`ClosestPointExcludingRange(pos, arc - maxRadius, arc + maxRadius)` — it excludes all edges whose
arc-length span partially overlaps a ±maxRadius window around the head's position. This window is
meant to exclude "same side" edges around corners, but on boundaries where a near edge is short
and partially overlaps the window, the **entire edge** gets excluded even though most of it is
far from the head.

**Concrete example (boundary #2, sprinkler #11):**
- #11 sits on edge H-A (arc 269–307 on a 307ft perimeter)
- maxRadius = 35ft (largest MP Rotator nozzle)
- Exclusion window: [250.45, 13.40] (wraps around perimeter)
- Edge G-H (arc 228–269) partially overlaps the window → **entirely excluded**
- Edge A-B (arc 0–19) partially overlaps → **entirely excluded**
- True nearest non-own edge: **G-H at 16.3ft** (Euclidean) — but it's excluded
- Across distance resolves to **B-C at 22.5ft** (the next non-excluded edge)
- 22.5 > 20 (smallest MP Rotator nozzle) → walker bumps to **r=30**
- The 30ft catalog radius is stored; the visualizer draws a 30ft circle for a 16ft reach

**Two compounding problems:**
1. The ±maxRadius arc-length window is binary — any partial overlap excludes the whole edge.
   A better approach would exclude only the portion of an edge within the arc-length window,
   not the whole edge.
2. The MP Rotator catalog has a gap: 20→30 (no 25). Even with the correct across distance
   of 22.5, the 20ft nozzle falls 2.5ft short and the 30ft nozzle overshoots by 7.5ft. If
   G-H weren't excluded, across=16.3 → 20ft nozzle covers it → reasonable radius.

**Diagnostic recipe:** when a head's drawn radius seems too large:
1. Find which edge the head sits on (distance < 0.5ft to the segment).
2. Compute the Euclidean distance to every other edge.
3. Check which edges the ±maxRadius arc-length window excludes.
4. If a near edge is excluded by partial arc-length overlap, the across distance is inflated.
5. Compare the catalog gap: if the across distance falls between two catalog radii, the
   jump to the next size up explains the overshoot.

**Note:** the walker internally uses an "adjusted radius" (clamped to the across distance)
for the walk convergence math. As of 2026-08-02, this adjusted radius is now **stored** in
`SprinklerHead.AdjustedRadius` and drawn by the visualizer (was previously lost — only the
catalog `Radius` was stored and drawn, producing oversized circles). For sprinkler #11:
catalog radius = 30ft, adjusted radius = 22.5ft (the across distance), drawn circle = 22.5ft.
The `HasThirdPoint` / `BoundaryIntersectionCount` methods also use the adjusted radius, not
the catalog radius, so the "3-intersection" property reflects the actual throw, not the
catalog maximum.

### `ClosestPointExcludingRange` excludes ENTIRE segments, not partial (verified 2026-08-02)

The existing pitfall section above describes the AcrossDistance exclusion window hiding
near edges. The deeper root cause is that `ClosestPointExcludingRange` in `Boundary.cs`
excludes **entire segments** if any part of the segment overlaps the exclusion window,
not just the overlapping portion:

```csharp
bool excluded = wraps
    ? (segEnd > exStart || segStart < exEnd)
    : (segEnd > exStart && segStart < exEnd);
if (excluded) continue;  // skips the ENTIRE segment
```

This means a 60-ft-long edge that only partially overlaps the ±maxRadius window by 2 ft
is entirely excluded — even though 58 ft of it is outside the window and could contain
the nearest point. The method does NOT clip to the non-excluded subsegment; it's all-or-nothing.

**Concrete example (boundary #1, bridge head on DE):** At the midpoint of DE (arc 86.55),
the exclusion window is [71.55, 101.55]. Edge CD (arc 49.92-80.77) partially overlaps
(segEnd=80.77 > 71.55) → entirely excluded. Edge EF (arc 92.32-152.84) partially overlaps
(segStart=92.32 < 101.55) → entirely excluded. The true nearest edges — CD at 5.66 ft and
EF at 5.73 ft — are both excluded. The nearest non-excluded edge is BC at 30.26 ft,
inflating the bridge head from what should be r=10 to r=15.

**The wrapping case is also important:** When the exclusion window wraps around the
perimeter (e.g. arc 7.00 ± 15 = [-8, 22] wraps to [155.88, 163.89] ∪ [0, 22]), edge FA
(arc 152.84-163.89) is also partially excluded — leaving only AB, BC, and CD as
non-excluded edges, all far from the midpoint of AB. This is how the bridge head on AB
gets r=12 (AcrossDistance = 10.53 to EF, which only survives exclusion because EF's arc
span 92.32-152.84 doesn't overlap [-8, 22] even with wrapping).

**Fix candidate (not yet implemented):** clip each segment to the non-excluded arc range
before computing the closest point, rather than excluding the whole segment. This would
make the across distance reflect the true nearest non-own edge.

**Note:** the walker internally uses an "adjusted radius" (clamped to the across distance)
for the walk convergence math. As of 2026-08-02, this adjusted radius is now **stored** in
`SprinklerHead.AdjustedRadius` and drawn by the visualizer (was previously lost — only the
catalog `Radius` was stored and drawn, producing oversized circles). For sprinkler #11:
catalog radius = 30ft, adjusted radius = 22.5ft (the across distance), drawn circle = 22.5ft.
The `HasThirdPoint` / `BoundaryIntersectionCount` methods also use the adjusted radius, not
the catalog radius, so the "3-intersection" property reflects the actual throw, not the
catalog maximum.

**`IsPerimeter` property (added 2026-08-02):** `SprinklerHead` now has `IsPerimeter` (bool,
default true). Set explicitly at placement time: `true` for meander-walk perimeter heads
(in `AddHeadsFromPlacements`), `false` for interior heads (medial-axis fill Pass 2, cap fill
Pass 3, and lattice-fill grid heads). Existing heads from the DXF are `true`. This replaces
the old indirect inference (perimeter = part-circle arc, interior = 360°) with an explicit
property — no more guessing from `arc == 360`.

**"Green" terminology (2026-08-02):** Tim refers to heads without a third point as "green"
for ease of reference: "it was so much easier when I just called them green." When Tim says
"green heads," he means `hasThirdPoint = false` — incomplete heads whose throw only reaches
2 boundary points. "Blue" means `hasThirdPoint = true`. Use these terms in discussion.

### Walker spacing uses adjusted radius — bridge fills gaps (2026-08-02, CORRECTED)

**Key principle:** the walker uses `AdjustedRadius` (the actual throw, 75–100% of catalog)
for ALL spacing decisions. Tim explicitly corrected an initial switch to catalog radius:
"I think that the walker function should use the adjusted radius. And if we did that, we
would find out that we were short one head and needed to add one in there."

**Four places in `RaindropLayoutEngine` use `AdjustedRadius`:**

1. **Close-gap check** (`WalkRun`): `distance < fwd.AdjustedRadius + back.AdjustedRadius` —
   the two threads converge when their adjusted throws overlap.
2. **`RedistributeEvenly`**: `radiusSum[i] = ordered[i].AdjustedRadius + ordered[i+1].AdjustedRadius` —
   heads redistributed proportionally to adjusted throw.
3. **`GetInternalHead` reach check**: `distFromStart > start.AdjustedRadius` —
   stops walking when the next head would be past one adjusted throw from the start.
4. **Bridge span check**: `total += ordered[i].AdjustedRadius + ordered[i+1].AdjustedRadius` —
   same, for detecting gaps that need bridge heads.

**Bridge tolerance = `min(adjR1, adjR2)`, not `adjR1 + adjR2` (CORRECTED 2026-08-02):**
Tim's head-to-head check is: **is each head inside its neighbor's throw circle** (Euclidean
`d ≤ r`), not "do the throw circles overlap" (`d ≤ r1 + r2`). The bridge must trigger when
the gap exceeds the **smaller** of the two adjusted radii — so a small-radius head next to
a big one still gets a bridge if the big head can't reach back. Using `adjR1 + adjR2` lets
gaps through where one head reaches the other but not vice versa.

**The 10% fill threshold is for interior fill ONLY, not bridge tolerance.** Tim: "That 110%
factor is only supposed to be applied to sprinklers in a fixed vertex, not along the edge."
Along an edge, head-to-head is exact: `gap ≤ min(adjR1, adjR2)`. No bonus.

**Result on boundary #2:** went from 12 heads (with gaps where adjusted radii were too small
to reach neighbors) to 15 heads (all head-to-head OK). The bridge added 3 heads where the
small adjusted radii (22.5ft, 25.3ft, 25.6ft) couldn't reach the neighbor. Every head now
reaches its neighbor at adjusted radius — both directions.

**Regression history:** the initial implementation used adjusted radius everywhere. A
misguided "fix" switched to catalog radius (reasoning that "head-to-head means catalog throw
circles touch"). This was wrong — Tim corrected it back. The adjusted radius IS the actual
throw; the walker must space by it. If that creates gaps, bridge heads fill them. The
catalog radius is only used by `AcrossDistance` (exclusion window margin) and `PickHead`
(nozzle size selection).

### Algorithm vs visualizer: color-blind audit (2026-08-02, updated 2026-08-02)

Tim's principle: "I want to make sure our algorithms here are based on math, not about blue
versus green. I want to make sure your code's not using the color as a reason to draw the
medial spine."

**Audit result: the algorithm is already color-blind.** The C# algorithm
(`RaindropMeanderAlgorithm.cs`) never references "anchored", "blue", "green", or color. The
medial axis decision is driven by pure geometry:
- `FindMedialAxis` — per-row/col max distance-to-boundary ridge. No head data.
- `FindLongestMedialAxisBranch` — highest `count × span` score. No head data.
- `DistributeAlongPolyline` — even arc-length spacing.
- Interior fill gate: `interiorRadius >= boundaryWidth × fillThreshold`.
- Coverage skip: positions inside an existing head's throw are skipped.

**`HasThirdPoint` is now WIRED IN (fixed 2026-08-02).** The mathematical property Tim described —
"a complete sprinkler's coverage intersects the boundary in 3 places" — exists as
`Uniformity.HasThirdPoint()` and `Uniformity.BoundaryIntersectionCount()`. `BoundaryIntersectionCount`
counts how many boundary edges the throw circle (at the adjusted radius) intersects or overthrows:
edges the head sits on (distance ≈ 0) always count; edges entirely inside the throw circle (distance < r)
count; tangent edges (|d − r| < tolerance) count. `HasThirdPoint` returns true when the count is ≥ 3.
Both are now called post-placement in `RaindropMeanderAlgorithm.Run` (and in `Program.cs` for existing
heads, and in `LayoutEngine.cs` for the perimeter-only and lattice-fill algorithms). The result is
stored on `SprinklerHead.HasThirdPoint` and serialized to JSON.

**The visualizer's JS `isHeadAnchored` function was DELETED (2026-08-02).** The visualizer now reads
`h.hasThirdPoint` from the JSON data instead of computing its own approximation. The old function
had a richer but different logic (adjacent vs non-adjacent edges, ≤90° corner shortcut, neighbor-
distance check, console.log diagnostics) that was never the same as the C# `HasThirdPoint`. Now
there is one source of truth: the C# `BoundaryIntersectionCount` using the adjusted radius.

**Legend updated:** "Complete head (3+ boundary intersections)" / "Incomplete head (only 2
intersections)" — replacing "Anchored perimeter head" / "Unanchored perimeter head."

**Visualizer color bleeds into spine display — fixed twice (2026-08-02).** The visualizer's medial axis rendering previously hid MA dots that fell inside a complete (blue) head's throw circle — a display-only filter that suppressed the skeleton where perimeter coverage was strong. Tim: "I want to see the medial spine again and I'm not seeing it on two." On boundary #2, all 82 MA points were hidden because all 11 perimeter heads had `hasThirdPoint=true` with 19-35ft throws covering the entire skeleton.

**First fix (removed entirely):** the filter was removed — medial axis rendered as the full, unfiltered skeleton.

**Second fix (Tim's proposal — only inside green heads):** Tim: "I want you to only draw the medial spine when it's inside the radius of a green sprinkler." The visualizer now precomputes the list of green (hasThirdPoint=false) perimeter heads with their adjusted radii, and only renders MA points that fall inside a green head's throw circle. Blue heads' coverage suppresses MA dots (their area is covered); green heads' coverage shows MA dots (their area needs interior fill). This is the principled version: the spine shows where interior fill is needed, not where it's already covered.

**Summary:**

| Concern | Status (2026-08-02) |
|---------|--------|
| Algorithm uses color to draw medial spine? | No — algorithm is pure geometry |
| "3-intersection = complete sprinkler" as a property? | **Wired in** — `HasThirdPoint` computed for every head, serialized to JSON |
| Visualizer uses color to *show* the spine? | **No** — medial axis renders unconditionally (filter removed 2026-08-02) |
| Visualizer computes its own color logic? | **No** — deleted `isHeadAnchored`, reads `hasThirdPoint` from data |

## Ported harness implementation (files)

All in `src/BoundaryLayout.Core/`, namespace `BoundaryLayout.Core.Algorithms` (NOT `.Layout` —
the `Layout` class in Core collides with a `.Layout` namespace, CS0101; keep engines in
`.Algorithms`):

- `Boundary.cs` — added geometry the walker needs: `SegmentLength(i)`,
  `VertexAngleDegrees(i)`, `PointAtPerimeterDistance(d)`, `ClosestPoint(p)`,
  `ClosestPointExcludingRange(p, start, end)`, and a `ClosestResult` struct.
  **NOW USES Raindrop's CurveSeg (ported 2026-08-02, COMPLETED)** — see
  `boundary-layout-harness.md` § "Boundary class — bulge/arc support" for the port details.
  The port added `CurveSeg.cs` with `LineCurveSeg` and `ArcCurveSeg` to handle bulged
  polylines, matching Raindrop's `Geometry/Boundary.cs` + `Geometry/CurveSeg.cs`. `Contains`
  uses a tessellated polygon (arcs → dense straight segments, ray casting); `ClosestPoint`,
  `IntersectCircle`, `PointAtPerimeterDistance`, `SegmentLength` all use real arc geometry.
  A parameterless constructor was added for `Layout.Boundary = new Boundary()`.
- `Layout/RaindropLayoutEngine.cs` — straight-segment port of run-breaker + meander +
  `RedistributeEvenly`, plus `SprinklerSeries` (buildable-head set) and `PerimeterRun`/`WalkHead`
  structs. `WalkRun` returns `(placements, degenerate)`.
- `Layout/RaindropMeanderAlgorithm.cs` — `IBoundaryLayoutAlgorithm` wrapper: takes a
  `Func<Boundary, IEnumerable<SprinklerHead>>` **series resolver** (not a fixed series), called
  per-boundary so each boundary auto-detects its own series from nearby existing heads. De-dupes
  to unique radii (buildable nozzles), calls `RaindropLayoutEngine.Layout`.

**Port gotchas (all hit live):**
- `GetInternalHead` takes BOTH `minRadius` and `maxRadius` params — don't drop `minRadius` (the
  `across > minRadius` gate) or it won't compile (CS0103).
- `BoundaryLayout.Core.Algorithms` namespace collision with the core `Layout` class — engines go
  in `.Algorithms`, and the algorithm wrapper needs `using BoundaryLayout.Core.Algorithms;`.

## Wiring it into the CLI — per-boundary series selection (fixed 2026-08-02)

`Program.cs` registers `RaindropMeanderAlgorithm(b => ResolveSeriesForBoundary(b, catalog, data.Sprinklers))`.
The algorithm takes a **`Func<Boundary, IEnumerable<SprinklerHead>>`** resolver (not a fixed
series), called once per boundary. `ResolveSeriesForBoundary` finds existing heads **within 3 ft
of that boundary's perimeter** (`boundary.ClosestPoint(s.Position).Distance < 3.0`), groups them
by (model, pressure), picks the dominant group, and returns that series' catalog heads. Falls back
to `1800 MPR @ 30` when a boundary has no nearby heads.

**Why per-boundary, not global:** Raindrop's `LayoutHeadsOnBoundaries` uses `template.Series` —
the palette-selected head's series — one series for the whole run, user-chosen. The harness can't
read the palette, so it auto-detects from existing heads. But a real drawing mixes series across
boundaries (Example1 has 26 MP Rotators, 15 Rain Bird 1800s, 8 I-25s across 4 boundaries). A
**global** dominant-series pick gives every boundary the MP Rotator series — wrong for the boundary
that actually has Rain Bird 1800s on it. Per-boundary detection matches each boundary to the series
Tim actually drew on it.

### Pitfall: global series selection → wrong head count (the 8-vs-15 bug)

**Symptom:** The ported meander placed 8 heads on a boundary that has 15 existing heads, and the
placed heads carried MP Rotator profile IDs (`10F`=14ft, `20F`=19ft, `20Q`=20ft, `35H`=35ft) when
they should all be Rain Bird 1800 U-Series (`U-12F`/`U-15F`/`U-10F`, radii 10–15 ft).

**Root cause:** `BuildMeanderSeries` (the old code) grouped ALL 49 sprinklers in the drawing by
(model, pressure) and picked the global dominant — MP Rotator @ 40 (26 heads) > Rain Bird 1800
@ 30 (15) > I-25 @ 60 (8). Bigger nozzles → fewer heads needed → 8 instead of 15. The
3284-Boundary had 15 Rain Bird 1800s on it but got MP Rotator nozzles because the *drawing-wide*
count won.

**Fix:** `ResolveSeriesForBoundary` — select per-boundary using `boundary.ClosestPoint(s.Position).Distance
< 3.0` to find nearby heads, then dominant (model, pressure) among THOSE. After fix: 15 heads, all
U-Series, CU 94.2% / DU 90.8% (was 83.7% / 74.2%).

**Diagnostic recipe:** when the meander head count doesn't match the existing heads on a boundary,
check the `profileId` of the placed heads. If they're from a different series than the existing
heads on that boundary, it's a series-selection bug, not an algorithm bug.

## Arc inference + arc matching — the THIRD pipeline stage (ported 2026-08-02)

The meander walker places heads at positions + radii, but the original port left every head at
360° (full circle). Raindrop's `BoundaryPerimeterLayoutEngine.Layout` runs TWO more stages after
the walker: **arc inference** (what angle should this head spray?) and **arc matching** (which
real nozzle at that radius carries that arc?). Without these, corner heads get full-circle nozzles
(watering outside the boundary) instead of quarter/half nozzles aimed inward — the "rotation issue
in corners" Tim reported.

### What was ported (all in `src/BoundaryLayout.Core/ArcInference.cs`)

Three classes in one file, namespace `BoundaryLayout.Core` (NOT `.Algorithms` — they're
domain-level, used by the algorithm wrapper):

1. **`NozzleArc`** — regex-driven nozzle-arc parsing, ported from
   `~/Raindrop/src/raindrop/Irrigation/NozzleArc.cs`. `PartArcDegrees(nozzle, blockName)` returns
   TQ=270, TT=240, T=120, H=180, Q=90, or -1 (no suffix → adjustable/full). `IsFullCircle(head)`
   checks for "F"/"Full" markers in the profileId. The regex anchoring (`(?:^|[^A-Za-z])` left
   boundary) keeps strip-nozzle names like LSTR/RSTR from false-matching "T".

2. **`ArcInference.InferByHalfRadius`** — the **preferred** arc inference method, ported from
   `~/Raindrop/src/raindrop/Irrigation/Uniformity/ArcInference.cs`. Tim explicitly asked for this
   method: "I had something in there where I took like half the radius and calculated the angle from
   the intersection point of a circle that's half the radius of the sprinkler."
   - Draws a circle at **half the head's effective radius** centered at the head position.
   - **0 intersections** (head >R/2 from boundary) → **360° full circle** (deep interior).
   - **2 intersections** → the arc containing the closest-boundary-point direction is "outward";
     the complement is the **spray sector** (inward arc = 360° − outward). Aim along the inward
     bisector. A corner yields the **actual interior angle** (not just 90°); a straight edge
     yields 180° aimed inward.
   - **Other counts** → falls back to `InferByCurve` (vertex-proximity method, see below).
   Returns `Result { AngleDegrees, RotationDegrees, Method }`.

   **Why InferByHalfRadius, not InferByCurve:** `InferByCurve` (the first port) uses a
   vertex-proximity gate — if the head is within `radius/2` of a vertex, it snaps to the interior
   angle. But it gets the angle WRONG on non-square corners (e.g. MP Rotator boundaries with
   obtuse corners showed 90° when the actual interior angle was different), and the rotations
   don't follow the boundary geometry as precisely. The half-radius probe intersects the actual
   boundary edges, so it measures the TRUE angle from geometry, not a vertex-proximity heuristic.
   On boundary #4 (I-25 rectangle), `InferByHalfRadius` correctly produced a **270°** head at
   a corner where `InferByCurve` had produced 90° — the half-radius circle cut both walls and
   the inward sector was genuinely 270° at that position.

   **`InferByCurve` is still in the file as the fallback** for non-2-intersection cases. It works
   the same way: corner head → interior angle at vertex via bisector probe; edge head → 180°
   inward; interior → 360°. `vertexProximity = w.Head.Radius * 0.5`.

   **Supporting `Boundary` method: `IntersectCircle(Point2D p, double r)`** — returns all
   intersection points of the boundary's edges with a circle of radius `r` at `p`. Uses
   segment-circle quadratic intersection (parametric `t` on each edge). This is what
   `InferByHalfRadius` probes with — `boundary.IntersectCircle(pos, effectiveRadius * 0.5)`.

3. **`SprinklerArcMatcher.Match`** — ported from
   `~/Raindrop/src/raindrop/Irrigation/BoundaryLayout/SprinklerArcMatcher.cs`. Among the series'
   nozzles **at the walker's chosen radius** (scope by `Math.Abs(h.Radius - w.Head.Radius) < 1e-6`),
   picks the one whose fixed arc is closest to the ideal. Adjustable-arc nozzles (no suffix,
   `PartArcDegrees < 0`) pass the ideal angle through with zero fit error.

### Supporting changes

- **`Boundary.ClosestResult` gained a `Tangent` field** (`Point2D`) — `InferByCurve`'s
  segment-degenerate case (sprinkler ON the boundary) derives the inward normal from the segment
  tangent. `ClosestPoint(p)` now returns the tangent of the closest segment. Added a 3-arg
  constructor `ClosestResult(point, distance, tangent)`; the 2-arg constructor stays for
  `ClosestPointExcludingRange` which doesn't need the tangent.

- **`SprinklerHead` gained a `Rotation` property** (`double`, degrees CCW from +X, 0 = full circle).
  Serialized to JSON by System.Text.Json (it's a property, not a field, so `IncludeFields` isn't
  needed). The visualizer reads `h.rotation` to aim the coverage arc.

- **`RaindropMeanderAlgorithm.Run` now keeps ALL nozzles per radius** (not de-duped to one per
  radius). The old code did `GroupBy(h => Round(h.Radius, 4)).Select(g => g.First())` which threw
  away the H/Q/F arc variants at each radius — the matcher then had only one nozzle to "match"
  and always returned 360°. Now `_seriesResolver(boundary).ToList()` passes all nozzles; the
  walker's `SprinklerSeries` stores them all; `PickHeadForDistance` picks by radius (any variant);
  then the matcher re-selects the arc variant at that radius.

- **`RaindropMeanderAlgorithm.Run` applies arc inference per placement** using
  **`InferByHalfRadius`** (the preferred method — Tim asked for it by name):
  ```csharp
  var pos = w.Position(boundary);
  double vertexProximity = w.Head.Radius * 0.5;
  var ideal = ArcInference.InferByHalfRadius(pos, w.AdjustedRadius, boundary, vertexProximity);
  var radiusScoped = seriesHeads.Where(h => Math.Abs(h.Radius - w.Head.Radius) < 1e-6).ToList();
  var match = SprinklerArcMatcher.Match(ideal.AngleDegrees, ideal.RotationDegrees, radiusScoped);
  // → match.Head (the nozzle), match.AssignedAngleDegrees, match.AssignedRotationDegrees
  ```

### Geometric arcs, not catalog-snapped (2026-08-02)

Tim: "I want you to calculate the arc. I want you to ignore the angles, the quarter, half,
full when setting the arcs. When you place them, pick the right one for the angle of the
vertex, but I want you to set the actual arc of the coverage based on that calculation —
whatever it's half the radius, and calculate those intersection points."

**Fix:** `AddHeadsFromPlacements` now stores `ideal.AngleDegrees` and
`ideal.RotationDegrees` (from `InferByHalfRadiusFromAnchor`) instead of
`match.AssignedAngleDegrees` and `match.AssignedRotationDegrees` (from
`SprinklerArcMatcher`). The matcher still picks the right nozzle (radius/flow/profile)
for the boundary angle — but the actual coverage arc is the geometrically inferred angle,
not the catalog's fixed 90/180/270/360.

**Result on boundary #2:** arcs went from all 90/180 to the true vertex angles:
#1=83.7° (vertex A), #2=107.1° (vertex B), #6=124.5° (vertex D), #7=117.8° (vertex E),
#8=92.2° (vertex F), #4=172.4° (slightly curved edge), #9=189.9°, #10=183.3°.

### The Contains-probe flip (arcs pointing outside — fixed 2026-08-02)

`InferByHalfRadius` determines "outward" vs "inward" arc from the closest-point-on-boundary
direction. But meander heads sit **ON** the boundary (distance ≈ 0), so that direction is
degenerate and picks the wrong side ~half the time — 7 of 12 heads on boundary #2 pointed
**outside** the polygon. Tim: "you have the coverage arcs for your heads pointing outside
instead of inside."

**Fix:** after computing `inwardBisector`, probe `boundary.Contains(point at probeR along the
bisector direction)`. If the probe is outside, flip the bisector by 180° (`inwardBisector +=
Math.PI`). `probeR = max(1e-3, effectiveRadius * 0.05)` — same tiny probe Raindrop's
`InferByCurve` uses for the vertex case. After the fix: **0 heads pointing outside across all 5
boundaries** (was 7 on boundary #2 alone). The `Contains` probe is the method Tim referenced:
"we need to come up with some kind of inner test. Contains, I think, is the one we use in
Raindrop."

This is a general principle for any arc-inference method that derives "inward" from closest-point
geometry when the head sits on the boundary: **always verify with a Contains probe and flip if
wrong.** The degenerate closest-point direction is not reliable for on-boundary heads.

### Verified result (Example1.dxf, all 5 boundaries, InferByHalfRadius + Contains flip)

Boundary #1 (Rain Bird 1800, 15→16 heads after bridge fix):

| Arc | Count | Nozzles | Flow |
|-----|-------|---------|------|
| 360° (interior) | 1 | U-12F | full-circle (half-radius probe found no boundary within R/2) |
| 90° (corner) | 3 | U-12Q, U-15Q | quarter-circle, aimed into corners |
| 180° (edge) | 11 | U-12H, U-10H, U-15H | half-circle, aimed inward |

Boundary #2 (MP Rotator, 12 heads): all 12 arcs now point inside after the Contains-probe flip
(was 7 pointing outside).

Boundary #4 (Hunter I-25, 12 heads after bridge fix): one corner head correctly gets **270°** —
the half-radius probe cut both walls and the inward sector is genuinely 270° at that rectangle
corner. This is the key advantage over `InferByCurve` which had produced 90° there.

Total flow on boundary #1: 17.3 gpm (was 36.4 gpm with all-full-circle nozzles). The 5th boundary
(548×93 to 811×163, same 263×70ft rectangle as #4, also I-25) produces identical results to #4.

### Pitfall: de-duping by radius silently kills arc matching

If `RaindropMeanderAlgorithm` or `SprinklerSeries` de-dupes to one head per radius (the old
`GroupBy(Radius).First()` pattern), `SprinklerArcMatcher.Match` sees only ONE nozzle at each radius
and always returns it — typically the full-circle "F" variant that sorts first. The result: every
head gets 360°, the visualizer draws circles everywhere, and Tim says "we have a rotation issue in
corners." The fix is to keep ALL arc variants (F, H, Q) at each radius in the series list, and
scope the matcher candidates to the walker's chosen radius only.

### `InferByHalfRadiusFromAnchor` — anchor-based arc inference (added 2026-08-02)

`InferByHalfRadius` probes from the head's SYMBOL position. But existing (blue) heads sit
~1 ft inside the boundary (install offset), so the R/2 probe circle intersects the boundary
at slightly skewed angles, producing 183° instead of 180°. Tim noticed: "they should all
be 180 or 90. Let's recalculate with that and see if that's what's causing it."

**`InferByHalfRadiusFromAnchor`** (ported from Raindrop's
`ArcInference.InferByHalfRadiusFromAnchor`) probes from the **closest point ON the boundary**
(the anchor/install point), with an explicit **outward direction** (`anchor - symbol`).
This gives clean 180° on edges and 90° at corners regardless of how far inside the symbol
sits — the arc emanates from the boundary, not from the symbol center.

Both existing (blue) and ported (yellow) heads now use this method:
- **Existing heads:** `anchor = boundary.ClosestPoint(s.Position)`,
  `outwardDir = anchor.Point - s.Position`.
- **Ported heads:** same, but when `anchor.Distance < 1e-6` (head ON the boundary),
  `outwardDir` is degenerate (zero) — use the segment normal with a `Contains` probe:
  ```csharp
  double nx = -anchor.Tangent.Y, ny = anchor.Tangent.X;
  var probe = new Point2D(pos.X + nx * probeR, pos.Y + ny * probeR);
  if (boundary.Contains(probe)) { nx = -nx; ny = -ny; }
  outwardDir = new Point2D(nx, ny);
  ```

After this fix, boundary #4 (identical rectangle to #5) shows blue CU=63.4% vs yellow
CU=63.5% — nearly identical, confirming the arcs now match. The #5 gap (blue 76.9% vs
yellow 63.5%) is a real layout difference (blue 10 heads, yellow 12 with extra short-edge
midpoints).

## Bridge heads — the missing post-loop step (fixed 2026-08-02)

The meander walker's convergence check `distance < fwd.AdjustedRadius + back.AdjustedRadius`
(i.e. `r1+r2 = 132ft` for 66ft heads) stops the two threads when they're within **2×radius** of
each other. On a 263ft run with 66ft I-25 heads, the walk produces heads at `[0, 66, 197.2]`
(back marched from 263.2 to 197.2, then `distance(66, 197.2) = 131.2 < 132` → break). The gap
between 66 and 197.2 is 131.2ft — almost 2× the head spacing — but the algorithm thinks it's done.

The original Raindrop `LayAlongBetween` had a **post-loop bridge step** (SprinklerFactory ~line
2185) that added 1-2 "average sprinklers" in the center gap. The port dropped it, and
`RedistributeEvenly` only redistributes existing heads — it doesn't add new ones.

### The fix (in `RaindropLayoutEngine.WalkRun`, after the walk loop + dedup)

After the walk converges and `ordered` is built:

1. **Include the run's end corner.** The back thread marches inward, so the end corner
   (`run.EndArcLength`) is NOT in `ordered` — it's only added later by the next run's fwd and
   deduped at the `Layout` level. Check if it's already there (`Math.Abs(h.ArcLength - run.EndArcLength) < 1e-6`);
   if not, add it via `FirstHeadAt(boundary, run.EndArcLength, sorted)` and re-sort+dedup.

2. **Iteratively add bridge heads at the widest gap** until every gap between consecutive heads is
   `<= maxRadius` (1×radius spacing, matching Tim's hand-laid layouts). Find the widest gap,
   place a head at the midpoint of that gap (sized by `AcrossDistance` at that point), insert it,
   repeat. The `k >= 0.95` degenerate check in `RedistributeEvenly` only catches gaps > 2×radius
   — the bridge needs its own tighter `widestGap <= maxRadius` termination.

3. **`RedistributeEvenly` then spreads all heads** evenly across the full run span.

### Pitfall: bridge not firing because `ordered` excludes the end corner

**Symptom:** A 263ft run with 66ft heads produces 4 heads (3 from the walk + 1 bridge), but Tim's
existing layout has 5 heads at 66ft spacing. The bridge check computes `k = span / total` on
`ordered`'s span — but `ordered = [0, 98.6, 197.2]` (span=197.2, no end corner), so
`k = 197.2 / (2×132) = 0.747 < 0.95` → no bridge. The actual run is 263.2ft; the end corner at
263.2 is missing.

**Fix:** Include the run's end corner in `ordered` before the bridge check (step 1 above). With
the end corner: `ordered = [0, 98.6, 197.2, 263.2]`, span=263.2, `k = 263.2 / (3×132) = 0.665`.
Still < 0.95, so the k-based check doesn't fire — but the `widestGap > maxRadius` check does:
widest gap = 98.6 > 66 → bridge at 49.3 → re-check → widest gap = 65.8 < 66 → done. Result: 5 heads,
redistributed to `[0, 65.8, 131.6, 197.4, 263.2]` — exactly Tim's spacing.

### Pitfall: bridge threshold must be `maxRadius`, not `k >= 0.95`

The `RedistributeEvenly` degenerate check (`k >= 0.95`) fires when the gap is > 2×radius. But
Tim's layouts space heads at 1×radius. The bridge must fire whenever any gap > `maxRadius`, not
when `k >= 0.95`. With 4 heads on a 263ft run at 66ft radius: `k = 0.665 < 0.95` (no degenerate),
but the 87.7ft redistributed gaps exceed the 66ft target. The `widestGap > maxRadius` loop catches
this; the `k >= 0.95` check does not.

### Pitfall: floating-point roundoff triggers spurious bridge heads (2026-08-02)

**Symptom:** On boundary #1, edge DE (11.55 ft), both corner heads (D and E) have
r=12, adjR=11.55. The gap equals the bridge tolerance exactly (11.55 = min(11.55, 11.55)),
so `widestExcess` should be 0.0 and the bridge should NOT fire. But a bridge head
appears at the midpoint of DE with r=15.

**Root cause:** The gap is computed from two different arc-length calculations
(`cumulative arc at E` minus `cumulative arc at D`), while the adjusted radius is
computed from the Euclidean distance to the nearest vertex. These two paths
produce values that differ by ~1.2e-14 ft (floating-point roundoff). The bridge
check `if (widestExcess <= 0) break;` sees `1.24e-14 > 0` and does NOT break,
so it adds a spurious bridge head.

**The bridge head then gets r=15** because the AcrossDistance exclusion window
(±maxRadius = ±15 ft) at the midpoint of DE entirely excludes CD, DE, and EF
(all partially overlap the window). The nearest non-excluded edge is BC at
~30 ft, so `PickHead(30)` returns the largest nozzle (r=15).

**FIXED (2026-08-02):** changed the break condition from
`if (widestExcess <= 0) break;` to `if (widestExcess <= 1e-9) break;` — a
tolerance that absorbs floating-point roundoff without allowing real gaps.
**The fix is in `RaindropLayoutEngine.cs` (harness), in the bridge loop inside
`WalkRun`.** Raindrop's `BoundaryMeanderWalker.cs` does NOT have this bridge
loop (it uses `LayAlongBetween`'s post-loop step instead), so this fix is
harness-only — it will need to be included when the bridge loop is ported
back into Raindrop.
Result on boundary #1: 19 to 18 heads (spurious r=15 bridge on DE eliminated),
CU improved 80.4% to 86.1%, DU 78.3% to 83.0% (removing the oversized bridge head
on a short edge that was already covered actually improved uniformity).

**Diagnostic recipe:** when a bridge head appears on a short edge where the
corner heads' adjusted radii already meet head-to-head:
1. Check `widestExcess` with full precision (G17 format in C# / repr in Python).
2. If it is a tiny positive number (< 1e-6), it is floating-point roundoff, not a real gap.
3. The fix is an epsilon tolerance in the break condition, not a change to the
   gap or radius calculation.

**How to verify:** add a Console.Error.WriteLine inside the bridge loop printing
widestExcess in G17 format. A real gap shows as a number > 0.01; roundoff shows as
< 1e-10.

**How to trace which run placed a head:** add debug logging in Layout() that
prints each run's arc range + head list (run.StartArcLength, run.EndArcLength,
and each WalkHead's ArcLength, Head.Radius, AdjustedRadius). The bridge loop
debug should print widestExcess in G17 format and every ordered[i]
arc/adjR/gap/excess — this is how the 1.2e-14 roundoff was caught (the F6
format showed 0.000000 but G17 showed 1.2434497875801753E-14).

### Bridge tolerance now uses `--fill-threshold` (updated 2026-08-02)

Tim noticed midpoint heads on the short edges of boundaries 4/5 (70ft edges, r=66): "For some
reason, on boundaries four and five, we're still ending up with a head in the middle of the
short side." The corner heads at B and C both throw 66ft, which already overlaps across 70ft —
the bridge was adding an unnecessary midpoint head because `70 > 66` (gap > maxRadius).

**Fix:** the bridge tolerance now uses the same `--fill-threshold` parameter as the interior
fill gate. Instead of `widestGap <= maxRadius`, it breaks when `widestGap <= maxRadius × (1 +
threshold)`. At 10%: `66 × 1.10 = 72.6ft`, and the 70ft gap is within tolerance → no bridge head.

This unifies the "throw almost reaches" concept across both perimeter bridge logic and interior
fill gate. Tim's mental model: "the width of boundaries four and five is like within ten percent
of the radius... each head is touching the head next to it on either side, and except for the
corners, it's within 10% of having a third point touch the boundary."

**Implementation:** `RaindropLayoutEngine.Layout` and `WalkRun` now accept a `fillThreshold`
parameter (default 0.10), passed from `RaindropMeanderAlgorithm.Run` via
`options.InteriorFillThreshold`. The bridge loop computes `bridgeTolerance = maxRadius × (1 +
fillThreshold)` and breaks when `widestGap <= bridgeTolerance`.

**Result:** Boundaries 4/5 went from 12 heads to 10 (no midpoint on short edges). CU improved
from 63.5% to 76.2% — the bridge heads were adding water where it wasn't needed, skewing
uniformity.

### Verified result (boundary #5, 263×70ft rectangle, I-25 @ 66ft)

| | Before bridge fix | After bridge fix | Tim's existing |
|---|---|---|---|
| Heads | 8 | **12** | 10 |
| Bottom edge | 3 @ 98.6ft gaps | **5 @ 65.8ft gaps** | 5 @ 65.5–66.1ft |
| Top edge | 3 @ 98.6ft gaps | **5 @ 65.8ft gaps** | 5 @ ~66ft |
| CU/DU | 81.8%/72.4% | 80.2%/80.5% | — |

The extra 2 heads are on the short edges (70ft edges that now get a midpoint head). Spacing
matches Tim's layout: 65.8ft (ported) vs 65.5–66.1ft (Tim's).

## Uniformity comparison: ported vs. existing (updated 2026-08-02)

With the uniformity engine upgraded to match Raindrop's DepthField (arc fraction +
triangular profile + flow), the side-by-side comparison on Example1.dxf:

**Critical: existing (blue) heads now get the SAME arc inference as the ported (yellow)
heads.** Tim insisted: "the blue sprinkler should have the exact same coverage arc
calculation as the yellow sprinklers. So their arcs and radius and everything will match
up exactly." Both blue and yellow use the same depth model (arc fraction + triangular
profile + flow) for uniformity. This is an apples-to-apples comparison — the only
difference is head POSITIONS (Tim's hand layout vs. the meander walker's layout).

### `InferByHalfRadiusFromAnchor` — the anchor-based method (added 2026-08-02)

Tim noticed that blue and yellow arcs didn't match: existing heads (slightly inside the
boundary at ~1ft offset) got arcs like 183°/185° from `InferByHalfRadius`, while ported
heads (exactly ON the boundary) got 180°/90°. Tim: "they should all be 180 or 90. Let's
recalculate with that and see if that's what's causing it."

**Root cause:** `InferByHalfRadius` probes from the head's SYMBOL position. Existing
heads sit ~1 ft inside the boundary (install offset), so the R/2 probe circle
intersects the boundary at slightly skewed angles, producing 183° instead of 180°.
Ported heads sit ON the boundary, so the probe is clean.

**Fix: ported `InferByHalfRadiusFromAnchor`** from Raindrop's
`ArcInference.InferByHalfRadiusFromAnchor`. This method casts the R/2 probe from the
**closest point ON the boundary** (the anchor / install point), with an explicit
**outward direction** (`anchor - symbol`). This gives clean 180° on edges and 90° at
corners regardless of how far inside the symbol sits — the arc emanates from the
boundary, not from the symbol center.

Both existing (blue) and ported (yellow) heads now use `InferByHalfRadiusFromAnchor`:
- **Existing heads:** `anchor = boundary.ClosestPoint(s.Position)`,
  `outwardDir = anchor.Point - s.Position` (the install-offset direction).
- **Ported heads:** same, but when `anchor.Distance < 1e-6` (head exactly ON the
  boundary), `outwardDir` is degenerate (zero) — use the segment normal with a
  `Contains` probe to pick the outward side:
  ```csharp
  double nx = -anchor.Tangent.Y, ny = anchor.Tangent.X;
  var probe = new Point2D(pos.X + nx * probeR, pos.Y + ny * probeR);
  if (boundary.Contains(probe)) { nx = -nx; ny = -ny; }
  outwardDir = new Point2D(nx, ny);
  ```

After this fix, boundary #4 (identical rectangle to #5) shows blue CU=63.4% vs yellow
CU=63.5% — **nearly identical**, confirming the arcs now match. The #5 gap (blue 76.9%
vs yellow 63.5%) is a real layout difference: blue has 10 heads (no short-edge
midpoints), yellow has 12 (2 extra on short edges).

| # | Series | Existing CU/DU (blue) | Ported CU/DU (yellow) | Winner |
|---|---|---|---|---|
| 1 | Rain Bird 1800 | 91.1% / 85.2% | **93.8% / 90.4%** | Ported |
| 2 | MP Rotator | **84.4% / 74.9%** | 84.3% / 75.8% | Tie |
| 3 | MP Rotator 35H | 48.2% / 21.5% | **51.0% / 22.4%** | Ported (both bad — wide boundary) |
| 4 | Hunter I-25 | 63.4% / 57.9% | **63.5% / 66.6%** | ~Tie (arcs now match) |
| 5 | Hunter I-25 | **76.9% / 77.1%** | 63.5% / 66.6% | Existing (Tim's hand layout wins) |

**Key insight: Tim's hand layout on boundary #5 still wins** (76.9% vs 63.5%) even with
matching arc inference — his 10-head layout at ~66ft spacing is more uniform than the
algorithm's 12-head layout. The algorithm adds 2 extra heads on the short edges that Tim
didn't place. **The iteration target: should the algorithm skip heads on short edges where
the corner anchors already cover the span? Or should it use full-circle heads on large
I-25 boundaries where Tim's hand layout proves fewer full-circle heads are more uniform
than more part-circle heads?**

## Interior fill — iterative inward polygon offset (added 2026-08-02)

The perimeter-only meander leaves wide boundaries under-watered at the center.
Tim's brainstorm: "how do you find out where a polygon is going to need a full
circle in the middle? How do you define the width of a polygon, especially if
there's more than one side?" The solution: **iteratively offset the polygon
inward by half the head radius and run the meander on the inner polygon.**
Interior heads get 360° (full-circle) arcs since they're far from any boundary
edge.

### The offset approach (Minkowski shrink)

`Boundary.OffsetInward(double distance)` in `Boundary.cs`:
- Normalizes to CCW (positive signed area) by checking `SignedArea` and reversing
  vertices if CW.
- For each vertex, computes the inward normals of the two adjacent edges (for CCW:
  `(-dy, dx) / len`), offsets both edges inward by `distance`, and finds the new
  vertex at the intersection of the two offset lines. Parallel edges → average normal.
- **Collapse detection (three checks, all required):**
  1. `Area < 1.0` — area too small.
  2. `Bounds` width or height `< 1.0` — bounding box too thin (self-intersected
     polygons can have positive area but zero width).
  3. **`SignedArea < 0`** — winding flipped (CCW → CW). This is the critical check:
     when the offset distance exceeds half the polygon's width in any dimension,
     the offset edges cross and the polygon inverts. A flipped signed area is the
     reliable signal. **Pitfall:** if the original polygon was CW (negative area),
     the offset is done in reversed (CCW) order, so the result should be CCW
     (positive). A negative result means it collapsed — always check
     `result.SignedArea < 0`, not `wasCCW && result.SignedArea < 0`.

### The interior pass (in `RaindropMeanderAlgorithm.Run`)

After the perimeter pass:
1. Find the **dominant perimeter radius** (most common head radius among
   perimeter placements).
2. `offsetDistance = interiorRadius * 0.5` — half the head radius. This captures
   the "under-watered" interior (where the triangular profile drops below 50% of
   peak), not just the geometrically uncovered area. A boundary that's exactly
   2×radius tall has zero uncovered area but a 0-depth center strip; offsetting
   by 0.5r leaves a 1r-tall inner polygon that needs interior heads.
3. Build a **single-radius series** for the interior pass (just the dominant
   radius head, not all nozzles) so the meander doesn't pick smaller nozzles
   for the thinner inner polygon.
4. Run `RaindropLayoutEngine.Layout` on the inner polygon.
5. **Force 360° full-circle arcs** on interior heads (they spray into the full
   interior, not along an edge).
6. Repeat: offset the inner polygon inward again by `offsetDistance`. Stop when
   `OffsetInward` returns null (collapsed).

### Pitfall: offset by full radius → collapses too early

Offsetting by the full head radius (`interiorRadius`) means a boundary that's
exactly 2×radius tall produces a zero-height inner polygon → no interior heads.
But the triangular profile is zero at the rim, so the center gets zero depth.
**Always offset by 0.5×radius** to capture the under-watered zone, not just the
geometrically uncovered zone. On boundary #3 (263×70ft, r=35): full-radius offset
→ 0 interior heads, 82% coverage. Half-radius offset → 16 interior full-circle
heads, 100% coverage, CU jumps from 48% → 79%.

### Pitfall: letting the meander pick small nozzles for interior

The meander walker picks the smallest head whose radius covers the across-distance.
On a thin inner polygon, the across-distance is small, so it picks the smallest
nozzle in the series (e.g. 8ft on a 10ft-tall inner polygon), producing hundreds
of tiny heads. **Fix:** build a single-radius `SprinklerSeries` with just the
dominant perimeter head for the interior pass. The meander then places heads at
the correct spacing for that radius.

### Results (Example1.dxf, with offset-based interior fill — SUPERSEDED by trough)

The offset approach worked but was replaced by the trough approach (see below).
These were the offset results before the switch:

| # | Boundary | Blue CU/DU | Yellow CU/DU | Interior heads |
|---|---|---|---|---|
| 1 | 72×14ft, r=12 | 91.1%/85.2% | **93.8%/90.4%** | 0 (too thin, offset collapses) |
| 2 | 126×52ft, MP Rotator | 84.4%/74.9% | 81.4%/69.7% | 13 full-circle |
| 3 | 263×70ft, r=35 | 48.2%/21.5% | **78.9%/64.7%** | **16 full-circle** (the big win) |
| 4 | 263×70ft, r=66 | 63.4%/57.9% | **83.6%/77.5%** | 10 full-circle |
| 5 | 263×70ft, r=66 | 76.9%/77.1% | **83.6%/77.5%** | 10 full-circle |

### Why the offset approach works for arbitrary polygons

"Width" isn't a single number for an L-shape or T-shape. The inward offset
defines it implicitly: wherever the offset polygon has positive area, the
boundary is wider than 2× offset distance there, and that area needs heads.
You don't measure width — you shrink and see what's left. For an L-shape, the
inner polygon is also L-shaped; the meander handles it naturally.

## Medial-axis-guided trough fill (added 2026-08-02, updated 2026-08-02 — longest-branch + even distribution)

Tim's brainstorm: "if you look at the uniformity map itself, there are low
points. And in a place like number three, those low points would be a trough.
And maybe sprinklers would sit in the driest trough and then you could iterate.
Maybe there's a hybrid there... draw a line through the lowest points in the
grid and then lay a row of sprinklers along that polyline."

### How it works (current — longest-branch + even distribution)

1. Find the **medial axis** (thin skeleton) — `Uniformity.FindMedialAxis`.
2. Extract the **longest branch** of the skeleton —
   `Uniformity.FindLongestMedialAxisBranch`. For a rectangle, the skeleton is
   a cross; this picks the horizontal arm (the long center line), not the
   vertical arm (already covered by perimeter heads).
3. Compute **head count** from branch length / head radius.
4. **Evenly distribute** 360° full-circle heads along the branch polyline at
   equal arc-length intervals — `Uniformity.DistributeAlongPolyline`. First
   head at the start, last at the end, rest evenly between.
5. Skip any placement within 0.5×radius of a perimeter head.

This replaced the earlier greedy driest-first approach (see "Evolution" below).

### `FindMedialAxis` — thin skeleton (fixed 2026-08-02)

**Pitfall:** the original used a threshold band (distance ≥ 50% of max) which
produced a **grid of 2070 dots**, not a line. Tim: "I'm seeing the medial axis
rendered as a grid... oh, it's a skeleton." The fix: for each grid ROW, pick
the column with max distance-to-boundary (horizontal ridge); for each COLUMN,
pick the row with max distance (vertical ridge). Union is 1-cell-wide: 155
points for a 263×70ft rectangle (a cross at center).

### `FindLongestMedialAxisBranch` — separate the cross (added 2026-08-02)

**Problem:** `FindMedialAxis` produces a **cross** for a rectangle — the
horizontal arm (spanning the long dimension) plus the vertical arm (spanning
the short dimension). The greedy driest-first placement picked from the entire
cross, so some interior heads landed on the short vertical arm instead of all
on the horizontal center line. Tim: "all 6 should be on the center line."

**Two failed approaches before the fix:**

1. **BFS flood-fill connectivity** — treat points within 1.5×grid spacing as
   connected, group into branches, pick the largest. **Fails** because the
   cross is connected at the center point — the entire cross is ONE connected
   component, so BFS returns the whole cross, not just the horizontal arm.

2. **Group by Y, pick widest X extent** — **Fails** because edge stragglers
   (rows near the top/bottom edge with only 2-3 points) can have a wider X
   extent than the center line. On boundary #3: the y=44.9 center line had 99
   points spanning X=270-466 (extent=196), but y=12.9 had only 2 points
   spanning X=238-498 (extent=260). The extent-only metric picked the 2-point
   edge group over the 99-point center line — wrong.

**The fix: score by `count × extent`.** Group skeleton points by rounded Y
(for the horizontal ridge) and by rounded X (for the vertical ridge). The
true center-line ridge has by far the most points (one per column), while
edge stragglers have few. `Score = group.Count × (max - min)` rewards both
length and density. The ridge with the higher score wins. For boundary #3:
hRidge score = 99×196 = 19404, vRidge score ≈ 3×68 = 204. Horizontal wins
decisively.

Return the winning ridge's points sorted along the dominant axis (X for
horizontal, Y for vertical).

### `DistributeAlongPolyline` — even spacing (added 2026-08-02)

Given a sorted polyline and a count N, places N points at equal arc-length
intervals: first at 0, last at total length, rest evenly between. Uses a
cumulative arc-length lookup with binary search per point. This gives
**uniform spacing** along the center line — exactly what Tim wants — replacing
the old greedy driest-first that produced irregular spacing.

### Evolution of the interior fill

1. **Iterative trough (threshold-based)** — find driest point below 5% of
   mean, place head, recompute, repeat. Worked for #3 but not #4/#5 (center
   depth above threshold). Superseded.
2. **Iterative inward polygon offset (Minkowski shrink)** — offset polygon
   inward by 0.5×radius, run meander on inner polygon, repeat. Over/under-filled.
   `Boundary.OffsetInward` still in codebase. Superseded.
3. **Medial-axis-guided trough (greedy driest-first)** — find skeleton,
   compute depth along it, greedily place at driest points with radius
   spacing. Worked but placed heads on both arms of the cross. Superseded by
   longest-branch approach.
4. **Medial-axis longest-branch + even distribution (current)** — extract
   the longest branch of the skeleton (horizontal center line for a wide
   rectangle), distribute heads evenly along it. All interior heads on the
   center line, uniformly spaced.

### Results (Example1.dxf, longest-branch + even distribution + threshold gate + head-to-head spacing + cap fill)

| # | Boundary | Heads | Full | Part | CU | DU | Coverage |
|---|---|---|---|---|---|---|---|
| 1 | 72×14ft, r=12 | 15 | 0 | 15 | 93.4% | 89.5% | 100% |
| 2 | 126×52ft, MP Rotator | 16 | 5 | 11 | 76.7% | 70.2% | 100% |
| 3 | 263×70ft, r=35 | 27 | 7 | 20 | 82.2% | 71.5% | 100% |
| 4 | 263×70ft, r=66 | 10 | 0 | 10 | 76.2% | 77.1% | 100% |
| 5 | 263×70ft, r=66 | 10 | 0 | 10 | 76.2% | 77.1% | 100% |

**Note:** Boundary #2 CU dropped from 88.2% (with r=30 for all cap fills)
to 76.7% (with inradius-matched r=14/20) because the smaller radii cover
less area. The throw circles are now approximately tangent to the boundary
edges — Tim's preference for visual correctness over CU at this stage.
**After the cap fill was rewritten to use medial axis points** (not 3-edge
incenters), boundary #2 has only 2 fulls (was 5), both on the medial axis
(0.0ft and 2.1ft from nearest MA point). CU is 73.9% — fewer heads but in
the right positions. The next step: adjust head POSITION to be equidistant
from boundary AND nearest neighbor (see "Full heads should be equidistant"
below).

**Boundary #2** (iterative cap fill): 4 cap-fill heads placed at 3-edge
incenters, each below 75% of mean depth. CU 72.1%→**88.2%**, DU
67.7%→**81.8%**. The first cap-fill head (179.3, 44.7) is the XX point —
incenter of B-C, D-E, F-G.

**Boundary #3** (the test case): all 7 interior heads on y=44.9, evenly
spaced at ~32.7ft (within the 35ft throw — head-to-head). Was: 6 heads at
~39ft (too wide, not head-to-head). CU 78.8%→82.2%, DU 65.5%→71.5%.

**Boundary #4/#5 regression FIXED:** CU went from 63.5% to **76.2%** — the
short-edge bridge heads (midpoint on 70ft edges where r=66 already overlaps)
were removed by the threshold-aware bridge tolerance. Was 12 heads, now 10.
The extra bridge heads were adding water where it wasn't needed, skewing
uniformity.

### Head-to-head interior spacing (added 2026-08-02)

Tim: "they're all a little short. The heads should be throwing kind of on the
same calculation you ran on a boundary edge where you need to add one more
head because they're not head-to-head. Consider that line in the middle, the
median, I guess we're calling it. Consider it like treat it like a boundary
edge."

**Fix:** changed interior head count from `round(branchLen / radius)` to
`ceil(branchLen / radius) + 1`. This treats the medial axis like a boundary
edge: first and last heads at the endpoints, gaps ≤ radius. On boundary #3:
196ft / 35ft = 5.6 → ceil = 6 → 6+1 = 7 heads, 6 gaps of 32.7ft (all within
the 35ft throw). Was 6 heads with 5 gaps of 39.2ft (exceeding the 35ft throw
— not head-to-head).

### Full heads should be equidistant from boundary or nearest neighbor (2026-08-02)

Tim (out-of-band): "when we place full heads as we're trying to find the places
where we need full heads, the full head should be equidistant from the
boundary or its nearest neighbor."

**Status: not yet implemented.** This is the next algorithm improvement. The
concept: when placing interior full-circle heads (medial axis fill or cap fill),
the position should be chosen so the head is equidistant from the nearest
boundary edge AND its nearest neighbor head — not just at the driest incenter.
This would make the full head "self-center" between the boundary and its
neighbors, similar to how cap-fill heads self-center between 3 edges. The
current cap-fill algorithm only considers equidistance from 3 boundary edges;
it should also consider distance to existing heads.

### Interior fill threshold gate (added 2026-08-02, updated 2026-08-02 — also governs bridge tolerance)

Tim's observation: "The width of boundaries four and five is like within ten
percent of the radius that we're using for those heads. And so each head is
touching the head next to it on either side, and except for the corners, it's
within 10% of having a third point touch the boundary. So in that case, we
don't need to add heads in the middle. But we still need to add all the heads
in the middle on boundary three."

### The rule (applies to both interior fill AND perimeter bridge)

The `--fill-threshold` parameter (default 10%, adjustable via CLI) governs
TWO things:

1. **Interior fill gate** — skip fill when
   `interiorRadius >= boundaryWidth × (1 - threshold)`.
2. **Perimeter bridge tolerance** — skip bridge head when
   `widestGap <= maxRadius × (1 + threshold)`.

Both use the same mental model: "if the throw almost reaches across within
the threshold, don't add a head." For interior fill, it's the throw reaching
across the boundary width. For bridge heads, it's the throw reaching across
the gap between two existing heads on a perimeter edge.

- **Boundary width** = 2 × max inscribed radius (the max distance from the
  medial axis to the nearest boundary edge). For a rectangle, this is the
  short side.
- **Skip fill when:** `interiorRadius >= boundaryWidth × (1 - threshold)`
- Default threshold = 10% (0.10). Adjustable via `--fill-threshold` CLI flag.

### Implementation

- **`LayoutOptions.InteriorFillThreshold`** (double, default 0.10) — new
  property on `LayoutOptions` in `LayoutEngine.cs`.
- **CLI flag** `--fill-threshold <fraction>` in `Program.cs` — parsed and
  passed to `LayoutOptions`.
- **Gate in `RaindropMeanderAlgorithm.Run`** — after finding the medial axis,
  compute `maxInscribed` (max distance-to-boundary along the axis), then
  `boundaryWidth = 2 × maxInscribed`. If `interiorRadius >= boundaryWidth ×
  (1 - threshold)`, skip the entire interior fill block.

### Results (Example1.dxf, threshold=10%)

| # | Size | Radius | r/width | Fulls | CU | DU | Cov |
|---|------|--------|---------|-------|------|------|-----|
| 1 | 72×14 | 12 | 96% | 0 | 93.8% | 90.4% | 100% |
| 2 | 126×52 | 20 | 38% | 1 | 82.9% | 72.1% | 100% |
| 3 | 263×70 | 35 | 51% | **6** | 78.8% | 65.5% | 100% |
| 4 | 263×70 | 66 | 97% | 0 | 63.5% | 66.6% | 100% |
| 5 | 263×70 | 66 | 97% | 0 | 63.5% | 66.6% | 100% |

Boundaries 4/5 (r=66, inscribed=34, width=68): 66 ≥ 68×0.90=61.2 → skip.
Boundary 3 (r=35, inscribed=34, width=68): 35 < 68×0.90=61.2 → fill, 6 fulls.
Boundary 1 (r=12, inscribed=6.2, width=12.4): 12 ≥ 12.4×0.90=11.16 → skip.

### Threshold sensitivity

| Threshold | #4/#5 fulls | Why |
|-----------|-------------|-----|
| 0.10 | 0 | 66 ≥ 68×0.90=61.2 → skip |
| 0.05 | 0 | 66 ≥ 68×0.95=64.6 → skip |
| 0.00 | 3 | 66 < 68 → fill (3 fulls at ~98ft spacing) |

Tim wants this adjustable so we can tune across different head sizes and
boundary shapes. "Let's make that a variable 10% so we can adjust it like
5, 10, 0."

### Pitfall: inscribed radius ≠ half the short side exactly

The medial axis grid points don't always hit the exact center of the
boundary. For a 70ft-wide rectangle, the inscribed radius comes out as 34.0
(not 35.0) because the grid (2ft spacing) lands at y=44.9, and
`min(44.9-10.9, 80.8-44.9) = min(34, 35.9) = 34`. This 1ft discrepancy
affects the threshold boundary case: at threshold=0, 66 < 68 → fill, even
though geometrically 66 ≈ 70 (the actual width). Always use the computed
inscribed radius, not the nominal boundary dimension.

## Cap fill — 3-point inscribed circle (added 2026-08-02)

Tim's idea: "boundary two has a dry spot on the right end, and I want to fill
in a circle that touches the boundary at three points there. So it kind of
centers itself." The concept: after perimeter + medial axis fill, some
boundaries have "caps" — triangular regions at the ends where 3 boundary edges
meet and the interior is under-watered. Place a full-circle head at the
**incenter** of the triangle formed by those 3 edges — the point equidistant
from all 3. The head "self-centers" because its throw reaches 3 edges
simultaneously.

### Failed first approach — driest point → 3 nearest edges

**Concept:** find the global driest point, take its 3 nearest boundary edges,
compute the incenter of the triangle formed by those 3 edge lines.

**Why it fails:** the 3 nearest edges to a dry spot don't necessarily form a
triangle that *encloses* the dry spot. On boundary #2, the driest point at
(188, 34) had nearest edges F-G (16ft), G-H (20ft), D-E (25ft). The incenter
of those 3 edge lines was at (231.5, 11.1) — **outside the boundary**. The
3 edges were on the wrong sides of the dry spot, so their triangle's incenter
landed outside the polygon.

### Working approach — iterate ALL edge triples

**`Uniformity.FindCapFillPosition(boundary, existingHeads, gridSpacing, minDistToHead)`**
in `Uniformity.cs`:

1. Precompute the depth field for the current layout.
2. Try **all C(n,3) triples** of boundary edges (n is small — typically 4-8
   for irrigation boundaries, so 4-56 triples).
3. For each triple, compute the **pairwise line intersections** of the 3 edge
   lines (extended if needed). If any pair is parallel, skip.
4. The 3 intersections form a triangle. Compute its **incenter** (weighted
   average of vertices by opposite side length) and **inradius** (area /
   semiperimeter).
5. **Filter:** incenter must be inside the boundary (`boundary.Contains`),
   not too close to existing heads (< `minDistToHead`).
6. **Score:** look up the depth at the incenter's nearest grid point. Pick
   the **driest** incenter.

**`RaindropMeanderAlgorithm.Run` Pass 3** calls this after perimeter +
medial axis fill, placing one full-circle head at the driest incenter using
the dominant perimeter head's radius/flow.

### Depth threshold learning

The initial depth threshold for `FindDriestPoint` was 50% of mean — but on
boundary #2, the driest point (depth 0.0029) was ABOVE 50% of mean (0.0026),
so `FindDriestPoint` returned null and no cap fill was placed. The fix:
**iterate all edge triples directly** (not via `FindDriestPoint`), scoring
by depth at each candidate incenter. The depth threshold is implicit —
the algorithm picks the *driest* incenter, whatever its absolute depth.

### Result on boundary #2

The cap-fill head landed at **(179.3, 44.7)** — the incenter of edges
**B-C, D-E, F-G** (inradius 23.8ft). A r=30 head there throws 30ft, reaching
past all 3 edges. This is in the center-right of the boundary, not the D-E-F
right cap — because the center was the driest incenter inside the boundary.

| | Before cap fill | After cap fill |
|---|---|---|
| Heads | 12 | **13** |
| Fulls | 1 | **2** |
| CU | 72.1% | **80.3%** |
| DU | 67.7% | **70.7%** |
| Coverage | 100% | 100% |

### The medial axis relationship (key insight — 2026-08-02)

Tim asked: "what can we tell about this circle's relationship to the medial
skeleton thing?" The answer: **the cap-fill incenter IS on the medial axis.**
It's a **junction point** where 3 branches of the skeleton meet.

- The medial axis is the set of points equidistant from the **2 nearest**
  boundary edges. The cap-fill incenter is equidistant from **3 nearest**
  edges — a junction where branches converge.
- On boundary #2, the XX point (186.80, 39.88) is 1.3ft from the nearest
  medial axis grid point (185.7, 40.5) — well within the 2ft grid spacing.
  That grid point is the **peak** of the medial axis (max
  distance-to-boundary = 20.68ft). The cap-fill inradius (21.49ft) is
  slightly larger than the MA peak's inscribed radius (20.68ft) only
  because the grid didn't sample the exact junction.
- **The cap-fill algorithm is finding medial axis junction points.** The
  3-edge incenter IS the peak of the medial axis where 3 branches converge.
  This is the principled basis for cap fill: self-centering circles go at
  MA junctions.

### Perimeter heads vs cap-fill — the "third point" concept (2026-08-02)

Tim's observation: "the sprinklers at D, E, F and the one near G — they
intersect with their neighbors, but they don't intersect with the boundary
in a third place." Each perimeter head's throw circle touches 1-2 edges
(where it sits) and reaches one more, but none is tangent to 3 edges
simultaneously. The cap-fill head is the ONLY point where the circle is
tangent to 3 edges at once.

Verified on boundary #2:

| Head | At | r | Sits on | Reaches 3rd edge? | Tangent to 3? |
|------|-----|---|---------|-----------------|---------------|
| D (90°) | corner C-D/D-E | 35 | C-D, D-E | E-F at 34.1ft (almost =35) | No — not equidistant |
| E (90°) | corner D-E/E-F | 30 | D-E, E-F | F-G at 28.7ft (almost =30) | No — not equidistant |
| F (90°) | corner E-F/F-G | 30 | E-F, F-G | D-E at 28.7ft (almost =30) | No — not equidistant |
| near-G (180°) | edge F-G | 35 | F-G | E-F at 32.9, G-H at 5.7 | No — not equidistant |
| **XX (cap fill)** | **interior** | **30** | **none** | **C-D, D-E, F-G all at 21.5ft** | **Yes — tangent to all 3** |

**Rule:** perimeter heads cover edges (own + reaching one more). The
cap-fill head covers the **interior** — the point where 3 edges are
equally far away, which is the dry spot between them. The perimeter
heads can't do this job because they're pinned to the edge, not
self-centered.

### Iterative cap fill (updated 2026-08-02 — multiple heads + depth threshold)

The initial implementation placed only ONE cap-fill head per boundary.
Tim's reaction: "try and implement it and see what happens. I'm down."
The algorithm now **iterates**: place one cap-fill head, recompute depth,
find the next driest incenter, repeat — up to 5 caps per boundary.

**`FindCapFillPosition` now accepts a `dryThreshold` parameter** (default 0):
- When 0 (unset), it computes `threshold = meanDepth × 0.75` and only
  returns an incenter whose depth is below that threshold.
- When > 0, uses that as the absolute threshold.
- The iterative loop in `RaindropMeanderAlgorithm.Run` (Pass 3) calls
  `FindCapFillPosition` repeatedly. Each call recomputes the depth field
  (seeing the previously placed cap-fill heads). When no incenter is dry
  enough, `FindCapFillPosition` returns null and the loop breaks.

**`HasThirdPoint` — now wired in as a property (2026-08-02, updated).** Tim's concept:
"we keep a list of sprinklers that are tangent to the boundary in a third spot. And
anything that's on a boundary and not tangent, and that the coverage only intersects
two places — those sprinklers probably need additional sprinklers."
`Uniformity.HasThirdPoint(boundary, head, tolerance=0.5)` is now **called for every
placed head** (in `RaindropMeanderAlgorithm.Run`, `Program.cs` for existing heads, and
`LayoutEngine.cs` for the baseline algorithms). The result is stored on
`SprinklerHead.HasThirdPoint` and serialized to JSON for the visualizer.

**However, `HasThirdPoint` is NOT used as a cap-fill gate.** It was attempted as a gate
and abandoned because every perimeter head passes when using the catalog radius — even a
90° corner head geometrically overthrows a third edge (e.g. head E at r=30 reaches F-G
at 28.7ft — 28.7 < 30 − 0.5 = 29.5, so it counts as "overthrows"). The issue is that
reaching an edge at 96% of throw provides negligible depth (triangular profile:
3×(1−0.96) = 0.12 = 12% of peak PR). The geometric circle reaches the edge, but the
actual water doesn't. Cap fill is gated by the depth threshold (75% of mean) instead.

**Note on the adjusted radius fix (2026-08-02):** `HasThirdPoint` and
`BoundaryIntersectionCount` now use the **adjusted radius** (the actual throw), not the
catalog radius. This may change the gate behavior — a head whose adjusted radius is 22.5ft
(down from 30ft catalog) may no longer reach a third edge, making it green (incomplete)
where it was previously blue. This is the correct behavior: the property should reflect
the actual throw, not the catalog maximum.

### Results (Example1.dxf, iterative cap fill)

| # | Boundary | Before cap fill | After cap fill |
|---|---|---|---|
| 1 | 72×14ft, r=12 | 15 heads, 0 fulls, CU 93.4% | 15 heads, 0 fulls, CU 93.4% (no dry incenters) |
| 2 | 126×52ft, MP Rotator | 12 heads, 1 full, CU 72.1% | **16 heads, 5 fulls, CU 88.2%, DU 81.8%** |
| 3 | 263×70ft, r=35 | 27 heads, 7 fulls, CU 82.2% | 27 heads, 7 fulls, CU 82.2% (medial axis covers) |
| 4 | 263×70ft, r=66 | 10 heads, 0 fulls, CU 76.2% | 10 heads, 0 fulls, CU 76.2% (threshold gate skips) |
| 5 | 263×70ft, r=66 | 10 heads, 0 fulls, CU 76.2% | 10 heads, 0 fulls, CU 76.2% (threshold gate skips) |

Boundary #2's 4 cap-fill heads are at:
- (179.3, 44.7) — incenter of B-C, D-E, F-G (the XX point, inradius 23.8ft)
- (194.1, 39.3) — incenter of D-E, C-D, E-F
- (153.7, 42.8) — incenter of C-D, B-C, G-H
- (201.2, 24.8) — incenter of E-F, F-G, D-E

### Cap-fill head radius — match the inradius, not the catalog default (2026-08-02)

Tim: "the full sprinklers you have 13, 14, 15, and 16 should be calculating
a radius so that its tangent to the boundary. The radius that they've got
is way too big."

**Problem:** cap-fill heads used `interiorHead.Radius` (the dominant
perimeter radius, e.g. 30ft for MP Rotators). But the inradius (distance
to the 3rd nearest edge) is much smaller — 13.4ft, 23.8ft, 19.5ft, 21.0ft
for the 4 cap-fill heads on boundary #2. A 30ft throw at a 13ft-inradius
position massively overshoots all 3 edges — the "self-centering" circle
is 2× too big.

**Fix:** cap-fill heads now pick the **catalog head whose radius is closest
to the inradius** (`seriesHeads.OrderBy(h => Math.Abs(h.Radius - inradius)).First()`).
This makes the throw circle approximately tangent to the 3 edges — the
self-centering property Tim wants. The catalog sizes are coarse (MP Rotator:
10, 14, 15, 19, 20, 22, 30, 35) so the match isn't exact, but it's much
closer: head #12 went from r=30 to r=14 (inradius 13.4ft), head #15 went
from r=30 to r=14 (inradius 19.5ft — closest available).

**Trade-off:** CU dropped from 88.2% to 76.7% because smaller radii cover
less area. But the throw circles are now proportional to the boundary
geometry, not overshooting massively. Tim's preference: the visual
correctness of tangent circles matters more than the CU number at this
stage. The next step is to also adjust the head POSITION to be equidistant
from the boundary AND its nearest neighbor (see "Future work" below).

**Pitfall:** `seriesHeads` may contain multiple nozzles at the same radius
(e.g. 30F, 30H, 30Q all have r=30). `OrderBy(h => Math.Abs(h.Radius -
inradius)).First()` will pick whichever comes first — usually the full-circle
variant, which is correct for cap fill (we want 360°). If the series
listing order ever changes, scope to `Arc >= 360` first:
`seriesHeads.Where(h => h.Arc >= 360).OrderBy(...).First()`.

### Sprinkler number labels — ALL boundaries (corrected 2026-08-02)

Tim initially saw labels only on the selected boundary and corrected:
"I need labels on the points for all the polygons." The number labels
(1, 2, 3...) now render on ALL boundaries, not just the selected one.
Non-selected boundaries get dimmer label text (`#8a9aaa`) to avoid
clutter. The label is offset up-right from the head dot (6px right, 9px up),
font `10px system-ui`, with a dark background box sized to the text width.

### Visualizer color classification — `hasThirdPoint` from data (2026-08-02, rewritten 2026-08-02)

Tim: "I want to make sure our algorithms here are based on math, not about blue
versus green."

**The visualizer no longer computes its own color logic.** The old `isHeadAnchored(b, algo, hi)`
JS function was **deleted** in favor of reading `h.hasThirdPoint` from the JSON data, computed
by the C# `Uniformity.HasThirdPoint` / `BoundaryIntersectionCount` using the adjusted radius.

**Before (deleted):** The JS `isHeadAnchored` had its own richer-but-different logic:
1. Find the two closest part-circle neighbors (by Euclidean distance, skipping full-circle heads).
2. Check if the head is within `radius` of BOTH neighbors.
3. Check if the throw overthrows (`d < r − 0.5`) or is tangent (`|d − r| < 0.5`) to at least
   one boundary edge it doesn't sit on — with adjacent edges (sharing a vertex) excluded.
4. Corner heads at vertices with interior angle ≤ 90° always returned true (blue).
5. `console.log` diagnostics printing sits/adjReach/nonAdjReach/nonAdjMiss => BLUE|GREEN.

**After (current):** The visualizer reads `h.hasThirdPoint` (boolean, computed in C#) and
colors accordingly:
- `hasThirdPoint = true` → blue (`#64b4ff`) — "Complete head (3+ boundary intersections)"
- `hasThirdPoint = false` → green (`#4caf50`) — "Incomplete head (only 2 intersections)"
- Full-circle (`arc >= 359.5`) → orange (`#ff8c00`) — always, regardless of hasThirdPoint

**Why the change:** Tim wanted the algorithm to be "based on math, not about blue versus
green." Having two separate implementations (C# `HasThirdPoint` and JS `isHeadAnchored`)
with different logic meant the colors didn't reflect the algorithm's actual properties.
Now there is one source of truth: the C# `BoundaryIntersectionCount` using the adjusted radius.

**What was lost vs gained:**
- Lost: the neighbor-distance check (was the head within radius of both neighbors?), the
  adjacent-edge exclusion (non-adjacent only), the ≤90° corner shortcut, the console.log
  diagnostics. These were visualizer-only heuristics, not algorithm properties.
- Gained: single source of truth, colors match the actual mathematical property, adjusted
  radius (not catalog radius) used for the intersection count.

**The `HasThirdPoint` C# method** counts edges where: (a) the head sits on the edge
(distance < tolerance), (b) the edge is entirely inside the throw circle (distance < r − tol),
or (c) the edge is tangent (|distance − r| < tolerance). Uses `AdjustedRadius` when available
(falling back to `Radius`). Returns true when count ≥ 3.

**Adjacency fix (2026-08-02):** the initial C# `BoundaryIntersectionCount` counted ALL
reached edges, including **adjacent** edges (sharing a vertex with an own edge). This made
corner heads blue when they should be green — e.g. head #6 on boundary #2 sits on C-D and
D-E, reaches E-F (adjacent, shares vertex E) → counted as 3, marked blue. Tim caught this:
"sprinklers six and nine should both be green because they hit their nearest neighbors, but
they don't get in contact with the boundary again." **Fix:** `BoundaryIntersectionCount` now
excludes edges that share a vertex with any own edge (the `ownVerts` set). Only
**non-adjacent** reached edges count as third points. After the fix, boundary #2 went from
11 blue/0 green to 2 blue/9 green — only heads that genuinely reach a non-adjacent edge
(like #4 reaching G-H and H-A from B-C/C-D) are blue.

### Cap fill rewritten to use medial axis points (2026-08-02)

Tim: "can you explain to me how those full sprinklers are getting placed
what's the logic there" — the 3-edge incenter approach was placing heads
OFF the medial axis (2-4ft away). Tim's observation: the positions "look
incorrect, it should be on the medial axis."

**Root cause:** the 3-edge incenter finds the point equidistant from 3
edge LINES (extended infinitely), not the point on the skeleton equidistant
from 2 nearest edge SEGMENTS. The incenter of 3 lines can be off the
medial axis because it solves a line-equidistance problem, not a
max-distance-to-boundary problem.

**Fix:** cap fill (Pass 3) now searches medial axis points directly:
1. Compute depth field with current heads.
2. Compute `dryThreshold = meanDepth × 0.75`.
3. Iterate every medial axis point: find the driest one that's (a) below
   the dry threshold and (b) not within 0.5×radius of any existing head.
4. Place a full-circle head there, with radius = distance to nearest
   boundary edge (closest catalog size).
5. Recompute depth and repeat (max 5 iterations).

**Result on boundary #2:** 2 fulls instead of 5. Head #13 at (191.7, 36.5)
is **exactly on the medial axis** (0.0ft). The 4 off-axis incenter heads
are gone. CU dropped from 88.2% to 73.9% — fewer heads cover less, but
they're in the right places (on the skeleton).

### Corner heads and medial axis rendering (2026-08-02, updated 2026-08-02)

Tim: "let's not draw that median width if we are inside if it is inside
of blue sprinklers" and "let's avoid making the blue the fixed edge
sprinklers in the corners. Green, they should be blue so that we don't
get any of the medial axis close to the corners."

**Two changes (original), one retained, one removed:**

1. **~~`isHeadAnchored` corner shortcut (DELETED 2026-08-02)~~** — The old
   `isHeadAnchored` JS function always returned `true` (blue) for heads at
   vertices with interior angle ≤ 90°, regardless of the third-edge check.
   This was a visualizer-only heuristic to prevent medial axis rendering
   near corners. When `isHeadAnchored` was deleted and replaced by
   `h.hasThirdPoint` from data, the corner shortcut was removed. Corner
   heads now get blue/green based on the actual `BoundaryIntersectionCount`
   — if the adjusted radius reaches a third edge, they're blue; if not,
   they're green.

2. **~~Medial axis rendering suppressed inside blue head throw circles (REMOVED 2026-08-02)~~** —
   The medial axis dot rendering loop previously precomputed the list of blue
   (hasThirdPoint=true) perimeter heads with their positions and **adjusted
   radii**, then skipped any medial axis point that fell inside a blue head's
   throw circle (`dx² + dy² ≤ r²`). This meant the green skeleton only appeared
   in gaps where green (incomplete) heads left coverage holes. On boundary #2,
   ALL 82 medial axis points were hidden because all 11 perimeter heads were
   blue with 19-35ft throws covering the entire skeleton. Tim: "I want to see
   the medial spine again and I'm not seeing it on two." **The filter was removed
   entirely** — the medial axis now renders as the full, unfiltered skeleton
   on every boundary. The medial axis is a geometric property of the boundary,
   independent of head placement.

3. **Colors apply to ALL boundaries** (not just the selected one). The
   old code passed `true` (always blue) for non-selected boundaries to
   save computation. Tim: "I shouldn't have to switch through the
   boundaries." Now `hasThirdPoint` is computed for every head on every
   boundary (in C#, not JS).

### Limitations and future work

- **Full heads should be equidistant from boundary AND nearest neighbor**
  (not yet implemented). Tim (out-of-band): "when we place full heads as
  we're trying to find the places where we need full heads, the full head
  should be equidistant from the boundary or its nearest neighbor." The
  current cap-fill only considers equidistance from 3 boundary edges; it
  should also consider distance to existing heads so the full head
  self-centers between the boundary AND its neighbors.
- **The catalog radius match is coarse.** MP Rotator sizes jump from
  22→30→35. An inradius of 24ft gets r=30 (6ft overshoot) or r=22 (2ft
  undershoot). A future approach could interpolate or flag that no good
  catalog match exists.
- **The 75% depth threshold may place too many heads.** The threshold is
  a candidate for tuning or making a CLI parameter.
- **`HasThirdPoint` is now wired in as a property** (2026-08-02) — computed for every
  head and serialized to JSON. It is NOT used as a cap-fill gate (geometric overthrow ≠
  meaningful coverage at 96% of throw). A future approach could check whether the head's
  actual ARC (not full circle) provides meaningful depth at the third edge, or use a
  depth-weighted intersection count instead of the binary geometric check.
- **The old `FindCapFillPosition` (3-edge incenter) method is still in
  `Uniformity.cs`** but is no longer called. The cap fill now searches
  medial axis points directly. The old method could be removed in a
  cleanup pass.

### Key `netstandard2.0` pitfall — tuple deconstruction + operator precedence

`var (A, B, C) = (intersections[0], intersections[1], intersections[2]);`
causes `CS1003: Syntax error, ',' expected` in netstandard2.0 even with
`LangVersion=latest`. **Fix:** use separate variable declarations:
```csharp
var A = intersections[0];
var B = intersections[1];
var C = intersections[2];
```
Also: `Math.Abs((B.X - A.X) * (C.Y - A.Y) - (C.X - A.X) * (B.Y - A.Y)) / 2.0)`
has wrong operator precedence — the `/2.0` only divides the second term.
**Fix:** wrap the cross product in parens before dividing:
`Math.Abs(((B.X - A.X) * (C.Y - A.Y) - (C.X - A.X) * (B.Y - A.Y)) / 2.0)`.

## Visualizer rendering — labels, colors, and markers (updated 2026-08-02)

The canvas visualizer (`visualizer/index.html`) went through several rendering
iterations this session. Tim's preferences for visual clarity:

### Vertex labels (A, B, C, D, ...) — on ALL boundaries

Tim: "I need labels on the points for all the polygons." Initially only rendered
on the selected boundary; Tim wanted them on every boundary so he can refer to
corners regardless of which is selected. **Implementation:** labels render
inside the `data.boundaries.forEach` loop (not gated by `selected`), offset
outward from the centroid by 12px, font `bold 11px system-ui`. Selected
boundary labels are teal (`#4ecdc4`), non-selected are dimmer (`#6a8a9a`).

### Sprinkler number labels (1, 2, 3, ...) — on ALL boundaries

Tim: "start labeling the sprinklers starting at one. So we'll have
vertices as letters, and then we'll have sprinklers as numbers."
Initially rendered only on the selected boundary; Tim corrected: "I
need labels on the points for all the polygons." Now renders on ALL
boundaries. Non-selected boundaries get dimmer label text (`#8a9aaa`).
Labels are offset up-right from the head dot (6px right, 9px up), font
`10px system-ui`, sized smaller than vertex letters (11px) so they don't
clash.

### Color coding — blue (complete) vs green (incomplete) perimeter heads (updated 2026-08-02)

Tim: "I want to make sure our algorithms here are based on math, not about blue
versus green."

**The visualizer reads `h.hasThirdPoint` from JSON data** (computed in C# by
`Uniformity.HasThirdPoint` / `BoundaryIntersectionCount` using the adjusted radius).
The old `isHeadAnchored(b, algo, hi)` JS function was **deleted** — it had its own
logic (neighbor-distance check, adjacent-edge exclusion, ≤90° corner shortcut,
console.log diagnostics) that was never the same as the C# property.

**Current logic (single source of truth):**
- `h.hasThirdPoint = true` → blue (`#64b4ff`) — "Complete head (3+ boundary intersections)"
- `h.hasThirdPoint = false` → green (`#4caf50`) — "Incomplete head (only 2 intersections)"
- Full-circle (`arc >= 359.5`) → orange (`#ff8c00`) — always, regardless of hasThirdPoint

**What was lost from the old JS function:** the neighbor-distance check (was the head
within radius of both neighbors?), the adjacent-edge exclusion (non-adjacent edges only),
the ≤90° corner shortcut (corners always blue to suppress medial axis clutter), and the
console.log diagnostics. These were visualizer-only heuristics. Tim's principle: the
colors should reflect the mathematical property computed by the algorithm, not a
separate JS approximation.

**Colors:**
- Blue (`#64b4ff`) — complete perimeter head (wedge fill + dot)
- Green (`#4caf50`) — incomplete perimeter head (wedge fill + dot)
- Orange (`#ff8c00`) — full-circle interior head (circle outline + fill + dot)

### Full-circle heads rendered in orange with visible radius

Tim: "I want you to... make the full sprinklers an orange color with an
orange radius." Full-circle heads draw an orange circle outline (1.5px
line width) with a light orange fill (`rgba(255,140,0,0.10)` for selected,
`rgba(255,140,0,0.04)` for non-selected). Part-circle heads stay yellow/blue
wedges. Head dots: orange for full-circle, blue/yellow for part-circle.

### XX marker — red dashed circle + dot + label

The 3-edge incenter (XX point) on boundary #2 is marked with:
- Red dashed circle (radius = inradius, `ctx.setLineDash([4, 3])`)
- Red dot (5px radius)
- "XX" label (red text on dark background, offset up-right)

### Legend

Updated to show all 5 categories: Boundary (teal), Complete head / 3+ boundary
intersections (blue), Incomplete head / only 2 intersections (green), Full-circle
head (orange), XX 3-edge incenter (red).

### Auto-reload

The visualizer auto-reloads `samples/example1.json` every 2 seconds. HTML
changes require a full page reload (auto-reload only re-fetches JSON, not
HTML). When Tim says "refresh" or "I'm not seeing the changes," use
`browser_navigate` to reload the page.

The port DOES anchor heads on vertices: boundary 0 of `Example1.dxf` (a 6-vertex polygon) places
heads exactly on 4 of its 6 vertices. The two it skips are the shallow, nearly-straight vertices
that `PerimeterRunBreaker` doesn't classify as sharp corners (< 150° break angle). If Tim wants a
head on EVERY vertex regardless of angle, that's a small add (force a corner head per vertex), not
a port bug.

**"Yellow dots not at corners" was usually the visualizer default, not the algorithm.** The
visualizer defaulted `fillAlgos()` to `algoIdx=0` (the first algorithm = perimeter-only), so the
naive midpoint-per-edge fill showed instead of the meander's corner anchors. Fix was to default the
visualizer to the meander/ported algorithm (see `boundary-layout-harness.md` § view persistence).
Rule: when Tri reports "your dots aren't in the corners," first check WHICH algorithm the
visualizer is displaying before suspecting the port.

A full head-by-head position comparison vs. the drawing's blue existing heads is still the
definitive check (select `raindrop-meander (ported)`, eyeball yellow vs blue overlap). Reminder:
the drawing's sprinkler SYMBOLS are offset off the boundary for graphics reasons — the coverage
geometry position is ON the boundary, so expect yellow (meander) on the line where blue (drawn
symbol) may be inset.
