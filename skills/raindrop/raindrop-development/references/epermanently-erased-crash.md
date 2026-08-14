# ePermanentlyErased crash on drawing open (investigated 2026-08-13)

## The crash

Opening a drawing that had boundary-layout work done via the bridge crashes immediately:

```
Autodesk.AutoCAD.Runtime.Exception: ePermanentlyErased
   at TransactionManager.GetObjectInternal(...)
   at Transaction.GetObject(ObjectId id, OpenMode mode, Boolean openErased)
   at EditorSelection.GetFromModelSpace(Database db, String appName, ...) line 66
   at RaindropPalettes.IsIrrigationDrawing(Document doc) line 1089
   at RaindropPalettes.InitializeIrrigationDrawing() line 885
```

Every bridge endpoint that touches model space also crashes (`/summary`, `/layers`,
`/find`, etc.) — only `/ping` works because it doesn't iterate entities.

## Root cause

`EditorSelection.GetFromModelSpace` (line 66) calls
`tr.GetObject(id, OpenMode.ForRead, openErased: true)`. The `openErased: true` flag
handles entities flagged as erased (via `Erase()`) but NOT **permanently erased**
(purged) entities. A purged entity's ObjectId still appears in the block table
record's iteration, but the underlying object is gone — `GetObject` throws
`ePermanentlyErased` regardless of the `openErased` flag.

This is a **pre-existing bug**, not caused by the bridge changes. Any drawing that
has been saved after entities were purged (via `PURGE`, RECOVER, or AutoCAD's
save-time cleanup) and reopened would crash.

## What corrupted the polylines

RECOVER output showed 5 polylines with `eFilerError` / "Object discarded":

```
Reading handle 10A4 object type AcDbPolyline — Error 53 (eFilerError) — Object discarded
Reading handle 10B6 object type AcDbPolyline — Error 53 (eFilerError) — Object discarded
Reading handle 10B7 object type AcDbPolyline — Error 53 (eFilerError) — Object discarded
Reading handle 10CE object type AcDbPolyline — Error 53 (eFilerError) — Object discarded
Reading handle 10CF object type AcDbPolyline — Error 53 (eFilerError) — Object discarded
```

`eFilerError` is **file-level corruption** — the polyline's binary serialization in
the DWG file is damaged, not just bad XData. Likely causes:

1. **Dropbox sync conflict** — the drawing was in `D:\Dropbox\Raindrop Dev Work\`.
   If AutoCAD saved while Dropbox was syncing, the file could get truncated.
2. **Transaction abort during XData write** — `LayoutHeadsOnBoundaries` does
   `pl.UpgradeOpen()` then `XData.WriteXData(id, ..., tr)` inside a transaction.
   If the transaction was aborted mid-write (e.g. by a crash or lock violation),
   partial XData could corrupt the entity's on-disk representation.
3. **`WriteXData` always appends `AID_OBJECT` + int 42** to every XData write,
   even when the caller only wants `RD_SPRINKLER_BOUNDARY`. This means tagging
   a boundary polyline also stamps it as an irrigation object —
   `IsIrrigationDrawing()` then counts it. Not corruption per se, but a logic
   issue that makes non-irrigation polylines look like irrigation objects.

The exact trigger is unresolved — the drawing was already corrupted when reopened.
The transaction structure in `LayoutHeadsOnBoundaries` (two sequential committed
transactions within one document lock) looks correct.

## The fix (not yet applied — user said to investigate first)

Wrap `GetObject` in a try/catch in every model-space iteration:

```csharp
Entity ent;
try
{
    ent = tr.GetObject(id, OpenMode.ForRead, true) as Entity;
}
catch { continue; } // ePermanentlyErased — purged entity still in iteration
if (ent == null || ent.IsErased) continue;
```

Affected code paths (all do `tr.GetObject(id, OpenMode.ForRead)` without try/catch):
- `EditorSelection.GetFromModelSpace` (CAD Utility/EditorSelection.cs:66) — the crash site
- `GetByLayer` (DebugBridgeService.Tier2.cs:455)
- `GetAllModelSpaceIds` (DebugBridgeService.Tier2.cs:474)
- `BuildLayers` (DebugBridgeService.cs:640) — the model-space entity-count scan
- `ResolveToHandles` (DebugBridgeService.Tier2.cs:498)
- `ProjectEntities` (DebugBridgeService.Tier2.cs:510)

**Important:** the user's preference is to investigate root cause FIRST before
patching. Don't mass-patch all related code paths before confirming the cause.
See the "User correction" section below.

## User correction: investigate before patching

When a crash occurs, the user wants investigation ONLY — not immediate code
changes. Specifically:

1. Trace the crash stack to the exact line
2. Identify what operation could have caused the corruption
3. Check related code paths for the same vulnerability
4. Report findings
5. WAIT for the user to say they want a fix

Do NOT start patching every related code path in the same turn as the
investigation. The user said: "I don't know that you need to be changing all
this shit. I feel like why are we calling all these in the first place? And
what caused the problem? Do we know that?"

This is already in the user profile ("wants investigation only — not code
changes. Says when he wants a fix") but the agent still jumped to patching.
The lesson: when the user says "investigate" or "see if you can figure out
what happened", that does NOT mean "fix it and all related code too".
