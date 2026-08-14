# Boundary Orientation & Boundary-Tagging Architecture

> Reference for `IR_LayoutOnBoundary`, coverage arc orientation, `OrientHeadFromBoundary`,
> and the `RD_SPRINKLER_BOUNDARY` polyline tag. Captured during issue #694.

## The Two-Stage Layout Pipeline

`IR_LayoutOnBoundary` has two stages that can disagree about which boundary matters:

### Stage 1 — Layout engine (CAD-free, correct)

`BoundaryPerimeterLayoutEngine.Layout` (in `src/raindrop/Irrigation/BoundaryLayout/`)
computes each head's ideal arc angle and rotation via `ArcInference.InferByCurve`
against the **actual picked boundary polyline**. This is pure geometry — no layer
awareness. The result is stored on `SprinklerPlacement`:

- `SprinklerPlacement.AngleDegrees` — arc sweep (90° corner, 180° edge, etc.)
- `SprinklerPlacement.RotationDegrees` — bisector aim, CCW from +X
- `SprinklerPlacement.AdjustedRadius` — coverage-driven throw (catalog-feet)
- `SprinklerPlacement.BoundaryIndex` — which boundary in the job list
- `SprinklerPlacement.Position` — catalog-feet, ON the boundary line/vertex

`LayoutMany` runs `Layout` in parallel (one task per boundary job), so placements
from multiple boundaries arrive in a flat list indexed by `BoundaryIndex`.

### Stage 2 — Insert + orient (the override, the original bug source)

`SprinklerFactory.LayoutHeadsOnBoundaries` (`SprinklerFactory.cs:~1848`) is the
CAD-side caller. It converts catalog-feet positions to drawing units, applies the
install offset (half symbol size inward along the aim bisector), and calls
`InsertSprinklerBlockAtPoint`. Inside that, `ApplyNozzleArc` calls
`OrientHeadFromBoundary(sprinkler, probe, GetBoundaryData())` — and
`GetBoundaryData()` → `BuildBoundaryData()` scans model space **filtered by
`IsBoundaryLayer`** (layer name contains "bound", or matches the explicit
`SprinklerBoundaryLayer` picker setting).

**The bug (#694):** When the picked polyline is NOT on a boundary layer, it's
excluded from `BuildBoundaryData`'s snapshot. `OrientHeadFromBoundary` then
either snaps the head to a DIFFERENT polyline that IS on a boundary layer, or
falls back to the nozzle default arc. Either way, the correct result from
Stage 1 was silently overwritten.

## Key Code Locations

| Component | File | Line (approx) |
|---|---|---|
| `LayoutHeadsOnBoundaries` | `SprinklerFactory.cs` | 1848 |
| Read-pass (tag boundary polylines) | `SprinklerFactory.cs` | ~1916 |
| Commit loop (insert + offset + pass-through) | `SprinklerFactory.cs` | 1930–2030 |
| `InsertSprinklerBlockAtPoint` (tr overload, arcDegrees param) | `SprinklerFactory.cs` | 1201 |
| `ApplyNozzleArc` (calls OrientHeadFromBoundary, then PersistArcState) | `SprinklerFactory.cs` | 2790 |
| `PersistArcState` (shared persist helper) | `SprinklerFactory.cs` | ~2860 |
| `OrientHeadFromBoundary` (containment + fallback) | `SprinklerFactory.cs` | 2858 |
| `BuildBoundaryData` (layer-filtered + tag scan) | `SprinklerFactory.cs` | 3905 |
| `IsBoundaryLayer` ("bound" name check) | `SprinklerFactory.cs` | 3897 |
| `AutoOrientAgainstBoundaryLayer` (Reset Coverage) | `SprinklerFactory.cs` | 3912 |
| `WriteArcAnchor` (XData write pattern) | `SprinklerFactory.cs` | 3677 |
| `BoundaryPerimeterLayoutEngine.Layout` | `BoundaryLayout/BoundaryPerimeterLayoutEngine.cs` | 56 |
| `SprinklerPlacement` class | `BoundaryLayout/BoundaryPerimeterLayoutEngine.cs` | 11 |
| `ArcInference.InferByCurve` | `Irrigation/Uniformity/ArcInference.cs` | 58 |
| `ArcInference.ResolveAnchor` (Boundary overload) | `Irrigation/Uniformity/ArcInference.cs` | 350 |
| `SPRINKLER_BOUNDARY` app name (polyline tag) | `AID_AppName.cs` | ~634 |

## The Fix (issue #694) — Two Parts

### Part A — Immediate: pass the layout engine's arc/aim through to insert

The transaction overload of `InsertSprinklerBlockAtPoint` now accepts an optional
`arcDegrees` parameter. When both `aimRadians` and `arcDegrees` are provided (the
`IR_LayoutOnBoundary` path), it stamps them directly — Angle, rotation,
AdjustedRadius, arc anchor, WriteXData — and **skips** `ApplyNozzleArc` /
`OrientHeadFromBoundary` entirely. The layout engine's computed arc/rotation is
the final word; layer membership becomes irrelevant during layout.

Non-`IR_LayoutOnBoundary` callers (single insert, polyline/meander layout, swap,
grid) don't pass `arcDegrees`, so their behavior is unchanged.

```csharp
// In LayoutHeadsOnBoundaries commit loop:
Sprinkler inserted = InsertSprinklerBlockAtPoint(tr, p.Head, pos, blockRotation, radius,
    aimRadians: rotationRadians, arcDegrees: p.AngleDegrees);
```

### Part B — Structural: tag the boundary POLYLINE (not the sprinkler)

**Critical design lesson:** We initially proposed storing a boundary handle on
each sprinkler (`RD_SPRINKLER_BOUNDARY` XData on the sprinkler, pointing at the
boundary polyline). This was **rejected** because:

- **Copy:** AutoCAD deep-copies XData, so the copy carries the original's boundary
  handle — pointing at a boundary across the drawing from where the copy landed.
- **Swap:** `SwapHeadNozzleInPlace` and `SwapOneSprinkler` both call the non-transaction
  `InsertSprinklerBlockAtPoint` overload, which creates a fresh `Sprinkler` with no
  boundary handle carried forward. The swapped head loses the link.
- **Move:** Drag a head to a new bed and the stored handle is stale.
- **Containment is unavoidable anyway:** To find "all sprinklers in boundary X" for
  uniformity, you must scan all sprinklers and do point-in-polygon — hand-placed and
  interior heads have no stored link. So the scan is the true source of truth.

**The chosen approach:** `RD_SPRINKLER_BOUNDARY` XData is written on the **picked
boundary polyline** (presence of the app name marks it as a boundary). This is
written once per boundary in `LayoutHeadsOnBoundaries`' read-pass transaction
(idempotent — skips if already tagged, wrapped in try/catch for locked-layer
resilience). `BuildBoundaryData` then includes tagged polylines **regardless of
layer name**, in addition to the existing `IsBoundaryLayer` filter:

```csharp
// In BuildBoundaryData:
bool isTagged;
try { isTagged = XData.HasAppName(id, AID_AppName.SPRINKLER_BOUNDARY, tr); }
catch (System.Exception) { isTagged = false; }
if (!isTagged && !IsBoundaryLayer(pl.Layer, explicitLayer)) continue;
```

This makes the containment scan see the tagged boundary for **every** head inside
it — copy/move/swap-proof, no per-sprinkler stored link that goes stale. Reset
Coverage (`AutoOrientAgainstBoundaryLayer`) and `OrientHeadFromBoundary` work
for tagged boundaries automatically through the existing containment scan, with
no code changes needed in those methods.

### Why tag the polyline, not the sprinkler — the design reasoning

The tag goes on the **stable** object (the boundary polyline, which doesn't move
when you copy/move/swap heads), not the **mobile** one (the sprinkler). The
containment scan is already the correct way to discover which heads are in which
boundary — it just couldn't see non-boundary-layer polylines before. Tagging the
polyline fixes the scan's blind spot without introducing a parallel data
structure that duplicates what containment already gives you and can go stale.

## PersistArcState — Shared Persist Helper (from PR review)

The `pr-review-toolkit` review found that the `arcDegrees` pass-through branch
duplicated `ApplyNozzleArc`'s persist tail (`CalculateArea` → `WriteXData` →
`WriteArcAnchor` → `ADJUSTED_RADIUS` write). This was the exact scattered-persist
pattern that caused issue #584. The fix: extract a shared `PersistArcState`
helper called by both paths:

```csharp
// In InsertSprinklerBlockAtPoint (pass-through path):
bool callerProvidedArc = arcDegrees.HasValue && aimRadians.HasValue
    && !double.IsNaN(arcDegrees.Value) && arcDegrees.Value > 0 && arcDegrees.Value <= 360;
if (callerProvidedArc)
    sprinkler.Angle = arcDegrees.Value;
else
    ApplyNozzleArc(sprinkler, sprinklerDef, arcRadius);  // sets Angle + aim + anchor
PersistArcState(sprinkler, arcRadius);  // shared persist — can't drift

// ApplyNozzleArc also calls PersistArcState:
private static void ApplyNozzleArc(Sprinkler sprinkler, SprinklerDefinition def, double arcRadius)
{
    if (sprinkler == null) return;
    sprinkler.Angle = ArcDegreesForNozzle(def);
    double probe = arcRadius > 0 ? arcRadius : sprinkler.Radius * DrawingUnitFactor();
    OrientHeadFromBoundary(sprinkler, probe, GetBoundaryData());
    PersistArcState(sprinkler, arcRadius);
}
```

The `arcDegrees` validation (NaN, ≤0, >360 → fall back to `ApplyNozzleArc`) was
added as part of the same fix — the pass-through no longer stamps garbage angles
from degenerate boundaries.

## Error-Handling Guards (from PR review)

All three XData-touching code paths now have try/catch guards:

1. **LayoutHeadsOnBoundaries read-pass tag** — per-polyline try/catch, skips
   un-writable polyline with `Debug.WriteLine` instead of aborting the whole
   transaction.
2. **BuildBoundaryData HasAppName** — try/catch treats a throw as
   `isTagged = false`, so a corrupt entity can't zero the drawing's boundary
   snapshot.
3. **arcDegrees range validation** — `callerProvidedArc` boolean checks NaN
   and range before stamping; bad input falls back to `ApplyNozzleArc`.

## XData Tag vs Handle-Link Patterns

The codebase has several patterns for XData — know which to use:

1. **Presence tag** (`CODE_APPNAME` only, no value) — used by
   `RD_SPRINKLER_BOUNDARY` on a polyline. `XData.HasAppName(id, appName, tr)`
   checks presence. No stale-handle risk because nothing is stored to go stale.
2. **String handle** (`CODE_STRING` + hex handle string) — used by
   `RD_UNIFORMITY_LABEL`, `RD_UNIFORMITY_GRID`, valve→sprinkler links.
   Resolve back with `Utililty.GetObjectIDFromHandle(handleString)`. Goes stale
   if the target entity is deleted.
3. **Real offset** (`CODE_REAL` pairs) — used by `RD_ARC_ANCHOR` (dx, dy) and
   `RD_ADJUSTED_RADIUS` (single real). Read back with `XData.ReadFloat` or
   `XData.ReadXData` + manual parse.

`RD_SPRINKLER_BOUNDARY` uses pattern 1 (presence tag) — this is deliberate. It
marks the polyline as a boundary without storing any reference that could go
stale. The containment scan does the rest.

## CAD-Free vs CAD-Aware Boundary

Two `Boundary` construction helpers exist — don't mix them up:

- **`BoundaryFromPolyline(pl)`** — raw drawing-unit coordinates. Used by
  `BuildBoundaryData` / `OrientHeadFromBoundary` (compares against
  drawing-unit radii).
- **`BoundaryInCatalogFeet(pl)`** — scaled to catalog-feet. Used by
  `BoundaryPerimeterLayoutEngine` (compares against `SprinklerDefinition.Radius`,
  which is always catalog feet). Callers MUST convert positions back to
  drawing units (`* DrawingUnitFactor()`) before using as CAD coordinates.

## Testing Boundary Layout

- **Unit-testable (CAD-free):** `BoundaryPerimeterLayoutEngine.Layout`,
  `ArcInference.InferByCurve`, `Boundary`, `EdgeSet` — all in
  `src/RaindropTests/` (`BoundaryPerimeterLayoutEngineTests.cs`,
  `EdgeArcInferenceTests.cs`, `BoundaryTests.cs`). No document needed.
- **CAD-dependent (live-test only):** `LayoutHeadsOnBoundaries` → insert →
  XData write, `OrientHeadFromBoundary` with real polylines. Covered by the
  debug bridge's `layout-boundary-preview` / `layout-boundary-commit` ops
  (`DebugBridgeService.Phase4.cs:~124`), not unit tests.

## SprinklerArcMatcher adjustable-arc pass-through (fixed in #694)

Even after the #694 pass-through fix, corner heads could still come out at 180°
for adjustable-arc series. The root cause was in `SprinklerArcMatcher` /
`NozzleArc`, not in the boundary orientation code. **This is now fixed.**

### The original bug

1. `BoundaryPerimeterLayoutEngine.Layout` calls `ArcInference.InferByCurve` which
   correctly computes the ideal angle (90° at a corner, 180° on an edge).
2. It then calls `SprinklerArcMatcher.Match(idealAngleDegrees, ...)` to find the
   series head whose `FixedArcDegrees` is closest to the ideal.
3. `SprinklerPlacement.AngleDegrees` was set to `match.AssignedAngleDegrees` —
   the **matched** angle, NOT the ideal angle.
4. The #694 pass-through fix faithfully stamped that `AssignedAngleDegrees` onto
   the head.

`SprinklerArcMatcher.FixedArcDegrees(head)` calls
`NozzleArc.PartArcDegrees(head.Nozzle, head.BlockName)`, which looks for
TQ/TT/T/H/Q suffix tokens. For an **adjustable-arc** series like Hunter I-25,
every catalog row has nozzle = `18` or `15` (a radius code, not an arc code)
and BlockName = `Auto`. `PartArcDegrees` returns -1 for both, so
`FixedArcDegrees` fell back to **180.0** for every head in the series.

`SprinklerArcMatcher.Match` could then only ever return
`AssignedAngleDegrees = 180.0`, even when `idealAngleDegrees = 90`. The
`ArcFitDeltaDegrees` was non-zero (e.g. 90°) — the tell-tale diagnostic
signal visible in the debug bridge's `layout-boundary-preview` output.

### The fix

When the best-matching head is an **adjustable-arc** nozzle (`PartArcDegrees`
returns -1 — no fixed suffix), `SprinklerArcMatcher.Match` now passes the
`idealAngleDegrees` through as `AssignedAngleDegrees` with zero fit error.
The nozzle can be set to any arc, so the layout engine's computed angle IS the
correct arc. Full-circle nozzles (360°) and fixed-arc nozzles (H/Q/TQ/TT/T)
are unaffected — they keep their fixed arcs.

The detection: `!NozzleArc.IsFullCircle(best)` AND
`NozzleArc.PartArcDegrees(best.Nozzle, best.BlockName) < 0`. A `Debug.Assert`
verifies that `bestFixedArc == DefaultPartArcDegrees` is implied. This
distinguishes "adjustable" (unsuffixed nozzle, 180° fallback for matching)
from "fixed 180°" (a nozzle with an `H` suffix that genuinely means 180°) —
the latter has `PartArcDegrees` return 180, not -1.

### How to spot it via the debug bridge

```bash
# Run a layout preview on the tagged boundary and check angle/arcFitDelta:
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" \
  -d '{"name":"layout-boundary-preview","handles":["<boundary-handle>"]}'
# Before the fix: every placement has angle=180 but some have arcFitDelta > 0.
# After the fix: corner placements have angle=90 and arcFitDelta=0.
```

### Key code locations

| Component | File |
|---|---|
| `SprinklerArcMatcher.Match` (adjustable pass-through) | `Irrigation/BoundaryLayout/SprinklerArcMatcher.cs:~60` |
| `SprinklerArcMatcher.FixedArcDegrees` | `Irrigation/BoundaryLayout/SprinklerArcMatcher.cs:~88` |
| `NozzleArc.PartArcDegrees` | `Irrigation/NozzleArc.cs:31` |
| `NozzleArc.FromToken` (TQ/TT/T/H/Q regex) | `Irrigation/NozzleArc.cs:38` |
| Engine's call to Match | `BoundaryLayout/BoundaryPerimeterLayoutEngine.cs:116` |

### Design lesson: tag the stable object, not the mobile one

The same principle that guided the polyline-tag approach applies here: don't
store data on the mobile object (sprinkler) that duplicates what you can derive
from the stable one (boundary polyline / nozzle type). The adjustable-arc
nozzle doesn't need a stored arc — it can do any arc. The layout engine's
ideal angle is the correct answer; the matcher's job is to pick the right
nozzle, not to override the geometry.

## Arc Anchor Gap — boundary-layout heads not emanating from the boundary (2026-08-02)

### Symptom

After `IR_LayoutOnBoundary`, coverage arcs on round perimeter heads emanate from
the symbol's offset position (inward by half plot size), NOT from the boundary
line where the engine actually placed the head. Tweak Coverage "fixes" it:
tweaking a head snaps the arc origin to the boundary, suggesting the layout
command should have done the same.

### Root cause

`LayoutHeadsOnBoundaries` computes `basePos` (line ~2005) — the engine's position
ON the boundary, converted to drawing units — then offsets it inward to get
`pos` (line ~2006, the symbol insert point):

```csharp
Point3d basePos = new Point3d(p.Position.X * drawingUnitFactor, p.Position.Y * drawingUnitFactor, 0);
Point3d pos = basePos.Polar(rotationRadians, offsetDistance);
```

It then calls `InsertSprinklerBlockAtPoint` with `aimRadians` and `arcDegrees`
but **NOT `arcOrigin`** (line ~2058):

```csharp
Sprinkler inserted = InsertSprinklerBlockAtPoint(tr, p.Head, pos, blockRotation, radius,
    aimRadians: rotationRadians, arcDegrees: p.AngleDegrees);
    // arcOrigin: basePos  ← MISSING
```

Inside `InsertSprinklerBlockAtPoint`, when both aim and arc are caller-provided
(the `callerProvidedArc` fast path, line ~1282), it stamps `Angle` and `rotation`
directly and **skips `OrientHeadFromBoundary`**. Since `arcOrigin` is null (not
passed), lines 1266–1270 — which set `ArcAnchorDx`/`ArcAnchorDy` — are never
reached. The head's arc anchor stays at (0, 0), so the coverage arc emanates from
`pos` (the offset symbol position), not from `basePos` (the boundary point).

The `arcOrigin` parameter exists specifically for this purpose (comment at line
~1261: "the layout point ON the polyline while the symbol sits offset beside it")
— but only strip heads currently use it.

### Why Tweak Coverage "fixes" it

`TweakOneHead` calls `AnchorHeadToBoundary(spk)` (line 126 of
`Commands.TweakCoverage.cs`) before the jig starts. That method finds the closest
closed boundary containing the head, calls `ArcInference.ResolveAnchor` to find
the closest point on that boundary, and sets `spk.ArcAnchorDx`/`ArcAnchorDy` to
the offset from the symbol to that boundary point (lines 3085–3086). This is the
"snap to the insertion point on the boundary" Tim observed.

### Fix (not yet applied)

Pass `arcOrigin: basePos` in the `InsertSprinklerBlockAtPoint` call at line ~2058.
This sets `ArcAnchorDx`/`ArcAnchorDy` on the inserted head so the coverage arc
emanates from the boundary point from the start — no Tweak needed.

```csharp
Sprinkler inserted = InsertSprinklerBlockAtPoint(tr, p.Head, pos, blockRotation, radius,
    aimRadians: rotationRadians, arcDegrees: p.AngleDegrees,
    arcOrigin: basePos);
```

**Caveat to verify:** `basePos` is in drawing units (already multiplied by
`drawingUnitFactor`). The `arcOrigin` parameter is consumed as
`arcOrigin.Value.X - insPoint.X` (line 1268), where `insPoint` is `pos` (also
drawing units). So the delta is correct — both are in drawing units. The delta
equals the install-offset vector, pointing from the symbol back to the boundary.

**Interaction with `callerProvidedArc` path:** The `arcOrigin` block (lines
1266–1270) runs BEFORE the `callerProvidedArc` check (line 1280), so it sets
`ArcAnchorDx`/`ArcAnchorDy` regardless of which arc path fires. This is correct
— the anchor is a position, independent of the arc angle.

### Tim's broader architectural direction (2026-08-02, branch `refactor/boundary-layout-placement`)

The `arcOrigin: basePos` fix above is the minimal patch, but Tim wants a
broader refactor of the insertion model. The current model computes at the
boundary, then offsets symbol+arc together, then tries to fix the anchor
after the fact. Tim's model flips the order:

1. **Insert the head at the boundary point** (where the engine places it) —
   arc is naturally anchored there (anchor = 0,0, no offset needed).
2. **Run the full layout** with all coverage arcs on the polyline — the math
   is done at the actual install point.
3. **Post-pass: offset the symbol only** — move the block reference inward by
   half the plot size, set `ArcAnchorDx/Dy` to compensate. The coverage arc
   stays on the boundary.

This is the inverse of the current approach: instead of "offset then try to
anchor back," it's "anchor first then offset the symbol." The end state is
the same (`ArcAnchor = basePos - offsetPos`), but the coverage geometry is
committed at the real install point before the symbol offset ever touches
it — the offset/flip/shrink containment dance can never corrupt the arc
origin because the arc is already placed and the offset only moves the block.

**This is already the strip-head model** (lines 1266–1270 of
`SprinklerFactory.cs`): strips pass `arcOrigin = linePt` (the on-polyline
layout point) and the symbol sits offset beside it. Round heads would get
the same treatment.

**The standalone boundary-layout repo (`C:\Users\tim\boundary-layout`) is
already CAD-free** and already places heads on the boundary line — no symbol
offset exists in that repo. The plan is:

1. Iterate on the algorithm in the standalone repo (fast, visualizer, no CAD).
2. Port `BoundaryLayout.Core` (netstandard2.0) into Raindrop — it drops in
   directly, no porting step. Replace the current `BoundaryPerimeterLayoutEngine`
   / `BoundaryMeanderWalker` copies in `src/raindrop/Irrigation/BoundaryLayout/`.
3. Implement the new insert-at-boundary-then-offset-symbol model in
   `LayoutHeadsOnBoundaries` on the CAD side.

**Integration note:** The standalone repo's `SprinklerHead` class vs
Raindrop's `SprinklerDefinition` / `SprinklerPlacement` have similar but not
identical shapes. The port will need a thin mapping layer at the Raindrop
boundary, or align the types. That's the only real integration work.

### Key code locations

| Component | File | Line |
|---|---|---|
| `basePos` computed (boundary point, drawing units) | `SprinklerFactory.cs` | ~2005 |
| `pos` offset from `basePos` (symbol insert point) | `SprinklerFactory.cs` | ~2006 |
| `InsertSprinklerBlockAtPoint` call (missing `arcOrigin`) | `SprinklerFactory.cs` | ~2058 |
| `arcOrigin` → `ArcAnchorDx`/`Dy` | `SprinklerFactory.cs` | 1266–1270 |
| `callerProvidedArc` fast path (skips `OrientHeadFromBoundary`) | `SprinklerFactory.cs` | 1280–1286 |
| `AnchorHeadToBoundary` (Tweak Coverage's fix-up) | `SprinklerFactory.cs` | 3046–3088 |
| `TweakOneHead` calls `AnchorHeadToBoundary` | `Commands.TweakCoverage.cs` | 126 |
| Containment flip/shrink on `pos` (would become symbol-only) | `SprinklerFactory.cs` | 2018–2044 |

## Related Issues

- #694 — coverage arc rotation wrong when picked polyline isn't on a boundary
  layer (this fix — both pass-through and adjustable-arc matcher)
- #588 — strip boundary orientation (Phase 2 pending)
- #587 — persist uniformity metrics on boundary polyline
- #601 — boundary perimeter layout engine redesign
- #609 — layout pre-flight insertable-block check
