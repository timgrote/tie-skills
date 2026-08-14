# Boundary polyline eFilerError corruption (investigated 2026-08-13)

> Five polylines corrupted with `eFilerError` after Enki ran `layout-boundary-commit` on them.
> RECOVER discarded all five, leaving ghost ObjectIds that crashed the drawing on reopen.
> Root cause NOT confirmed — investigation ongoing.

## The RECOVER output

```
Valid objects 2163   Invalid objects 0
Validating objects completed.
    Salvaged database from drawing.
Reading handle 10A4 object type AcDbPolyline
           Error 53 (eFilerError)                       Object discarded
Reading handle 10B6 object type AcDbPolyline
           Error 53 (eFilerError)                       Object discarded
Reading handle 10B7 object type AcDbPolyline
           Error 53 (eFilerError)                       Object discarded
Reading handle 10CE object type AcDbPolyline
           Error 53 (eFilerError)                       Object discarded
Reading handle 10CF object type AcDbPolyline
           Error 53 (eFilerError)                       Object discarded
```

Five `AcDbPolyline` objects — all corrupted at the **geometry data** level (binary serialization),
not at the XData level. RECOVER discarded them, which **purged** them from the database. Their
ObjectIds remained in the block table record's iteration list, causing `ePermanentlyErased` on
every subsequent model-space scan.

## The crash chain on reopen

1. Drawing opens → `DocumentBecameCurrent` fires
2. `InitializeIrrigationDrawing` → `IsIrrigationDrawing(doc)` → `GetFromModelSpace(db, AID_OBJECT)`
3. Model-space iteration hits a purged ObjectId → `GetObject` throws `ePermanentlyErased`
4. Crash — palettes don't load, bridge endpoints all fail with `{"error":"ePermanentlyErased"}`
5. `/ping` still works (doesn't touch model space) — diagnostic signal

## Timeline: when did the write path appear?

The `RD_SPRINKLER_BOUNDARY` tagging code was introduced in commit `4b88934e` (July 30, 2026, PR #700).
Before that, `LayoutHeadsOnBoundaries` **never wrote to boundary polylines** — it only read them
for geometry computation. The tagging path does:

```csharp
pl.UpgradeOpen();
XData.WriteXData(id,
    new TypedValueList(new TypedValue(XData.CODE_APPNAME, AID_AppName.SPRINKLER_BOUNDARY)),
    tr);
```

The PR review (`2039446c`) added a try/catch around this. The XData written is valid: two appname
codes (`RD_SPRINKLER_BOUNDARY` + `AID_OBJECT` + int 42 — the latter appended by `WriteXData`
itself at line 327).

## Why the XData write path is probably NOT the cause

The same `WriteXData(objID, xData, tr)` path is used by every sprinkler, pipe, valve, and controller
insert in every Raindrop drawing. If the write path itself corrupted entities, every drawing would
break, not 5 out of 6 boundaries on one drawing. The `eFilerError` is on the polyline's **geometry
data** (vertices, bulges), not its XData section — XData is stored separately in the DWG file.

## What's NOT confirmed

- **Dropbox theory (rejected by Tim):** The drawing lives in `D:\Dropbox\Raindrop Dev Work\`.
  A Dropbox sync conflict during save could corrupt the file. But Tim correctly pointed out:
  "we would be seeing that all the time" — every Raindrop drawing uses the same write path.
  Only invoke Dropbox after ruling out all code paths AND reproducing on a non-Dropbox drawing.
- **Transaction lifecycle:** The tagging runs in a "read pass" transaction (lines 1920-1954)
  that does `UpgradeOpen()` + `WriteXData(id, ..., tr)` + `Commit()`. Then a separate "commit
  pass" transaction (lines 1966-2068) inserts sprinkler blocks. Both transactions are properly
  committed. No nested transactions, no abort paths.
- **The `WriteXData` re-open pattern:** `WriteXData(id, xData, tr)` calls
  `tr.GetObject(objID, OpenMode.ForWrite, true)` — re-opening an already-open object on the
  same transaction. This should return the same managed wrapper (fine), but the `openErased: true`
  flag is unnecessary here and could mask issues.

## What needs investigation

1. **Reproduce on a clean (non-Dropbox) drawing:** Create boundaries, run `layout-boundary-commit`
   via the bridge, save, reopen. If it corrupts → code bug. If not → external cause.
2. **Check if Enki used other endpoints:** Did Enki call `/erase`, `/set`, `/transform`, or
   `/xdata` on those polylines? Any of those could modify the entity.
3. **Check the drawing's Serilog buffer** for what commands fired around the time of the save.
4. **Check if the polylines were created by Enki** (e.g. via a draw command) vs pre-existing.
   If Enki created them programmatically, the creation path might be the issue.

## The `ePermanentlyErased` crash (separate pre-existing bug)

Regardless of the corruption's root cause, the `ePermanentlyErased` crash in
`EditorSelection.GetFromModelSpace` is a **pre-existing bug** — `openErased: true` handles
soft-erased entities but not purged ones. Every model-space iteration in the codebase needs a
try/catch guard around `GetObject`. See the SKILL.md pitfall "ePermanentlyErased — purged
entities crash model-space iteration" for the fix pattern and scope.

## Key lesson for future investigations

When Tim asks "when was this code last touched?" use `git log --follow` on the specific file
and method. The #694 commit (July 30) added the first-ever write to polylines — that's the
correlation, even though the causation isn't proven. Checking `git log --oneline --follow -20`
on `SprinklerFactory.cs`, `EditorSelection.cs`, and `XData.cs` gave the timeline immediately.
