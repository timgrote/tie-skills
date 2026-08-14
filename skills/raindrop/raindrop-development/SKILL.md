---
name: raindrop-development
description: "Build, test, and develop the Raindrop irrigation CAD plugin."
triggers:
  - Working on the Raindrop repo (timgrote/Raindrop)
  - C# changes to src/raindrop/, src/RaindropTests/
  - Issues from the Raindrop GitHub repo
---

# Raindrop Development

Raindrop is an AutoCAD/BricsCAD plugin for irrigation design, written in C# (.NET). The main project is at `~/Raindrop/`.

## Project Structure

- `src/raindrop/` — core CAD plugin (AutoCAD/BricsCAD)
- `src/RaindropTests/` — NUnit tests
- `src/Logging/` — logging library
- `src/Raindrop.Installer/` — Advanced Installer
- `docs/` — documentation
- **No `.sln` file** — use `.csproj` files directly (open `src/raindrop/Raindrop.csproj` in VS)

## Build & Test

```bash
# Restore
dotnet restore

# Build (pick config — see "Build Configurations" below)
dotnet build src/raindrop/Raindrop.csproj -c AutoCAD25_Debug

# Tests — the test project has a pre-existing "Invalid framework identifier" error
# when built standalone; build via the solution instead. Some test files require
# AutoCAD assembly references (Autodesk.* namespaces) that aren't available outside
# a CAD-targeted build, so not all tests compile/run in a plain dotnet test pass.
# The CAD-free tests (BoundaryPerimeterLayoutEngineTests, EdgeArcInferenceTests, etc.)
# are the ones that matter for geometry-engine changes.
dotnet test src/raindrop/Raindrop.sln
```

## Build Configurations & Deploy (Critical)

The build output goes to `src/bin/<Config>/`, but **AutoCAD loads from the bundle directory**:
`~/AppData/Roaming/Autodesk/ApplicationPlugins/Raindrop.bundle/Contents/`

**The DLL name differs by configuration:**

| Config | Output DLL | Bundle Target |
|--------|-----------|---------------|
| `AutoCAD_Debug` | `Raindrop_AutoCAD.dll` | `Contents/2024/` |
| `AutoCAD25_Debug` | `Raindrop_AutoCAD25.dll` | `Contents/2025/` |
| `BricsCAD_Debug` | `Raindrop_BricsCAD.dll` | `Contents/V24/` |

**The post-build XCOPY step sometimes fails silently.** After building, you MUST verify the bundle DLL timestamp matches your build. If it doesn't:

```bash
# Deploy manually using the project's copy script:
bash scripts/copy-binaries.sh AutoCAD25_Debug

# Or copy directly:
cp src/bin/AutoCAD25_Debug/Raindrop_AutoCAD25.dll \
   ~/AppData/Roaming/Autodesk/ApplicationPlugins/Raindrop.bundle/Contents/2025/
```

**AutoCAD locks the DLL while running.** You must close AutoCAD before copying, or the copy fails with "Device or resource busy."

**Pitfall:** Building with `AutoCAD_Debug` when you mean `AutoCAD25_Debug` produces a different DLL name (`Raindrop_AutoCAD.dll` vs `Raindrop_AutoCAD25.dll`). AutoCAD loads `Raindrop_AutoCAD25.dll` from the bundle, so the `AutoCAD_Debug` build never gets loaded. This causes "my code changes don't seem to have any effect."

### Debug Logging

`Debug.WriteLine` output goes to:
1. **VS Output window** (when debugging)
2. **`~/Documents/Raindrop/Logs/`** — rotating log file, enabled by `EnableDebugFileLogging` in config
3. **Debug Bridge** — see "Debug Bridge" section below

**⚠ CRITICAL PITFALL — `debug.log` is empty for Release builds.** `Debug.WriteLine` is decorated with `[Conditional("DEBUG")]` — the C# compiler **strips every call site** in Release builds (where `DefineConstants=TRACE` only, no `DEBUG`). The `AsyncDebugFileLogger` trace listener IS attached (the file is created with a 3-line header), but no `Debug.WriteLine` output ever reaches it because the calls don't exist in the compiled IL. This means:

- Customer debug.log files from Release builds contain **only the header** (machine name, user, timestamp) — zero log content, even when `EnableDebugFileLogging` is `true` and the file is being written.
- The crash handler at `AID_Application.cs:912` uses `System.Diagnostics.Debug.WriteLine(...)` to write the exception — **also stripped in Release**. So crash stack traces don't reach debug.log.
- Crash details ONLY survive via `CrashLogPersister` → `crashlog.json` → Loki's `ForwardPendingCrashLog` (which uses Serilog directly, not `Debug.WriteLine`).
- **When Tim sends a customer's debug.log and it's empty, this is why.** Don't waste time investigating why the file is blank — check `BuildConfiguration` in Loki for that user. If it says `RELEASE`, the file will be empty by design.
- **Fix (not yet implemented):** Switch crash-relevant logging from `Debug.WriteLine` to `Trace.WriteLine` — `TRACE` is defined in both Debug and Release, so `Trace.WriteLine` survives compilation. The `AsyncDebugFileLogger` is a `TraceListener` so it already captures `Trace.WriteLine`.

**Serilog buffer logs (third log source):** `%AppData\Roaming\Raindrop\logs\raindropautocad25-buffer-YYYYMMDD.json` — one JSON object per line (not a JSON array). Captures high-level events only (load/unload, commands, save-settings, license checks, Error-level exceptions via `CaptureErrorQuietly`). Does NOT capture AutoCAD-native warnings like the save-RECOVER dialog. Useful for seeing what Raindrop was doing *around* the time of an issue. Fields include `BuildConfiguration`, `AppVersion`, `MachineName`, `EnvironmentUserName`.

### Debug Bridge (live drawing introspection)

The in-process HTTP debug bridge (`localhost:5599`) is the primary tool for troubleshooting a **live** drawing — inspecting XData, entity counts, layer assignments, and running inventory/analysis without touching code. It's DEBUG-build only (AutoCAD), toggled in AutoCAD with the `RD_DEBUGBRIDGE` command.

**Drive it with `.claude/actions/cad-bridge.sh`** (full usage in `references/debug-bridge.md`). Key subcommands:

```bash
bash .claude/actions/cad-bridge.sh ping                    # plugin version, drawing, units
bash .claude/actions/cad-bridge.sh summary                 # counts of zones/sprinklers/pipes
bash .claude/actions/cad-bridge.sh entities <appName>      # entities carrying that XData app name
bash .claude/actions/cad-bridge.sh xdata --handle <h>       # full XData on one entity
bash .claude/actions/cad-bridge.sh xdata --app <appName>    # XData of every entity with that app
bash .claude/actions/cad-bridge.sh inventory               # typed counts (whole drawing)
bash .claude/actions/cad-bridge.sh find --selected          # resolve current selection to handles
```

**Boundary layout preview** — diagnose arc/angle issues without inserting heads:

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" \
  -d '{"name":"layout-boundary-preview","handles":["<boundary-handle>"]}'
```

Returns every placement's `angle`, `rotation`, `arcFitDelta`, `adjustedRadius`, and `boundaryIndex`. When `angle=180` for every head but `arcFitDelta > 0` for some, the `SprinklerArcMatcher` couldn't find a fixed-arc nozzle matching the ideal angle — see `references/boundary-orientation.md` for the adjustable-arc pass-through fix.

**Boundary geometry + medial axis** — `boundary-vertices` op now returns `area` and `medialAxis` (skeleton points + min/max/avg width along the spine). The medial axis is computed via `Boundary.ComputeMedialAxis()` in `Geometry/Boundary.cs` — grid-based distance-field ridge detection (non-maximum suppression). Width at each ridge point = 2× inscribed radius. The width stats tell Enki whether a boundary is narrow enough for a single perimeter pass or needs interior heads. See `references/boundary-layout-bridge-insertion.md` § 4 for the full response shape.

**Bulk sprinkler insert (harness→CAD final step)** — `insert-sprinklers` fires N placements in one transaction with direct arc stamping (`arcDegrees` + `aimRadians` together skip `OrientHeadFromBoundary`, same path as `layout-boundary-commit`). Closes the `/insert-sprinkler` gap (which still doesn't expose `arcDegrees`/`aimRadians`). See `references/boundary-layout-bridge-insertion.md` § "Bulk insert with direct arc stamping" for the full field reference and the partial-failure semantics.

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" -d '{
  "name": "insert-sprinklers",
  "placements": [{ "sprinkler": "...", "point": [x,y,0], "radius": r,
    "arcDegrees": 180.0, "aimRadians": 0.785 }, ...] }'
```

**Layer discovery** — `GET /layers` lists every layer in the drawing with entity count and visibility state. Optional `?search=` (case-insensitive substring) or `?prefix=` filters. This is the fuzzy-name resolution step when Enki needs to map "the sprinkler boundary layer" to its actual name (`3284-Boundary Sprinkler`) before calling `/find` with `{layer}`.

```bash
curl -s "http://localhost:5599/layers?search=boundary"
```

**Series discovery** — `sprinkler-series` lists all non-strip sprinkler series (Manufacturer_Model_Pressure) from the active unit catalog with per-series nozzle/radius/flow detail. Optional `manufacturer` filter. This is the discovery step before `layout-boundary-preview`/`-commit` — Enki picks a series key here, runs `sprinkler-block-check` to verify artwork, then passes the series to layout.

```bash
curl -s http://localhost:5599/op -X POST -H "Content-Type: application/json" -d '{"name":"sprinkler-series","manufacturer":"RainBird"}'
```

**Closed-polyline filtering on /find** — `closedPolylines:true` post-filters any producer's results to closed Polyline entities only. Composes with `layer`, `selected`, `handles`, `insidePolyline` — anything that produces ids. The boundary-layout workflow uses this to grab all closed polylines on a layer in one call, then `saveAs` to hold them as a named set for `layout-boundary-preview`/`-commit`.

```bash
curl -s http://localhost:5599/find -X POST -H "Content-Type: application/json" -d '{"layer":"Perimeter Sprays","closedPolylines":true,"saveAs":"my-boundaries"}'
```

**Multi-boundary layout workflow (Enki-driven, end-to-end):** The bridge already supports laying out multiple boundaries in one call — `layout-boundary-preview`/`-commit` accept a `handles` array and loop through `LayoutHeadsOnBoundaries`. The full workflow is:
1. `GET /layers?search=boundary` → resolve fuzzy layer name to actual name (e.g. `3284-Boundary Sprinkler`)
2. `sprinkler-series` (optional `manufacturer` filter) → pick a series key
3. `sprinkler-block-check` with that series → verify insertable blocks
4. `/find` with `layer` + `closedPolylines:true` + `saveAs` → named set of boundary handles
5. `layout-boundary-preview` with those handles + series → preview placements
6. `layout-boundary-commit` with same → stamp heads into CAD

The `saveAs` named set is session-scoped and survives across calls, so Enki doesn't need to manage handle lists. But `layout-boundary-preview`/`-commit` take `handles` directly, not a `set` producer — adding `set` support to those ops is the next gap.

When Tim is troubleshooting a drawing, **hit the bridge first** to inspect real drawing state before reading code. Pair bridge evidence (XData on actual entities) with code reading to isolate data issues vs code issues.

## Branch & Commit Workflow

- The integration branch is **`DEV`** (uppercase), not `dev` or `main`. Fetch and pull it before branching:
  ```bash
  git fetch origin && git checkout DEV && git pull origin DEV
  ```
- Branch naming: `fix/<issue#>-<short-description>` for bug fixes (e.g. `fix/694-boundary-orientation-link`), `feat/<issue#>-<desc>` for features. Always include the issue number.
- Link issues in commits: `fix(#694): description` (or just `(#694)` in the subject)
- Commit frequently; don't need to push unless asked
- Return to `DEV` between issues
- **Organize commits by logical category** for large multi-file changes. Tim explicitly asked for this on the #654 dead-code removal (36 files, 5K lines): split into separate commits by category (Property Wrappers removal, dead commands removal, other dead code removal, csproj cleanup) rather than one giant commit. This makes review and bisecting easier.

## Coding Style

- **Tabs** (not spaces) in C# and markdown lists
- PascalCase for types/methods/properties/constants; camelCase for locals/params; `_camelCase` for private fields
- Nullable enabled; keep usings consistent
- Conditional compilation: `#if BRX_APP` (BricsCAD) / `#elif ACAD_APP` (AutoCAD) — both targets must compile

## Pitfalls

### V2 palette views are NOT dead (filename-scan trap)

A filename scan for `*V2` / `*old` turns up 9 `*ViewV2` files under `Presentation/` (Clock, CommonToolBar, Drip, Misc, Pipes, Plant, Sprinklers, Valves). These are **live** — both the V2 and the non-V2 views are instantiated in `AID_Palettes.cs` on two separate palette sets (`ToolPaletteSet` vs `ToolPaletteSetV2`), with `Active*ViewModel` properties falling back from V2→non-V2. Do not flag `*V2` views as dead by filename alone; verify instantiation in `AID_Palettes.cs`.

### search_files vs terminal grep on Windows paths (tool pitfall)

The `search_files` tool (ripgrep-backed) fails on Windows paths with spaces or when the MSYS path conversion mangles `C:\Users\...` into a non-existent `/c/Users/...`. Error looks like: `rg: /c/Users/tim/...: The system cannot find the path specified (os error 3)`. This happens reliably for paths containing spaces (e.g. `Property Wrappers/`) and sometimes for plain `src/raindrop`.

**Fix:** Fall back to `terminal` with `grep -rn --include="*.cs" "<pattern>" .` after `cd`-ing into the target directory. The terminal tool runs MSYS bash where `grep` resolves relative paths correctly. For batch searches over many class names, loop in one terminal call:
```bash
cd "C:/Users/tim/Raindrop/src/raindrop" && for n in ClassA ClassB; do echo "===== $n ====="; grep -rn --include="*.cs" "$n" . | grep -v "<dir-to-exclude>/"; done
```
Exclude `obj/` and `.vs/` from results — they contain build artifacts and VS index files that match but are noise.

### Patch Tool with Deeply-Indented C# (Critical)

The `patch` tool's fuzzy matching struggles with C# files that have 6+ levels of tab indentation. Incremental patches frequently **corrupt brace structure** — the file compiles (C# matches braces by count, not indentation) but has wrong logic (e.g., `else` binds to wrong `if`, code trapped inside wrong scope).

**Symptoms:** Code compiles but doesn't execute at runtime. Logic appears correct when reading but `else`/`if` pairing is wrong.

**Fix:** When a C# patch goes wrong, **stop patching and reset**:
```bash
git checkout dev -- path/to/file.cs
```
Then redo the edit as a **single clean patch** with enough context. Verify brace structure afterward with `awk 'NR>=START && NR<=END' file | cat -An` to see actual tab characters (`^I`).

**Rule:** Never do more than 2 incremental patches on the same block of deeply-indented C#. If the second patch doesn't nail it, reset and redo.

### Patch Tool Tab Corruption (different from brace corruption)

The `patch` tool has a second failure mode distinct from brace/logic corruption: it persistently **adds or removes tabs on adjacent lines** (the closing `}` or the next method declaration), even when the matched region is structurally correct. Each "fix" patch introduces a new tab error on a different adjacent line — you chase the indentation around the file without ever converging.

**Symptom:** `git diff` shows the correct content change *plus* spurious whitespace-only changes on neighboring lines (a `}` moving in or out one tab). The file compiles (C# ignores indentation) but violates the tab style guide.

**Fix:** Stop using `patch` for the region. Read the full file with `read_file`, then rewrite it entirely with `write_file` using proper tab indentation (`\t` characters, not spaces). This is the only reliable path when the patch tool starts fighting tabs — re-patching the same region 3+ times never converges.

**Prevention:** For any C# edit that touches a constructor or method boundary (where closing `}` and the next declaration are in play), prefer `write_file` for the whole file from the start. Reserve `patch` for small in-place edits well inside a method body.

**Python-via-terminal tab repair (for huge files where `write_file` is impractical):** When `patch` corrupts tabs in a large C# file and re-patching isn't converging, you can do a precise string replacement via `terminal` with `python - <<'PY'` using explicit `\t` escapes. This lets you target exactly the corrupted region (with its wrong tab count) and replace it with the correct indentation, without rewriting the whole file. Read the corrupted region with `sed -n 'START,ENDp' file | cat -A` first to see the actual `^I` tab characters, then construct the `old`/`new` strings with matching `\t` counts. This converges in one shot where `patch` chases tabs forever. Only use `write_file` (whole-file rewrite) when the file is small enough to re-read entirely.

### AutoCAD Transaction Lifecycle

**`DBDictionary.Remove()` ≠ `Erase()` — orphans vs deletes (Critical).** `DBDictionary.Remove(key)` unparents the object but leaves it in the database with valid ObjectIds. It becomes an orphan — still holding its children, still openable. If any later code `SetAt`s one of its children into a new dictionary, that child now has two owners → "*Warning* Multiply owned object" on save, which AUDIT/RECOVER cannot fix. Always `Erase()` the old dictionary AND its children before `Remove()`. See `references/save-corruption-investigation.md` § 0 for the confirmed instance (`ClearNamedDictionary` orphaning NOD sub-dictionaries on every drawing switch).

AutoCAD .NET transactions must be fully **disposed** (not just committed) before code that opens its own transactions runs. Calling such code inside a `using (Transaction tr = ...)` block — even after `tr.Commit()` — causes nested transaction issues.

**Pattern:**
```csharp
// WRONG — TweakOneHead opens its own transactions
using (Transaction tr = db.TransactionManager.StartTransaction())
{
    // ... insert entity ...
    tr.Commit();
    Commands.TweakOneHead(insertedSpk); // fails — outer tr not disposed
}

// RIGHT — hoist variables, call after using block
Sprinkler insertedSpk;
ObjectId blockId;
using (Transaction tr = db.TransactionManager.StartTransaction())
{
    insertedSpk = InsertSprinklerBlockAtPoint(tr, ...);
    blockId = insertedSpk.ObjID;
    tr.Commit();
}
// Now tr is fully disposed
Commands.TweakOneHead(insertedSpk);
```

When moving code outside a `using` block, hoist the variable declarations above the `using` and assign inside it.

### `ePermanentlyErased` — purged entities crash model-space iteration (Critical)

**Symptom:** `Autodesk.AutoCAD.Runtime.Exception: ePermanentlyErased` at `Transaction.GetObject(ObjectId id, OpenMode mode, Boolean openErased)` — thrown when iterating model-space entities and calling `GetObject` on an ObjectId whose underlying object has been **purged** from the database (not just erased — the object is gone entirely, but the ObjectId still appears in the block table record's iteration list).

**Crash site:** `EditorSelection.GetFromModelSpace` (`EditorSelection.cs:66`) — fires on every drawing open via `IsIrrigationDrawing` → `GetFromModelSpace(db, AID_OBJECT)`. This means **any drawing with purged entities crashes Raindrop on open**, before the bridge or any command can run. The bridge's `/summary`, `/layers`, `/find`, and every model-space-scanning endpoint also crash.

**Cause:** `tr.GetObject(id, OpenMode.ForRead, openErased: true)` was supposed to handle erased entities — and it does for *soft* erased entities (flagged via `Erase()` but still in the database). But `ePermanentlyErased` means the entity was **purged** (by AutoCAD's `PURGE` command, or by a save+reopen cycle where AutoCAD cleans up erased entities). The `openErased` flag cannot help — there's no object to open.

**How drawings get into this state:**
1. Entities are erased (e.g. via `/erase` bridge endpoint, or a layout operation that erases/replaces polylines)
2. The drawing is saved
3. On reopen, AutoCAD purges the erased entities from the database
4. The ObjectIds remain in the block table record's iteration list but the objects are gone
5. `GetObject` throws `ePermanentlyErased`

**Fix pattern — try/catch around every `GetObject` in model-space iteration:**
```csharp
foreach (ObjectId id in ms)
{
    Entity ent;
    try
    {
        ent = tr.GetObject(id, OpenMode.ForRead, true) as Entity;
    }
    catch { continue; } // ePermanentlyErased — purged entity still in iteration
    if (ent == null || ent.IsErased) continue;
    // ... use ent ...
}
```

**Scope:** Every model-space iteration in the codebase needs this guard. Confirmed vulnerable sites: `EditorSelection.GetFromModelSpace` (the root crash site), `DebugBridgeService.GetByLayer`, `DebugBridgeService.GetAllModelSpaceIds`, `DebugBridgeService.BuildLayers`, `DebugBridgeService.ResolveToHandles`, `DebugBridgeService.ProjectEntities`. The pattern is the same in all: wrap `GetObject` in try/catch, skip on exception.

**Status (2026-08-13):** Fix started on `refactor/boundary-layout-placement` branch — `EditorSelection.GetFromModelSpace` patched, `GetByLayer` and `GetAllModelSpaceIds` and `BuildLayers` patched. Remaining: `ResolveToHandles`, `ProjectEntities`, and any other model-space iteration site. The fix is committed but not yet deployed/tested against the live drawing that triggered it.

**Investigation tip:** When every bridge endpoint returns `{"error":"ePermanentlyErased"}` but `/ping` works, the drawing has purged entities. Hit `/ping` first — it doesn't touch model space, so it works even on a corrupted drawing. Then try `/summary` — if it crashes with `ePermanentlyErased`, you know the drawing has purged entities before even reading the crash stack.

### `Active.*` Singleton Drift During Drawing Switch (Critical)

`Active.Database`, `Active.TransactionManager`, and `Active.Document` are **singletons** — they return `MdiActiveDocument.Database` / `.TransactionManager` at call time. During a drawing switch, the active document changes, so any code that captured `Active.*` before the switch now holds a **stale reference** to the old document's database/transaction manager.

**The crash pattern:** `Transaction.CheckTopTransaction()` → `DeleteUnmanagedObject()` → `DisposableWrapper.Dispose()` — a 3-frame stack with **no Raindrop code**. This is a GC/finalizer crash: a Transaction created on Database A is disposed after the active document switched to Database B. Database A's transaction manager is in a deactivated state, so `CheckTopTransaction()` throws.

**How it happens:** `IrrigationDrawingCheck` (fires on `DocumentCreated`) queues `InitializeIrrigationDrawing` via `SendStringToExecute(wrapUpInactiveDoc: false)`. The command runs **asynchronously**. If the user switches drawings before the command finishes, `GetMLeaderStyleID`'s `using (Transaction acTr = Active.TransactionManager.StartTransaction())` starts a transaction on the *old* database. When the `using` block disposes, `Active.TransactionManager` now points to the *new* database — the old transaction's `CheckTopTransaction()` fails.

**Fix pattern — capture Database at entry, use the captured reference:**
```csharp
// WRONG — Active.TransactionManager drifts during async execution
using (Transaction acTr = Active.TransactionManager.StartTransaction())
{ ... }

// RIGHT — capture once, immune to Active.* drift
var db = Active.Database;  // or pass Document through from the caller
using (Transaction acTr = db.TransactionManager.StartTransaction())
{ ... }
```

This is the same principle as the deactivation-handler fix from #527 (pass `e.Document` through, don't read `Active.*`) — extended to the **activation/init** path. The #527 fix hardened deactivation handlers but left `GetMLeaderStyleID`, `EditorSelection.GetFromModelSpace`, and `RefreshPaletteVisibility` still reading `Active.*` at call time.

**NODHelper note (corrected during implementation):** The SKILL.md audit table flagged `NODHelper.AddXrecordToNamedDictionary(Database db, ...)` as using `Active.Database` for the transaction — but on actual inspection (Jul 30, 2026), the method already uses `db.TransactionManager.StartTransaction()` and `db.NamedObjectsDictionaryId` correctly. The `PrintDictToString` method (line 386) still uses `Active.Database` but it's a debug utility not in the crash path. `CloneDictionary` (line 346) uses `Active.Document.LockDocument()` but is also not in the crash path. No NODHelper changes were needed for the fix.

**Fix (implemented Jul 30, 2026, PR #705 `fix/active-singleton-drift-drawing-switch`, MERGED to DEV):** A 6-phase fix that captures `Document`/`Database` at entry and threads it through every downstream call. All changes are additive (new overloads; parameterless overloads delegate with `Active.*`, so existing callers are unaffected). Build passes `AutoCAD25_Debug` with 0 errors. BricsCAD build also passes (initial CI failure was a missing `using Bricscad.ApplicationServices;` — fixed in the same PR). Post-fix test: 57 rapid switches on debug build `2026.7.30.28586` with zero crashes and zero errors in Loki, including MLeader insertions across switches. PR review toolkit (6 parallel agents) found 0 critical, 0 blocking warnings — 3 minor gaps flagged (text-style path, transitive Active.* in helpers, indentation). Deploy via `bash scripts/copy-binaries.sh AutoCAD25_Debug` (close AutoCAD first — DLL is locked while running). The detailed fix plan with file-by-file changes and suggested commits is at `docs/superpowers/plans/2026-07-30-active-singleton-drift-fix.md` in the Raindrop repo.

**⚠ Incomplete — PR review found gaps (Jul 30, 2026, MERGED with post-review fixes):** A high-precision diff review found the fix is **not fully complete**. (1) `InitStyles(doc)` threads `db` to the MLeader path but the **TextStyle path** (`GetActiveTextStyleID` → `GetTextStyleID`) still reads `Active.Database` (Styles.cs:57), so the `TextStyleTable` scan can still drift. (2) `EnsureSeriesSprinklersImported(doc)`/`EnsureMasterValvesImported(doc)` lock `doc` but call `MakeSprinklerBlock`/`Active.AddXrecordToNamedDictionary` which re-lock `Active.Document` — a transitive mismatch. (3) Indentation regression in `SprinklerFactory.cs:279-308` — **fixed post-review before merging**. Stale `// TODO` comment on `InitStyles()` — **also fixed before merging**. Full details + the verify-before-flag review technique that caught them: `references/drawing-switch-crashes.md` § "Incomplete fix — text-style path". The crash site (MLeader path) IS fixed; the remaining gaps (1) and (2) are pre-existing transitive dependencies that don't crash but leave the fix partial — candidates for a follow-up PR.

**Pitfall:** The `eLockChangeInProgress` error (from `LockDocument()` during `DocumentBecameCurrent`) is a precursor signal — it means the lock/transaction layer is already unstable during the switch. If you see it in Loki, the crash may follow on rapid switches.

**Pitfall:** A clean test run (zero crashes after 100 rapid switches on a debug build) does NOT prove the bug is gone — the crash is a timing-dependent race condition. A release build with different timing may still crash. The fix must be structural (capture-at-entry), not just "I tested it and it didn't crash."

See `references/drawing-switch-crashes.md` for the full root-cause analysis, version timeline, the complete Active.* audit table (8 code paths, SAFE/UNSAFE classification per line), NODHelper bug details, and the fix plan.

### Quantities Palette vs Legacy Quantify — Two Different Inventory Paths

When Tim says "running inventories" or "boundary selection for inventory," he's almost always using the **Quantities Palette** (`IR_Quantities` → `QuantitiesViewModel`), not the legacy `IrrigationModel.Quantify()`. These are two different code paths with different bugs:

- **Legacy `Quantify()`** (`IrrigationModel.cs:~2238`): uses `Editor.GetSelection()` with `AID_OBJECT` filter. AutoCAD natively excludes frozen layers from interactive selection. The `AID_OBJECT` filter gate is the issue here (see `references/debug-bridge.md`).
- **Quantities Palette** (`QuantitiesViewModel.cs`): uses `Editor.SelectAll()` (line 82) which is a **database query** — it returns entities on frozen AND off layers. The boundary containment check (line 209) is purely geometric (point-in-polygon), with no layer visibility filtering. **Frozen mainline pipes show up if their first vertex falls inside the boundary.**

The clean pattern for frozen-layer-aware selection already exists: `EditorSelection.GetFromModelSpace(appName, respectFrozenLayers: true)` (`EditorSelection.cs:33`). See `references/debug-bridge.md` for the full `GetSelection` vs `SelectAll` vs `GetFromModelSpace` comparison table.

### Writing XData via the Debug Bridge (data repair)

The bridge supports writing XData to fix missing tags without touching code. One write = one Ctrl+Z:
```bash
bash .claude/actions/cad-bridge.sh xdata write --layer "LAYER_NAME" --app AID_OBJECT --val 1070=42
```
See `references/debug-bridge.md` for the full `xdata write` syntax, type codes, and the `AID_OBJECT` repair recipe used on I-CR66.dwg.

### XData Design: Tag the Stable Object, Not the Mobile One

Before storing a reference handle on an entity, trace what happens under **copy, swap, and move** — the three operations that break stored links:

- **Copy:** AutoCAD deep-copies XData. The copy carries the original's handle — pointing at something across the drawing.
- **Swap:** `SwapHeadNozzleInPlace` / `SwapOneSprinkler` create a fresh `Sprinkler` via the non-transaction `InsertSprinklerBlockAtPoint` overload. No XData is carried forward from the old head.
- **Move:** Drag the entity and the stored handle points at the old location.

If the information can be derived from a **stable** object (the boundary polyline, the nozzle type) via a scan (containment, layer filter), prefer tagging that stable object instead of storing a per-entity link. The scan is the source of truth; the stored link is a stale-prone parallel data structure.

**Pitfall:** A stored link that covers *some* entities (layout-originated) but not others (hand-placed, interior, moved) means you still need the scan for the uncovered cases. Don't introduce the stored link unless it eliminates the scan entirely. If you can't eliminate the scan, fix the scan's blind spot instead (e.g., `BuildBoundaryData`'s layer filter → tag the polyline so the scan sees it regardless of layer).

### Pre-existing Build Warnings

The codebase has ~4400 pre-existing warnings. Focus only on **new** errors (0 Error(s) is the success signal). Don't try to fix existing warnings.

### MSBuild `ConvertTimeBySystemTimeZoneId` error on SDK 8.x (version-stamp workaround)

Commit `a10e33e3` (Aug 2026) moved the build version stamp to MST via an MSBuild property function:
`<VersionDate>$([System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($([System.DateTime]::Now), 'US Mountain Standard Time').ToString('yyyy.M.d'))</VersionDate>` (Raindrop.csproj:21).
The `ConvertTimeBySystemTimeZoneId` property function is **not available in .NET SDK 8.x** — it was added in SDK 9+. On a host with `dotnet --version` < 9.0, `dotnet build src/raindrop/Raindrop.csproj -c AutoCAD25_Debug` fails immediately with:

```
error MSB4185: The function "ConvertTimeBySystemTimeZoneId" on type "System.TimeZoneInfo" is not available for execution as an MSBuild property function.
```

This is an **environment issue, not a code issue** — the build is fine on SDK 9+ (CI uses it). To verify a C# change compiles on an SDK 8.x host, override the three version properties on the command line to bypass the property-function evaluation:

```bash
dotnet build src/raindrop/Raindrop.csproj -c AutoCAD25_Debug \
  -p:VersionDate=2026.8.2 -p:FileVersion=2026.8.2.1 -p:AssemblyVersion=2026.8.2.1
```

Any date works — these only stamp the DLL version, they don't affect compilation. A successful build with `0 Error(s)` confirms the C# is correct; the version-stamp MSBuild failure is unrelated. Don't try to "fix" the csproj — the MST stamping is intentional (see "Version-stamp timing (MST, not UTC)" above).

### Troubleshooting ≠ Code Changes

When Tim is actively troubleshooting a live drawing (running inventories, selecting boundaries, inspecting output), he wants **investigation only — not code changes**. Read code, hit the debug bridge, inspect XData, trace the code path, and report findings. Do not edit, patch, or propose fixes unless he explicitly asks. He will say when he wants a fix.

**Pitfall:** Jumping to "let me fix that for you" when he's mid-diagnosis breaks his train of thought. The deliverable is an accurate diagnosis of what's happening and why, backed by bridge evidence.

**Pitfall — scattergun patching when a root-cause question is asked (2026-08-13):** When Tim reports a crash and asks "why is this happening?" do NOT immediately start patching every file that has the same code pattern. First investigate: hit the bridge, read the crash stack, trace the call chain, and explain WHAT happened and WHY. Only when Tim says "fix it" should you start changing code — and even then, fix the root cause site first, then check sibling call paths. Tim explicitly pushed back: "I don't know that you need to be changing all this shit." The investigation→diagnosis→confirm-with-Tim→fix sequence is mandatory, not optional.

**Pitfall — don't blame Dropbox without evidence (2026-08-13):** When investigating drawing corruption, "Dropbox sync conflict" is a tempting but unproven theory. Tim explicitly rejected it: "This bug you're talking about, where a save happens right while X data is being written sounds like bullshit and like we would be seeing that all the time." Every sprinkler, pipe, and valve uses the same XData write path — if it corrupted files, every drawing would be broken. Only invoke external causes when you've ruled out all code paths AND can demonstrate a reproducible test on a non-Dropbox drawing that does NOT corrupt.

**Pitfall — `WriteXData` always appends `AID_OBJECT` + int 42 (2026-08-13):** Every call to `XData.WriteXData(objID, xData, tr)` — regardless of what app the caller intends to write — appends `AID_OBJECT` + int 42 to the buffer (XData.cs:327). This means tagging a boundary polyline with `RD_SPRINKLER_BOUNDARY` also stamps it as an irrigation object. `IsIrrigationDrawing()` then counts it (it scans for `AID_OBJECT`). So tagging boundaries via `layout-boundary-commit` makes a non-irrigation drawing suddenly look like one. This is by design (the properties palette needs `AID_OBJECT` to see any Raindrop entity), but it means Enki tagging polylines as boundaries has the side effect of making `IsIrrigationDrawing()` return true, which triggers `InitializeIrrigationDrawing` on the next open — and if any of those polylines are corrupted, the init crashes.

**Algorithm vs visualizer separation (boundary-layout harness):** When Tim asks whether the algorithm is using color (blue/green/anchored) to make layout decisions, the answer is always no — the C# algorithm is pure geometry (distance-to-boundary, medial axis, depth field). Colors exist only in the visualizer. The mathematical property "a complete sprinkler's coverage intersects the boundary in 3 places" is `HasThirdPoint()` in `Uniformity.cs` — now WIRED IN (was dead code, fixed 2026-08-02). Every head gets `HasThirdPoint` computed post-placement and serialized to JSON. The visualizer's old JS `isHeadAnchored` function was **deleted** — the visualizer now reads `hasThirdPoint` from the data. Tim refers to heads without a third point as "green" — use that terminology in discussion. See `references/boundary-layout-meander-engine.md` § "Algorithm vs visualizer: color-blind audit."

**Debugging floating-point roundoff in the harness (boundary-layout, 2026-08-02):** When a bridge head appears on a short edge where the corner heads' adjusted radii already meet head-to-head, suspect floating-point roundoff in the `widestExcess <= 0` break condition. Add `Console.Error.WriteLine($"[DEBUG-BRIDGE] widestExcess={widestExcess:G17}")` inside the bridge loop — the `G17` format specifier prints all 17 significant digits, revealing values like `1.24e-14` that display as `0.000000` with `F6` formatting. A real gap shows as a number > 0.01; roundoff shows as < 1e-10. This technique (G17 format for diagnosing float comparison failures) generalizes to any C# tolerance-check bug.

**`IsPerimeter` property (boundary-layout harness, added 2026-08-02):** `SprinklerHead` now has `IsPerimeter` (bool, default true). Set by the algorithm at placement time: `true` for meander-walk perimeter heads, `false` for interior (medial-axis fill, cap fill) and lattice-grid heads. Existing heads from the DXF are `true`. This is an explicit property — no more inferring perimeter vs interior from `arc == 360`.

**Medial axis renders only inside green (incomplete) heads (boundary-layout harness, 2026-08-02):** Tim's proposal: "I want you to only draw the medial spine when it's inside the radius of a green sprinkler." The visualizer now only shows medial axis points that fall inside a green (hasThirdPoint=false) head's adjusted-radius throw circle. Blue heads' coverage suppresses MA dots (their area is covered); green heads' coverage shows MA dots (their area needs interior fill). This evolved: first the old "hide under blue" filter was removed entirely (showing full skeleton), then Tim proposed the green-only filter as the principled version.

**Geometric arcs, not catalog-snapped (boundary-layout harness, 2026-08-02):** Tim: "I want you to calculate the arc. I want you to ignore the angles, the quarter, half, full when setting the arcs." The algorithm now stores `ideal.AngleDegrees` (from `InferByHalfRadiusFromAnchor` — the actual geometric angle from the half-radius boundary intersections) instead of `match.AssignedAngleDegrees` (the catalog's fixed 90/180/270/360). The matcher still picks the right nozzle (radius/flow/profile) for the boundary angle, but the drawn coverage arc is the true geometric angle. Result: corner heads show 83.7°/107.1°/124.5° instead of snapping to 90°. See `references/boundary-layout-meander-engine.md` § "Geometric arcs, not catalog-snapped."

**Adjacency fix in HasThirdPoint (boundary-layout harness, 2026-08-02):** The initial C# `BoundaryIntersectionCount` counted adjacent edges (sharing a vertex with an own edge) as third points — making corner heads blue when they should be green. Tim caught it: "sprinklers six and nine should both be green because they hit their nearest neighbors, but they don't get in contact with the boundary again." Fix: `BoundaryIntersectionCount` now excludes edges sharing a vertex with any own edge. Only **non-adjacent** reached edges count. After fix: boundary #2 went from 11 blue/0 green to 2 blue/9 green. See `references/boundary-layout-meander-engine.md` § "Adjacency fix."

**Walker spacing uses adjusted radius, not catalog (boundary-layout harness, 2026-08-02, CORRECTED):** The walker's spacing decisions (close-gap check, `RedistributeEvenly`, `GetInternalHead` reach, bridge span) use `AdjustedRadius` — the actual throw, not the catalog max. Tim explicitly corrected an initial switch to catalog radius: "the walker function should use the adjusted radius. And if we did that, we would find out that we were short one head and needed to add one in there." Using adjusted radius means the walk detects gaps where heads don't reach each other and adds bridge heads to fill them. The catalog radius is only used by `AcrossDistance` (for the exclusion window margin) and `PickHead` (to select the nozzle size). **Pitfall:** Tim's head-to-head check is `d ≤ r` (each head inside neighbor's throw circle), NOT `d ≤ r1+r2` (throw circles overlap). The bridge tolerance must use `min(adjR1, adjR2)` — not `adjR1 + adjR2` — so a small-radius head next to a big one still triggers a bridge if the big head's neighbor can't reach back. The 10% fill threshold is for **interior fill only**, not bridge tolerance — along an edge, head-to-head is exact: `gap ≤ min(adjR1, adjR2)`. See `references/boundary-layout-meander-engine.md` § "Walker spacing uses adjusted radius."

**Adjusted radius (boundary-layout harness):** Sprinkler nozzles have adjustable radius — 75% to 100% of the design (catalog) radius. The meander walker always computed an `AdjustedRadius` internally (clamped to `[0.75×Radius, Radius]`), but it was never stored — the visualizer drew the catalog radius instead, producing oversized coverage circles. Fixed 2026-08-02: `SprinklerHead` now has an `AdjustedRadius` property, stored alongside `Radius` (the catalog max). The visualizer draws at `AdjustedRadius`. The uniformity model (`Evaluate`, `ComputeDepthField`) also uses `AdjustedRadius` for depth calculations. `BoundaryIntersectionCount` (new) counts how many boundary edges the throw circle at the adjusted radius intersects — the raw count behind `HasThirdPoint`.

**Diagnosing oversized radius in the harness (fixed 2026-08-02):** When a ported head's drawn radius circle extended far past the boundary, two compounding causes: (1) the `AcrossDistance` exclusion window (±maxRadius in arc-length) hid the true nearest non-own edge, inflating the across distance. (2) The catalog gap (e.g. MP Rotator 20→30) turned a small overshoot into a large one. The visualizer now draws the **adjusted radius** (22.5ft for #11) instead of the catalog radius (30ft), so coverage circles match the actual throw. See `references/boundary-layout-meander-engine.md` § "AcrossDistance exclusion window pitfall" for the full diagnostic recipe.

**Floating-point tolerance bug in bridge check (boundary-layout harness, 2026-08-02):** The bridge loop's `if (widestExcess <= 0) break;` fails on ~1.2e-14 ft roundoff when gap and adjusted radius are mathematically equal but computed via different code paths (arc-length subtraction vs Euclidean distance). This triggers a spurious bridge head on edge DE of boundary #1 (11.55 ft edge where both corner heads have adjR=11.55). Fix: `<= 1e-9` instead of `<= 0`. See `references/boundary-layout-meander-engine.md` § "Floating-point roundoff triggers spurious bridge heads."

**`ClosestPointExcludingRange` excludes entire segments, not partial (boundary-layout harness, 2026-08-02):** `Boundary.ClosestPointExcludingRange` skips an entire edge segment if ANY part of it overlaps the ±maxRadius arc-length window — it does not clip to the non-excluded subsegment. This is the deeper mechanism behind the AcrossDistance exclusion window pitfall: a 60-ft edge that overlaps by 2 ft is entirely excluded, hiding the true nearest edge and inflating the bridge head nozzle size (r=15 instead of r=10 on DE's bridge head). See `references/boundary-layout-meander-engine.md` § "ClosestPointExcludingRange excludes ENTIRE segments, not partial."

## Dead Code (removed in issue #654 — ⚠ UNCOMMITTED as of 2026-07-30)

**36 files changed, 5,014 lines deleted, `dotnet build AutoCAD25_Debug` → 0 errors.** The work is done and verified but **not yet committed/merged to DEV** — the changes sit uncommitted on Tim's machine. Treat the removals below as the plan, not as current repo state. Before relying on a symbol being gone, `grep` for it on the current DEV tip.

**✅ Removed from DEV (commit `5f60c31a`, Jul 31, 2026, for the 2026.7.31 release):**
- `IR_WeightedArea_old` (`Commands.Irrigation.cs`) — the `WeightedAreaOld()` command method + the 300-line `ValveFactory.WeightedAreasToValves()` it called (sole caller was the dead command). Loki-verified 0 hits in 30d before removal.
- `IR_MainlineAnalysis_old` (`PipeControl.cs`) — the `btnMainlineAnalysis_Click` handler + the `btnMainlineAnalysis` button (field, constructor init, properties, layout registration) from `PipeControl.cs` + `PipeControl.Designer.cs`. **Dangling reference** — there was no `[CommandMethod("IR_MainlineAnalysis_old")]` anywhere; `Commands.Send()` would silently fail. Loki-verified 0 hits in 30d. The live Mainline Analysis button (V2 `PipesViewV2`) already routes to `IR_MainlineAnalysis` (palette show command) and stays.
- **⚠ Command manifest sync (learned the hard way, PR #709):** Removing a `[CommandMethod]` from code also requires removing its line from `docs/command-manifest.txt`. The `validate-commands.yml` CI workflow regenerates the manifest from source and diffs it against the committed file — a drift fails the PR. Regenerate with `bash .claude/actions/gen-command-manifest.sh` (the script outputs the command list WITHOUT the header comment; the committed file has a 3-line `#` header that CI ignores in the diff). Safe edit: just delete the one `<CommandName>` line from the manifest, keeping the header.
- **Follow-up dead-code candidate:** the entire `PipeControl.cs` WinForms control is now confirmed fully orphaned — `UpdatePipeControl()` is still called from `AID_Palettes.cs:730` but `PipeControl` is never added to any palette (V1 uses WPF `PipesView`, V2 uses `PipesViewV2`). The `btnMainlineAnalysisNew_Click` handler that remains in `PipeControl.cs` also calls the live `IR_MainlineAnalysis` palette command, but it's unreachable. A future dead-code sweep can remove the whole `PipeControl` class + its `.Designer.cs` + the `UpdatePipeControl()` callsite.

**Files deleted (28 .cs + 2 data = 30):**
- `Property Wrappers/` — entire directory (10 files): `PropertyValve.cs`, `PropertyControlValve.cs`, `PropertyLink.cs`, `PropertyPipe.cs`, `PropertySprinkler.cs`, `PropertyPump.cs`, `PropertyNode.cs`, `PropertyNewPlant.cs`, `DriplineTypeConverter - Copy.cs`, `PipeClassConverter.cs`
- `Palettes/IrrigationPropertyGrid.cs` + `.Designer.cs` — dead WinForms host
- `Forms/AddPlantForm.cs` + `.Designer.cs` + `.resx` — dead WinForms host
- `Hydraulic/HydraulicTank.cs`, `CAD Utility/CommandHandlers.cs`, `CAD Utility/DocumentReactor.cs`, `Properties/Annotations.cs`, `Properties/AssemblyInfo - Copy.cs`, `ElevationModel.cs`, `CAD Extensions/TransactionManagerExtensions.cs`, `ListWrappers/SprinklerDefinitionSummary.cs`, `Activation/DiskInfoService.cs`, `Jigs/Plinejig.cs`, `Jigs/PolylineLayoutJig.cs`, `Jigs/PaintPolylineEntityJig.cs`, `ZSplineTest.cs`, `zz Dictionary.cs`
- Data: `data/metric/Plants_Metric.old.json`, `epanet2.dll.old_v2.0`

**Dead `[CommandMethod]` methods removed (21 commands):**
- From `Commands.Irrigation.cs` (18): `IR_ExpSettings`, `IR_SelectPipeSize`, `IR_WriteEPANETDemands`, `IR_ClearAnalysis`, `IR_WeightedArea_old`, `IR_SizeSeq`, `IR_AggressiveSizeValves`, `IR_LayoutOnPolyline`, `IR_ColorPipesBySize`, `IR_ColorLinksByVelocity`, `IR_RefreshElevationPoints`, `IR_About`, `IR_CheckUpdates`, `IR_AssignValvePressureDrop`, `IR_AssignPumpProperties`, `IR_ClearPumpProperties`, `IR_ExportMainlineNetwork`, `IR_CZA`
- From `Commands.Interface.cs` (2): `IR_ResetPalettes`, `IR_ToolsLegacy` (+ their constants)
- From `Commands.Internal.cs` (3): `Internal_SaveIrrigationSettings`, `Internal_ZoomAndHighlight`, `Internal_PublishNodeChangedEvent` (+ their constants)

**Dead palette methods removed (cascade from dead commands):**
- `ShowIrToolsPaletteLegacy()` — only caller was the dead `IR_ToolsLegacy` command
- `ResetPalettes()` — only caller was the dead `IR_ResetPalettes` command
- `DisposePalette()` — only caller was `ResetPalettes()` (which was removed)

**csproj cleanup:** Removed 8 stale `<Compile Remove>` entries for files that no longer exist on disk (5 "old copies\\" entries + `AssemblyInfo - Copy.cs`, `ZSplineTest.cs`, `zz Dictionary.cs`).

**NOT deleted (still live despite looking dead):**
- `TypedValueExtensions.cs` — extension methods used by `ProductService.cs` (see extension-method trap below)
- `AID_Settings.cs` — `[Obsolete]` but still referenced by ~19 files
- `AesEncryptionService.cs` — needs activation-flow reflection verification
- Dev/test commands in `Commands.Tests.cs` (16 commands) — command-line-only dev tools, judgment call to keep
- `RDTRACKING*`/`RDSCOPE`/`RDSTATUS`/`ENKI`/`RD_DEBUGBRIDGE` — dev/debug toggles, kept
- `IR_CalcArcByCurve`/`IR_CalcArcByRadius`/`IR_ClearArcPreview` — no ribbon wiring but DebugBridge calls their underlying methods

### Broad dead-code audit — src/raindrop/ (Track 3)

A broader audit beyond Property Wrappers and CAD Commands found **14 more DEAD-REMOVE** files/symbols across the whole tree: orphaned files explicitly excluded from compile (`AssemblyInfo - Copy.cs`, `ZSplineTest.cs`, `zz Dictionary.cs`), duplicate annotation files (`Annotations.cs` = dead; `Annotations1.cs` = live), fully-commented-out class shells (`ElevationModel.cs` root, `TransactionManagerExtensions.cs`), zero-reference jigs (`Plinejig.cs`, `PolylineLayoutJig.cs`), superseded helpers (`DiskInfoService` → `SystemInfoHelper`, `HydraulicTank` → `HydraulicReservoir`), and dead static classes (`CommandHandlersX`, `DocumentReactor`). For the full findings table + the refined audit technique, see **`references/broad-dead-code-audit.md`**.

**Audit technique — parallel subagent dispatch:** For a large codebase audit, dispatch 3 parallel `delegate_task` subagents (one per track: Property Wrappers vs ViewModels, CAD Commands UI-wiring, other dead code). Each searches independently. Consolidate their findings yourself (their summaries are self-reports, not verified facts — spot-check with your own `grep` before deleting). The subagents created temp `_audit*.json` files during analysis; clean those up afterward.

**SDK-style csproj file deletion:** Raindrop uses SDK-style `<Project Sdk="Microsoft.NET.Sdk">` — `.cs` files are globbed automatically. Deleting a `.cs` file from disk removes it from compilation; no csproj edit needed. BUT: stale `<Compile Remove="...">` entries for files that no longer exist are harmless noise — clean them up if you're already editing the csproj. The `old copies\` directory entries (5 files) were already gone from disk but still listed in `<Compile Remove>`.

**⚠ Extension-method trap (learned the hard way):** `TypedValueExtensions.cs` was flagged DEAD-REMOVE by the audit (zero class-name references) but the **compiler proved it LIVE** — `ProductService.cs` calls `.ReadString()` / `.ReadDecimal()` as extension methods on `TypedValue[]`. Extension methods are resolved by `using` the containing namespace, NOT by the class name appearing at the call site — so a class-name grep finds zero hits even when the methods are actively used. **Rule: never delete a `static class` containing `this`-parameter extension methods based on class-name references alone.** Grep for the *method names* instead: `grep -rn "\.MethodName(" --include="*.cs"` — or just delete and let the compiler catch it (it will, with a CS1061 error naming the exact call site). This was the one false positive in the #654 audit; the build fixed it immediately after `git checkout`.

**⚠ Internal_* command dead pattern:** A `[CommandMethod]` wrapper whose body calls a same-named (or similar) plain method is NOT alive just because the plain method is called directly. `Internal_SaveIrrigationSettings` wraps `AID_Application.SaveIrrigationSettings()` — the plain method IS called directly, but the *command* has no `ExecuteCommand`/`Send`/`SendStringToExecute` caller. Same for `Internal_ZoomAndHighlight` (its `ExecuteCommand` caller was commented out; live code calls the `ZoomAndHighlight()` extension method directly) and `Internal_PublishNodeChangedEvent` (only caller was commented out; live code publishes `NodeChangedEvent` via the aggregator directly). **Rule: grep for the command string or constant, not the method it wraps.** When removing these, also remove the corresponding `public const string` from the `Internal` struct.

**⚠ Dead-command cascade to palette methods:** Removing a dead `[CommandMethod]` can cascade. If the command was the *only* caller of a method in `AID_Palettes.cs` (or elsewhere), that method is now dead too. In #654: removing `IR_ToolsLegacy` → `ShowIrToolsPaletteLegacy()` became unreferenced → removed. Removing `IR_ResetPalettes` → `ResetPalettes()` became unreferenced → `DisposePalette()` (only called by `ResetPalettes()`) also became unreferenced → both removed. **After removing a command, re-grep for the method it called to check for cascade.**

Three KEEP-INVESTIGATE items (do not auto-remove): `AID_Settings` ([Obsolete] but still referenced by 19 files — migration needed first), `AesEncryptionService` whole file (verify no activation/reflection use), and `IR_WeightedArea_old` (a `[CommandMethod]` — see the command-audit below; it IS dead by the UI-wiring definition, but AutoCAD still registers it for command-line typing, so it's a softer remove than a plain dead class).

### Property Wrappers directory — ALL DEAD (audit, issue #654)

The entire `src/raindrop/Property Wrappers/` directory (10 files) is **dead code** — every property of value has been carried forward into `src/raindrop/ViewModels/Collections/`. The live properties palette is the WPF `ObjectsPropertiesView` (instantiated at `Palettes/AID_Palettes.cs:483` as `PropertyGridWpf`), populated by `PropertyEvents.IrrigationPropertySorter()` which dispatches to the CollectionViewModels via a `type.Name` switch. The old WinForms `Palettes/IrrigationPropertyGrid.cs` (the only file referencing the `Property*` wrapper classes) is **never instantiated** outside its own `*.Designer.cs` — no `new IrrigationPropertyGrid()`, no palette registration. Same for `Forms/AddPlantForm.cs` (the only referencer of `PropertyNewPlant`).

All 10 files are **DEAD-REMOVE**: `PropertyControlValve`, `PropertyLink`, `PropertyNewPlant`, `PropertyNode`, `PropertyPipe`, `PropertyPump`, `PropertySprinkler`, `PropertyValve` (incl. nested `ValveDefConverter`), `DriplineTypeConverter - Copy.cs`, `PipeClassConverter.cs`. For the full audit table (class, references, live-vs-dead, carried-forward properties, verdict, per-file notes), see **`references/property-wrappers-audit.md`**.

**Caveat flagged for #654:** `PropertyValve.PumpType`/`PumpPower`/`PumpID` (EPANET pump modeling on a `Valve`) have **no carry-forward** into any CollectionViewModel. If those fields are still intended to be user-editable via the grid for a valve-doubles-as-pump scenario, that's a feature gap to resolve before deletion — `PumpCollectionViewModel` covers the `Pump` object's own pump properties, but a `Valve` carrying pump metadata would lose that UI.

### `[CommandMethod]` dead-command audit (issue #654, all 15 CAD Commands files)

A full audit of **171** `[CommandMethod("...")]` attributes across `src/raindrop/CAD Commands/*.cs` classified each as LIVE / INTERNAL / DEAD by searching the whole tree for UI entry points (ribbon `MakeButton`, `Raindrop.bundle/PackageContents.xml` `<Command>`, context menus, palette/presentation `Commands.Send(...)`) and programmatic callers (`Commands.ExecuteCommand(...)`, `SendStringToExecute(...)`). Result: **103 LIVE, 17 INTERNAL, 51 DEAD**. All 3 issue #654 candidates confirmed dead (`IR_AssignPumpProperties`, `IR_ClearPumpProperties`, `IR_AssignValvePressureDrop` — docs only, no UI wiring). `Commands.Irrigation.cs` is the biggest dead harbor (18 dead of ~73).

**Important correction to the broad-dead-code-audit technique:** a `[CommandMethod]` is NOT automatically "un-confirmable-dead by reflection." AutoCAD does register every `[CommandMethod]` for command-line typing, but a command with **zero UI entry point AND zero programmatic caller** IS dead for issue-triage purposes. The earlier audit's step 6 over-generalized — apply it only to attribute-instantiated *classes* (`[TypeConverter]`, `[Editor]`, IXDataWriter impls), not to `[CommandMethod]`s, which can be confirmed dead by exhaustive UI-wiring + ExecuteCommand search. See **`references/command-method-dead-audit.md`** for the full technique, the 51-dead-command table, the 17 INTERNAL commands and their live callers, and the pitfalls that bit during the audit (constant-based commands, multi-line SendStringToExecute, same-name-different-method, commented-out callers, categorization-whitelist-vs-invocation).

## Production Release (DEV → master)

Cutting a production release is a multi-phase process: prep on DEV → open a DEV→master PR → merge triggers automated build/sign/deploy → verify. The full step-by-step (with the UTC version-stamp timing trap, dual release-notes surfaces, stale-command cleanup, and the prior-release PR template) is in **`references/production-release.md`**. Read it before cutting any release.

**Quick summary of the phases:**

1. **Prep on DEV** — flag/decide on stale `_old`/diagnostic commands (last cycle removed `IR_WeightedAreaCompare` via commit `516cdc6b`); **Loki-verify zero usage** before removing (see `references/production-release.md` § 1a-verify — filter on the structured `CommandName` field, not the rendered message); verify `docs/release-notes.md` has a consolidated production entry on top of the individual dev entries; verify the production updater config `Description` field (`Raindrop_UpdatesConfig.aip`) is a user-facing New/Improved/Fixed summary; re-stamp version strings to the intended build date; build-verify (`AutoCAD25_Debug` + `AutoCAD_Release`). The `validate-version.yml` workflow gates the PR with 5 checks — see `references/production-release.md` for the self-check commands.
2. **Open the PR** — DEV → master, title `Production release YYYY.M.D`, body follows the PR #596 template (user-facing highlights, internal-only callouts like the debug bridge staying dev-only, post-merge checklist). The PR triggers CI in PR mode (builds + signs, does NOT deploy).
3. **Merge** — the push to `master` triggers `build-and-deploy-raindrop.yml` automatically: builds both AutoCAD targets (debug bridge **excluded** on master via `RAINDROP_DEBUGBRIDGE=0`), Azure code-signs DLLs + MSI, deploys MSI + updater config to **Cloudflare R2 prod channel**, creates immutable **GitHub Release `vYYYY.M.D`** with MSI attached. `sync-release-notes.yml` republishes `docs/release-notes.md` to the docs site.
4. **Verify** — `build-and-deploy` succeeded with correct version, GitHub Release exists with MSI, `sync-release-notes` succeeded, test install on Ally's machine or the laptop, website post about new features.

### ⚠ Version-stamp timing (MST, not UTC)

The build version is stamped from the build date. **As of Aug 1, 2026 (commit `a10e33e3`), the stamp uses MST (America/Phoenix, UTC-7, no DST) in all three places:** the csproj `VersionDate` property, the `build-and-deploy-raindrop.yml` validate step (`TZ: America/Phoenix`), and `validate-version.yml` (`TZ='America/Phoenix' date`). So the version matches Tim's local date, not the CI runner's UTC clock.

Before the MST fix, a merge at 22:00 local on July 31 would stamp `2026.7.31` in UTC (because UTC was already Aug 1) — causing a mismatch between the AIP Description text (which said "Version 2026.7.31") and the actual MSI/Release tag (which would be `2026.8.1`). That happened on the 2026.7.31 release: the merge fired at UTC 03:19 on Aug 1, so the release was tagged `v2026.8.1` while the notes said 7.31. The MST fix (committed to DEV the same day, takes effect on the next build) prevents this going forward.

- **Always check the time right before merging** — run `date -u` and subtract 7 hours for MST to confirm the stamp will match what you wrote in the AIP files and release notes. If merging near midnight MST, account for the date rolling over.
- The updater config `Description` is free-text and won't fail CI validation on a date mismatch, but the GitHub Release tag/title will use the CI-computed version.

### Two separate "release notes" surfaces

1. **Updater config `Description`** (`Raindrop_UpdatesConfig.aip`) — what users see in the auto-update prompt AND what gets attached to the GitHub Release as notes. CI validates it has ≥2 non-empty lines or the build fails.
2. **`docs/release-notes.md`** — syncs to the docs site automatically via `sync-release-notes.yml`. For a production release, **strip the individual dev-channel entries** (the per-dev-build entries that accumulate during development) and replace them with **one clean consolidated entry** matching the style of prior production releases. The dev entries are internal build logs — users should see one entry per production release, not the dev history. The prior cycle (PR #596) added a consolidated entry on top but left the dev entries below it — this session (Jul 31, 2026) Tim corrected that: the dev entries should be removed, not kept as a detailed record. Consolidate large themes (e.g. Settings touching 5 pages) into one bullet with per-page sub-items, not 5 separate bullets. Keep each bullet to one–two short sentences — the prior production releases (v2026.6.30 and earlier) are the style reference: concise, scannable, one idea per bullet.

## Key Namespaces

- `AID.Factories` — SprinklerFactory, PlantFactory, etc. (business logic)
- `AID.CAD_Commands` — Command entry points (Commands.TweakCoverage, Commands.Plants, etc.)
- `AID.Jigs` — DrawJig subclasses (SprinklerJig, PlantJig, etc.)
- `AID.Landscape.Planting` — Plant/PlantDefinition model
- `AID.Presentation.Settings` — Settings viewmodels
- `AID.CAD_Utility` — Blocks, Styles, Utililty helpers
- `AID.Irrigation.Uniformity` — CoverageTweak, StripRect, etc.

## Accessing Commands Across Namespaces

`Commands.TweakOneHead` was `private static`. To call from `SprinklerFactory` (different namespace):
1. Change to `internal static`
2. Add `using AID.CAD_Commands;` to the calling file
3. Both are in the same assembly so `internal` works.

## Licensing, Trials, and Purchase Flow

When working on licensing (`LicenseService.cs`, `KeyGenApiHelper.cs`, trial/purchase UI, or Keygen/Stripe/n8n integration), see **`references/licensing-architecture.md`** for the full architecture, component locations, security issues, and what's done vs not done.

When troubleshooting a live drawing via the debug bridge, see **`references/debug-bridge.md`** for the full subcommand reference, XData app-name catalog, and known data-vs-code issues.

When working on Q/A nozzle cycling, palette selection sync, or the insert/tweak-coverage nozzle walk, see **`references/nozzle-qa-walk.md`** for how Q/A maps onto the palette tree and the current sync gap.

When iterating on the boundary layout algorithm **outside of CAD** (the `boundary-layout` harness repo — CAD-free core, DXF import, uniformity visualization, netDxf gotchas, the netstandard2.0-portability pattern), see **`references/boundary-layout-harness.md`** for the architecture (netstandard2.0 Core + CLI + canvas visualizer), how to run it, the verified netDxf 2023.11.10 API names (`Polyline2D` not `LwPolyline`, non-enumerable `doc.Entities`, `netDxf.Blocks.Block`, `Polyline3D.Vertexes` are `Vector3`), the netstandard2.0 C# 7.3 nullable trap, the **resolved three-part System.Text.Json fix** (fields→properties + CLI snapshot DTO to drop `SampleValues` since Core can't reference System.Text.Json for `[JsonIgnore]`, and `IncludeFields=true` for the readonly-struct `Point2D`), the sprinkler-series extraction from Raindrop's imperial TSVs (`tools/gen_sprinklers.py`, substring model filters over-capture siblings like I-25HS/MP800, arc derived from nozzle suffix), the real-drawing reader (verified on `examples/Example1.dxf`: boundaries on a `*-Boundary` layer, coverage circles on `*-Sprinkler-Radius` are NOT boundaries, sprinkler heads are Insert blocks whose names encode the spec, the `SprinklerCatalog` parser for `_`- and `~`-delimited block-name forms, the two catalog gotchas — per-head model parse + case-insensitive JSON deserialization), **the visualizer blank-canvas-on-load bug + fix and the auto-load-on-refresh pattern (`?src=` / fetch default so Tim never browses for the file), plus the pixel-count console check to verify the canvas actually drew, the view-persistence + the pattern Tim settled on = put the ACTIVE algorithm FIRST in the CLI's list and default the visualizer to index 0 (name-based algorithm restore is fragile — a stale localStorage value re-introduced the bug; bump the key when you change the scheme), the nozzle-name-label feature (offset ~0.5 ft from the head, on ALL boundaries' heads), **the coverage arc rendering (pie wedges for part-circle heads, circle outlines for full-circle; canvas Y-flip on rotation; requires `SprinklerHead.Rotation` from arc inference)**, the auto-reload polling that re-renders on data change, **the auto-reload signature pitfall (must include `existingUniformity` + `existingHeads` in the signature, not just algo head counts — stale data shows old uniformity numbers when only existing-head arcs changed)**, **the multi-boundary rendering (render ALL boundaries at once — selected highlighted, rest dimmed — with ALL boundaries' meander heads drawn in yellow so Tim can compare them side-by-side; fitView unions all boundary bboxes; same-named boundaries disambiguated as `#1`…`#N` in the dropdown; auto-reload only re-fetches JSON not HTML so HTML changes need a full page reload; the preview pane has NO right-click menu so Tim can't self-refresh — must ask agent to `open_preview`)**, **the existing-heads arc inference (run `InferByHalfRadiusFromAnchor` on existing/blue heads too — Tim: "the blue sprinkler should have the exact same coverage arc calculation as the yellow sprinklers"; the anchor-based method probes from the closest point ON the boundary, not the symbol position, giving clean 180°/90° arcs regardless of install offset — this is what makes blue and yellow arcs match; store in `existingHeads` with inferred arcs/rotations; render blue coverage arcs clipped to boundary; both blue and yellow use the same depth model for uniformity — apples-to-apples)**, and the "show Tim results" rule — browser_* tools are an automated instance, NOT his screen; use the Hermes `open_preview` pane, do NOT spawn browser tabs with `cmd /c start` (Tim explicitly rejected that)**, and the Windows path convention (native `C:\...`, not `/c/...`).

When working on boundary layout (`IR_LayoutOnBoundary`), coverage arc orientation, `OrientHeadFromBoundary`, sprinkler→boundary links, or XData boundary tagging, see **`references/boundary-orientation.md`** for the two-stage layout pipeline, the layer-filter override bug class, the `RD_SPRINKLER_BOUNDARY` polyline-tag pattern (tag the stable boundary, not the mobile sprinkler), the `SprinklerArcMatcher` adjustable-arc pass-through fix, and the PR review findings from the first `pr-review-toolkit` run (unprotected XData writes, duplicated persist logic, missing H-suffix test).

When investigating how to run the harness layout algorithm and insert the results back into CAD via the debug bridge (reading a selected polyline, running the layout, inserting sprinklers at specific positions with arcs/radii), see **`references/boundary-layout-bridge-insertion.md`** for the existing bridge endpoints (`boundary-vertices`, `layout-boundary-preview`/`-commit`, `/insert-sprinkler`), the `InsertSprinklerBlockAtPoint` insert path, and the three options for getting harness results into CAD (port the algorithm, agent-driven workflow, or extend `/insert-sprinkler` with `arcDegrees`/`aimRadians`).

When iterating on the boundary layout algorithm in the harness and you need the yellow dots to match where Raindrop actually places heads, see **`references/boundary-layout-meander-engine.md`** for the REAL algorithm internals: the three-part engine in `~/Raindrop/src/raindrop/Irrigation/BoundaryLayout/` (`BoundaryPerimeterLayoutEngine` → `PerimeterRunBreaker` → `BoundaryMeanderWalker` → `SprinklerArcMatcher`), the two-thread meander + `RedistributeEvenly` (single shared overlap ratio `k`, `k>=0.95` = degenerate under-covered run), `AdjustedRadius` `[0.75,1.0]×catalog` clamping, **the arc inference + arc matching THIRD pipeline stage** (ported `NozzleArc`/`ArcInference.InferByHalfRadius`/`SprinklerArcMatcher` in Core's `ArcInference.cs` — **`InferByHalfRadius` is the preferred method** Tim asked for by name: draws a circle at R/2, intersects the boundary, computes the inward arc from the two intersection points; corner heads get the actual interior angle (not just 90°), edge heads 180°, interior 360°; `InferByCurve` is the fallback; `Boundary.IntersectCircle` added for the probe; `SprinklerHead.Rotation` field; verified 90°/180°/270°/360° arc distribution on Example1 — including a 270° head on an I-25 rectangle corner where `InferByCurve` had produced 90°), **`InferByHalfRadiusFromAnchor`** (the anchor-based variant Tim requested: probe from the closest point ON the boundary, not the symbol position — gives clean 180°/90° regardless of install offset; this is what makes blue existing-head arcs match yellow ported-head arcs; when the head sits ON the boundary, use the segment normal with a Contains probe as the outward direction), the ported `RaindropLayoutEngine`/`RaindropMeanderAlgorithm` in harness Core (namespace `.Algorithms` not `.Layout` — CS0101 collision; `GetInternalHead` needs both min+max radius), the geometry methods added to `Boundary` (now using Raindrop's CurveSeg for arc/bulge support — COMPLETED 2026-08-02; `ClosestResult` carries `Tangent` for arc inference; `IntersectCircle` added for the half-radius probe; `Contains` uses tessellated polygon for arc accuracy), the **bridge-head post-loop fix** (the walk's `distance < r1+r2` convergence stops at 2×radius gaps; the original Raindrop `LayAlongBetween` had a post-loop "average sprinkler" step the port dropped — bridge heads are iteratively added at the widest gap until every gap ≤ maxRadius; the run's end corner must be included in `ordered` before the bridge check because the back thread marches inward and the end corner is only added by the next run's fwd+dedup; the bridge threshold is `widestGap > maxRadius`, NOT `RedistributeEvenly`'s `k >= 0.95` degenerate check which only catches > 2×radius gaps), the **uniformity comparison: ported vs. existing** (the harness now evaluates both the blue/existing and yellow/ported heads per boundary with Raindrop's DepthField model — arc fraction boost + triangular profile + flow; boundary #5's existing layout wins 96.4% CU vs ported 67.5% — Tim's hand layout uses all full-circle heads which give more uniform overlap despite higher flow; the arc-fraction boost may over-concentrate flow in part-circle corners, a key tuning insight), **coverage arc clipping** (canvas `ctx.clip()` to the boundary polygon so part-circle wedges don't render outside — Tim: "your sprinklers are calculating areas that are outside of the perimeter"), **the interior fill algorithm** (four approaches, medial-axis longest-branch + even distribution is current — see `boundary-layout-meander-engine.md` § "Medial-axis-guided trough fill". The **medial axis** (thin skeleton: per-row/per-column max distance-to-boundary ridge) is found, the **longest branch** is extracted (`FindLongestMedialAxisBranch` — score by count×extent; BFS flood-fill fails because the cross is connected at the center), and 360° full-circle heads are **evenly distributed** along it (`DistributeAlongPolyline` — equal arc-length intervals, not greedy driest-first). **Cap fill** (`FindCapFillPosition` — Pass 3 after medial axis; see `boundary-layout-meander-engine.md` § "Cap fill — 3-point inscribed circle") iterates all C(n,3) edge triples, computes the incenter of each triangle, and places a full-circle head at the driest incenter inside the boundary — Tim: "a circle that touches the boundary at three points, so it kind of centers itself." First approach (driest point → 3 nearest edges) failed because the incenter landed outside; the fix is to try ALL edge triples and filter by Contains. **Pitfall:** the original `FindMedialAxis` used a threshold band producing a grid of 2070 dots — Tim: "it's a grid, not a line." Fixed to thin skeleton (155 pts). Superseded approaches: greedy driest-first on full cross (placed heads on both arms — Tim: "all 6 should be on the center line"), iterative trough (threshold-based driest-point, 5% of mean — too shallow for big-head boundaries) and iterative inward polygon offset (Minkowski shrink, `Boundary.OffsetInward` with 3 collapse checks: area, bbox, signed-area flip). Boundary #3: 7 heads on y=44.9 center line at 32.7ft spacing (head-to-head, `ceil(len/r)+1`), CU 72.3%→82.2%, DU 55.1%→71.5%, coverage 98%→100%. #4/#5: threshold-aware bridge tolerance (`widestGap <= maxRadius × (1+threshold)`) removed short-edge midpoint heads, CU 63.5%→76.2%. `--fill-threshold` CLI flag (default 10%) governs both interior fill gate and bridge tolerance. **Iterative cap fill** (Pass 3): `FindCapFillPosition` iterates all C(n,3) edge triples, places a full at the driest 3-edge incenter, recomputes depth, repeats up to 5 times. Gated by depth threshold (75% of mean). `HasThirdPoint` gate was attempted but abandoned — geometric overthrow ≠ meaningful coverage at 96% of throw (12% peak PR). **Rewritten 2026-08-02:** cap fill now searches medial axis points directly (not 3-edge incenters) — finds the driest uncovered MA point below 75% of mean depth and places a full there. Heads now land exactly on the skeleton (0.0ft from MA). Boundary #2: 2 fulls (was 5), both on MA. **Corner heads (≤90° interior angle) always marked blue** in the visualizer's `isHeadAnchored` to prevent medial axis from rendering near corners. **Medial axis rendering suppressed inside blue head throw circles** — green skeleton only shows in gaps where unanchored (green) heads leave coverage holes. **Colors apply to ALL boundaries** (not just selected). Boundary #2: 12→16 heads (5 fulls), CU 72.1%→88.2%, DU 67.7%→81.8%. Vertex labels (A, B, C, D) rendered on ALL boundaries (selected=teal, non-selected=dimmer). Blue sprinklers removed from rendering — Tim: "stop rendering the blue sprinklers, we are beating them in every category."), the corner-anchoring verification status (confirmed on 4/6 vertices of Example1 boundary 0; the visualizer's index-0-default is what made dots look "not on corners," not the port — see `boundary-layout-harness.md` § view persistence), **the `AcrossDistance` exclusion window pitfall** (±maxRadius arc-length window hides the true nearest non-own edge on certain boundary shapes, inflating the across distance and forcing a larger nozzle — see `boundary-layout-meander-engine.md` § "AcrossDistance exclusion window pitfall" for the diagnostic recipe), **the algorithm-vs-visualizer color-blind audit** (the C# algorithm never references color; `HasThirdPoint()` is defined but dead code; the visualizer's color-gated MA rendering is display-only — see `boundary-layout-meander-engine.md` § "Algorithm vs visualizer: color-blind audit"), and the catalog gap insight (MP Rotator 20→30 gap turns a 2.5ft overshoot into 7.5ft).

**Visualizer rendering preferences (2026-08-02, updated):** Tim wants vertex labels (A, B, C, D...) on ALL boundaries (not just selected), sprinkler number labels (1, 2, 3...) on ALL boundaries (initially selected-only, corrected to all), full-circle heads in orange (`#ff8c00`) with visible radius circles, perimeter heads color-coded blue (anchored: within radius of both neighbors AND overthrows/tangent to a **non-adjacent** third edge — adjacent edges sharing a vertex don't count) vs green (unanchored — Tim asked for green), and special markers (red dashed circle + XX label) for 3-edge incenters. **Auto-refresh pitfall:** the visualizer auto-refresh resets `boundaryIdx` to 0 via `populate()`. Always save the boundary selection via `saved.boundaryName` with the disambiguated label (e.g. `3284-Boundary #2`) before auto-refresh fires, or Tim can't see the boundary he selected. **Cap-fill heads now pick the catalog radius closest to the inradius** (not the dominant perimeter radius) so the throw circle is approximately tangent to 3 edges — Tim: the radius that they've got is way too big. See `references/boundary-layout-meander-engine.md` § Visualizer rendering and § Cap-fill head radius.

When investigating drawing-switch crashes or freezes (issues #526/#527, #684), see **`references/drawing-switch-crashes.md`** for the repro drawings (Aurora Animal Shelter, Taft Ridge F1), root-cause analysis (ExecutionEngineException from MLeader style init, terrain settings synchronous rebuild), the fix that was applied, Loki crash evidence from Jul 24 (SABINE/teva, transaction disposal variant), and where to search for crash reports from team members.

When investigating AutoCAD save errors ("An error occurred during save — run RECOVER") or "*Warning* Multiply owned object" messages, see **`references/save-corruption-investigation.md`** for the confirmed root cause (`ClearNamedDictionary` orphaning DBDictionary objects via `Remove` without `Erase` — `NODHelper.cs:47-64`), the three log sources (debug.log, crashlog.json, Serilog buffer), the Raindrop code paths that can cause save corruption (`BeginSave` NOD handler at `SettingsDictionaryFactory.cs:75`, `SaveIrrigationSettings` on deactivation, XData >255 char limit), environmental factors (Dropbox), and the investigation workflow including `entget(handent)` diagnosis commands.

When investigating the boundary polyline `eFilerError` corruption pattern (polylines discarded by RECOVER after Enki ran `layout-boundary-commit`), see **`references/boundary-tagging-corruption-2026-08-13.md`** for the RECOVER output, the timeline of when the `RD_SPRINKLER_BOUNDARY` tagging code was introduced (commit `4b88934e`, July 30), why the XData write path is probably NOT the cause (same path used by every entity), and what still needs investigation.

When querying the Raindrop Loki logging server (`logging.raindropirrigationsoftware.com`) for crash data, user activity, or any log analysis, see **`references/loki-query-guide.md`** for the API key location (`~/.claude/.env`), the `X-API-Key` header auth, LogQL query patterns, log entry field structure, user identity resolution (license key suffix vs personal name), and Python/curl query examples.

When running the `pr-review-toolkit` skill for a Raindrop PR, always include the repo path (`C:\Users\tim\Raindrop`), branch name, and what the changes do in the subagent context. For C# transaction/XData/Active.* code, the **code-reviewer** agent is the highest-signal reviewer — it traces transitive `Active.*` dependencies and verifies that "captured into a local" ≠ "received from caller". The `silent-failure-hunter` is secondary. Always dispatch both. Subagent summaries are truncated in the parent; read the full `subagent-summary-*.txt` files from `cache/delegation/` before aggregating. When the user says "fix all of them" after seeing the aggregated report, fix everything — don't ask which findings to address individually.

For the **verify-before-flag review technique** that minimizes false positives on Raindrop PRs (especially the `Active.*` drift class where the diff *looks* like it captured `db` everywhere but a live read of helper bodies shows it didn't — e.g. `GetTextStyleID` reading `Active.Database` into a local, not receiving the caller's `db`), see **`references/high-precision-verification.md`** — covers the 9-step workflow (parallel input reads, symbol verification, live-file reads vs diff context, `cat -A` whitespace inspection, `git show` parent comparison, transitive `Active.*` dependency tracing, repo-wide dead-code confirmation, **surviving-line indentation drift after method removal** (step 8), **dangling XML doc references after symbol removal** (step 9)), the file-local-vs-repo style rule, and the Windows/MSYS `search_files` path caveat.

For the full findings from the first `pr-review-toolkit` run (issue #694, 6 agents, 2 criticals + 4 warnings + 6 suggestions, **all fixed in commit 2039446c**), see **`references/pr-review-694-findings.md`** — includes which agent found each issue, agent performance notes, and the `PersistArcState` shared-helper pattern that emerged from the code-simplifier's suggestion.

For the **test-coverage-review technique** used when reviewing a PR whose changes are entirely in CAD-runtime/Document-Database threading code and no test files changed, see **`references/pr-test-coverage-review.md`** — covers the 4-step assessment pipeline (diff the changed-files list → confirm no existing test covers changed methods → inspect the test infrastructure for mocking → map each changed method to its testable surface), the 4-tier report format (`CRITICAL`/`WARNING`/`SUGGESTION`/`POSITIVE` with `[file:line]` citations), the specific edge-case hotspots for `Active.*`-drift fixes (null-Document paths through `GetDocument`, `SaveToDrawing(null)`, overload delegation contracts, lock-skip via null-conditional), and how to communicate the coverage cliff given the project's no-mock test constraint.

For the dead-code audit of `src/raindrop/Property Wrappers/` (issue #654 — all 10 files DEAD-REMOVE, superseded by `ViewModels/Collections/`), see **`references/property-wrappers-audit.md`** — includes the full audit table (class, references, live/dead, carried-forward properties, verdict), per-file notes, the open PumpType/PumpPower/PumpID feature-gap caveat, and the reusable audit technique.

When creating non-printing transient visual layers (paint-brush circles, arc previews, uniformity overlays), see **`references/transient-visual-layers.md`** for the `IrrigationLayerPrefix + suffix` + `Layers.MakeLayer(name, color, false)` convention and the existing instances to copy.

When cutting a production release (DEV → master PR with CI-driven build/sign/deploy), see **`references/production-release.md`** for the full 4-phase process: prep on DEV (stale-command cleanup, release notes, updater config, version re-stamp), open the PR, merge triggers automated deploy (Cloudflare R2 prod channel + GitHub Release), and post-merge verification. Includes the UTC version-stamp timing trap, the dual release-notes surfaces, the PR #596 template, and the prior-cycle stale-command cleanup pattern.

When building an analysis or reporting feature that needs per-zone irrigated area, plant type, water volume, or the existing report/export patterns (Runtime Schedule, Quantities Palette, Uniformity palette — what to copy for a new WPF analysis panel + Excel/TSV export), see **`references/domain-model-analysis-data.md`** — the zone data model (`ControlValve`: Area, PlantType, RequiredDepth, DesignDemand, ApplicationRate, RunTime), how `WeightedAreaSolver` computes per-valve area, how Uniformity computes per-zone volume in gallons, what's free-form vs. controlled vocabulary (PlantType is free-form), and the greenfield gaps for agronomic / water-budget / nitrogen-loading features (no annual volume, no TIN, no vegetation-type mapping, no CDPHE Table 1 — all additive).

**Critical:** The plugin currently ships with Keygen admin credentials hardcoded in the DLL (issue #578). Do not rotate the Keygen password until the admin-cred-free version ships. The licensing overhaul is tracked across issues #434, #578, #579, with the full design doc in the Personal vault at `D:\Vaults\Personal\Plans\hey-i-want-yo-delegated-breeze.md`.
