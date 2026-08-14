# PR Review Findings — Issue #694 (First pr-review-toolkit Run)

> Captured from the first production run of the `pr-review-toolkit` skill against
> the `fix/694-boundary-orientation-link` branch. 6 agents, 2 batches of 3,
> ~3 min total. **All findings have been fixed** (commit 2039446c).

## Critical Findings (2) — from silent-failure-hunter — FIXED

### 1. Unprotected XData write in LayoutHeadsOnBoundaries read pass — FIXED

**Location:** `SprinklerFactory.cs:~1916-1939`

The tag block (`HasAppName` → `UpgradeOpen` → `WriteXData`) ran inside the
`foreach (ObjectId id in boundaryIds)` loop with no per-polyline try/catch. If
one polyline was on a locked layer or erased, the exception propagated,
`tr.Dispose()` aborted the uncommitted transaction, and the **entire**
`LayoutHeadsOnBoundaries` call failed — before `LayoutMany` was even reached.

**Fix applied:** Wrapped the per-polyline tag in try/catch with a
`Debug.WriteLine` naming the boundary handle. A single un-writable polyline is
skipped rather than poisoning the whole transaction.

### 2. arcDegrees pass-through branch had no error guard — FIXED

**Location:** `SprinklerFactory.cs:~1268-1283`

`WriteXData()` → `WriteArcAnchor` → `ADJUSTED_RADIUS` write happened in sequence
with no try/catch. If the second write threw, the sprinkler had `Angle` stamped
but no `AdjustedRadius`, and the normal `ApplyNozzleArc` path was skipped.

**Fix applied:** Extracted `PersistArcState` helper (shared by both the
direct-stamp path and `ApplyNozzleArc`), added `arcDegrees` range validation
(NaN, ≤0, >360 → fall back to `ApplyNozzleArc` with debug log). The persist
logic is no longer duplicated — both paths call `PersistArcState`.

## Warnings (4) — ALL FIXED

1. **BuildBoundaryData HasAppName could zero the snapshot** — FIXED: wrapped
   in try/catch, treats throw as `isTagged = false`.
2. **No arcDegrees range validation** — FIXED: `callerProvidedArc` boolean
   validates NaN/range, falls back to `ApplyNozzleArc` on bad input.
3. **Self-contradictory class XML doc** (SprinklerArcMatcher.cs:13-14) — FIXED:
   rewrote to acknowledge adjustable-arc nozzles.
4. **XML doc misattributes stamper** (SprinklerFactory.cs:1198-1199) — FIXED:
   now says "this method stamps them directly and skips ApplyNozzleArc".

## Suggestions (6) — ADDRESSED

1. **H-suffix 180° test** — ADDED: `Match_HSuffixIsFixed180_NotAdjustable_DoesNotPassThrough`
2. **Mixed adjustable+fixed series test** — ADDED: `Match_MixedAdjustableAndFixedArc_PicksClosestThenPassesThroughIfAdjustable`
3. **Redundant condition clause** — FIXED: collapsed to 3-part condition with `Debug.Assert` for the implied invariant.
4. **Extract PersistArcState helper** — DONE: shared by both paths, prevents drift.
5. **Pair arcDegrees + aimRadians into a record struct** — Not done (design debt, not a blocker for this PR).
6. **UpgradeOpen on locked layer** — FIXED via the try/catch in #1.

## The PersistArcState Pattern

The most valuable structural fix from the review. Both the `arcDegrees`
pass-through path and `ApplyNozzleArc` now call a shared `PersistArcState`
helper:

```csharp
private static void PersistArcState(Sprinkler sprinkler, double arcRadius)
{
    if (sprinkler == null) return;
    sprinkler.CalculateArea();
    sprinkler.WriteXData();
    WriteArcAnchor(sprinkler);
    if (arcRadius > 0 && !sprinkler.IsStrip)
    {
        sprinkler.AdjustedRadius = arcRadius;
        XData.WriteXData(sprinkler.ObjID,
            new TypedValueList(
                new TypedValue(XData.CODE_APPNAME, AID_AppName.ADJUSTED_RADIUS),
                new TypedValue(XData.CODE_REAL, arcRadius)));
    }
}
```

This prevents the scattered-persist pattern that caused issue #584 — if someone
adds a new XData field to the persist tail, they only update one place.

## What Worked Well (from all 6 agents)

- Well-documented: design doc, inline comments cross-reference #694
- Idempotent XData tagging with HasAppName guard
- BuildBoundaryData inclusion is additive — no regression for existing callers
- Non-IR_LayoutOnBoundary callers unaffected (arcDegrees defaults to null)
- Adjustable-arc detection correctly excludes full-circle and fixed-suffix
- Tests updated to match new behavior
- DefaultPartArcDegrees constant extraction is clean
- No security concerns

## Agent Performance Notes

| Agent | Findings | Most valuable contribution |
|-------|----------|---------------------------|
| code-reviewer | 0 critical, 0 warning, 2 suggestion | Style/pattern verification, edge-case test suggestion |
| silent-failure-hunter | 2 critical, 3 warning, 3 suggestion | **Highest signal** — found the transaction-abort risks |
| pr-test-analyzer | 1 critical, 3 warning, 2 suggestion | H-suffix gap, mixed-series gap, range validation |
| type-design-analyzer | 0 critical, 1 warning, 3 suggestion | arcDegrees pairing design debt |
| comment-analyzer | 0 critical, 2 warning, 2 suggestion | Self-contradictory doc, misattributed stamper |
| code-simplifier | 0 critical, 1 warning, 2 suggestion | PersistArcState extraction, redundant condition |
