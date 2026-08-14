# Drawing-Switch Crash & Freeze Investigation

## Issues

| Issue | State | Summary |
|-------|-------|---------|
| #526 | CLOSED | "Switching Drawings may be causing crashes" — initial report |
| #527 | CLOSED | Full fix plan: drawing init safety, document-handler hardening, wrapper-disposal leaks |
| #684 | OPEN | Opening a drawing with terrain contour layers freezes AutoCAD for minutes (hang, not crash) |
| #705 | CLOSED | Transaction disposal crash during rapid drawing switch — `Active.*` singleton drift via async `SendStringToExecute` (Jul 24, 2026). **Fix merged Jul 30, 2026** — PR #705 merged to DEV, BricsCAD build fix included. |

## #526/#527 — Drawing-Switch Crash (FIXED, but incomplete)

**Root cause (original):** `ExecutionEngineException` (HRESULT 0x80131506) during `TransactionManager.FlushGraphics()` ← `GetMLeaderStyleID()` ← `InitializeIrrigationDrawing()` which fired on every `DocumentActivated`. `GetMLeaderStyleID` unconditionally re-opened the MLeader style `ForWrite` even when values already matched, triggering `FlushGraphics` which walked every MLeader dependent — in a freshly-activated drawing whose entities weren't settled, that dereferenced a stale native pointer.

**Contributing factors:** `BoundaryStorageService`, `HydraulicLogStorage`, and `SettingsFactory` all read `Active.Database` / `MdiActiveDocument.Database` from inside deactivation handlers where those pointers drift mid-switch. Document locks acquired *after* starting transactions. `ViewTableRecord`, `MText`, and `DBDictionary` wrapper leaks.

**Repro drawings:**
- `D:\Dropbox\TIE\RVi Planning\Aurora Animal Shelter\drawings\I-AnimalShelter.dwg`
- `D:\Dropbox\TIE\RVi Planning\Aurora Animal Shelter\drawings\P-AnimalShelter.dwg`

Repro: rapidly switch between them (Ctrl+Tab or clicking tabs) 20+ times in 30 seconds.

**Fix applied (issue #527, PR #528, merged Apr 24, shipped v2026.5.11):**
1. Moved `InitializeIrrigationDrawing` from `DocumentActivated` → `DocumentCreated` (fires once per drawing open, not every switch)
2. Made `GetMLeaderStyleID` idempotent — skip `ForWrite`+`Commit` when values already match (avoids `FlushGraphics`)
3. Plumbed explicit `Document` through all deactivation-path saves (BoundaryStorageService, HydraulicLogStorage, SettingsFactory) — no more `Active.*` drift in deactivation
4. Added `using` dispose for leaked wrappers (`ViewTableRecord`, `MText` ×4 sites, `DBDictionary`)
5. Fixed `NODHelper.GetNamedDictionary` zombie-wrapper bug (was returning `DBDictionary` bound to an uncommitted/aborted transaction)

**What the fix did NOT cover:** `GetMLeaderStyleID` and `EditorSelection.GetFromModelSpace` still read `Active.TransactionManager` / `Active.Database` at call time. The fix addressed the *symptom* (FlushGraphics re-entry + deactivation handler drift) but not the *root cause* (Active.* singleton drift during async command execution). See "Jul 24 crash" below.

## Jul 24, 2026 — Transaction Disposal Crash (FIXED Jul 30, 2026)

**Loki evidence:** 4 critical-level crash events on Jul 24, 2026 from user `teva` on machine `SABINE`, license suffix `240ECA-V3`, running Raindrop `2026.7.22.30949` (Release build, AutoCAD 2025). Version `2026.7.22` is well after the #527 fix shipped in `v2026.5.11` (May 11) — the fix was live for 2+ months.

| Time (UTC) | Exception | IsTerminating | Drawing |
|-----------|-----------|--------------|---------|
| 17:06:02 | `System.InvalidOperationException` — "Operation is not valid due to the current state of the object" | True | I-THF1.dwg |
| 17:19:47 | `System.NullReferenceException` — "Object reference not set to an instance of an object" | True | I-THF1.dwg |

Both crashes share the same 3-frame stack trace (no Raindrop code — GC/finalizer crash):
```
Autodesk.AutoCAD.DatabaseServices.Transaction.CheckTopTransaction()
→ Transaction.DeleteUnmanagedObject()
→ DisposableWrapper.Dispose(Boolean)
```

**Context:** User was rapidly switching between `I-THF1.dwg` and `L-WD-TAFT-RIDGE-F1.dwg` (same Taft Ridge F1 project, `D:\Dropbox\TIE\RVi Planning\Taft Ridge F1\drawings\`). 20+ drawing switches in ~12 minutes, running ERASE, MATCHPROP, COPYBASE/PASTECLIP, HATCH, and Raindrop `FS` commands. First crash at 17:06:02 after ~9 min; user restarted, second crash 13 min later at 17:19:47.

### Root Cause: `Active.*` Singleton Drift During Async Command Execution

The crash path:

1. **`IrrigationDrawingCheck`** (fires on `DocumentCreated`, `AID_Palettes.cs:784`) queues `InitializeIrrigationDrawing` via `SendStringToExecute` with `wrapUpInactiveDoc: false`:
   ```csharp
   e.Document.SendStringToExecute(
       Commands.Internal.InitializeIrrigationDrawing + " ",
       activate: true,
       wrapUpInactiveDoc: false,  // ← command runs even if doc is no longer active
       echoCommand: false);
   ```

2. **`InitializeIrrigationDrawing`** (`AID_Palettes.cs:868`) calls `Styles.InitStyles()` → `GetMLeaderStyleID()` which does:
   ```csharp
   using (Transaction acTr = Active.TransactionManager.StartTransaction())
   //                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   //                       Active.TransactionManager = MdiActiveDocument.TransactionManager
   //                       This is a SINGLETON — it returns whatever document is currently active
   ```
   `Active.TransactionManager` is defined as `Document?.TransactionManager` where `Document` = `MdiActiveDocument` (`Active.cs:59-61`).

3. **User switches drawings** while the async `InitializeIrrigationDrawing` command from the first drawing is still mid-execution. `Active.Database` / `Active.TransactionManager` now points to the **new** drawing.

4. The `using` block disposes the transaction. But that transaction was started on the **old** database's transaction manager, which is now in a deactivated/inconsistent state. `CheckTopTransaction()` throws → **crash** (InvalidOperationException or NullReferenceException depending on timing).

### Why the #527 fix didn't catch this

The #527 fix:
- ✅ Hardened deactivation handlers (pass `e.Document` not `Active.*`) — deactivation path is safe
- ✅ Made `GetMLeaderStyleID` idempotent (skip `ForWrite` when values match) — avoids `FlushGraphics`
- ❌ Did NOT fix `GetMLeaderStyleID` using `Active.TransactionManager` — the transaction is still started on the **singleton** active document, not the document that triggered the init
- ❌ Did NOT fix `EditorSelection.GetFromModelSpace` using `Active.Database` — same singleton drift
- ❌ Did NOT address `SendStringToExecute` with `wrapUpInactiveDoc: false` — the async command can outlive the document's active state

### Corroborating evidence: `eLockChangeInProgress` errors

Loki also shows `eLockChangeInProgress` errors from `RefreshPaletteVisibility` → `IsIrrigationDrawing` → `LockDocument()` during `DocumentBecameCurrent` (from a different user, `DESKTOP-S919RJO\PC GAMER`, same version `2026.7.1`):
```
Document.LockDocument()
→ RaindropPalettes.IsIrrigationDrawing()
→ RaindropPalettes.RefreshPaletteVisibility()
→ AID_Application.DocManager_DocumentBecameCurrent
```
This confirms the lock/transaction layer is unstable during rapid drawing switches — `LockDocument()` throws because AutoCAD is still mid-switch.

### Fix (IMPLEMENTED Jul 30, 2026, PR #705 — MERGED to DEV)

PR: https://github.com/timgrote/Raindrop/pull/705 (branch `fix/active-singleton-drift-drawing-switch`, merged to `DEV` Jul 30, 2026)

The fix captures `Document`/`Database` at entry and threads it through every downstream call, so `Active.*` drift during async `SendStringToExecute` execution can't cause a transaction to be disposed against the wrong database.

**Pattern:**
```csharp
// In GetMLeaderStyleID (Styles.cs):
var db = Active.Database;  // Capture once at entry
using (Transaction acTr = db.TransactionManager.StartTransaction())
//                       ^^^ — captured db, not Active.TransactionManager
```

Same principle as the #527 fix applied to deactivation handlers — pass `Document` through explicitly — but extended to the **activation/init** path.

**Files changed (6):**

1. **`CAD Utility/Styles.cs`** — `InitStyles(Document)`, `GetMLeaderStyleID(Database, ...)` overloads. The **MLeader** path (`GetMLeaderStyleID`, `CloneMLeaderStyle`) fully threads the captured `db` — that was the crash site and is now safe. `GetTextStyleID` was refactored to capture `var db = Active.Database` into a local (cleaner, but still reads `Active.Database`, not a caller-passed database). **The text-style path (`GetActiveTextStyleID` → `GetTextStyleID`) is NOT threaded** — see "Incomplete fix — text-style path" below. `GetMLeaderStyleFromDWG` is now dead code (no callers repo-wide).
2. **`Palettes/AID_Palettes.cs`** — `InitializeIrrigationDrawing()` captures `Document doc = Active.Document` at entry, threads to `IsIrrigationDrawing(doc)`, `RefreshPaletteVisibility(doc)`, `Styles.InitStyles(doc)`, `ValveFactory.EnsureMasterValvesImported(doc)`, `SprinklerFactory.EnsureSeriesSprinklersImported(doc)`. Added `RefreshPaletteVisibility(Document)` and `IsIrrigationDrawing(Document)` overloads.
3. **`CAD Utility/EditorSelection.cs`** — `GetFromModelSpace(Database, ...)` overload added.
4. **`Settings/SettingsFactory.cs`** — `InitializeSettings(Database)`, `LoadSettings(Database)`, `IsDictionaryExist(Database)` overloads. `GetSettingsFromDictionary` now uses `Active.GetDocument(db)?.LockDocument()` instead of `Active.Document.LockDocument()`.
5. **`Factories/ValveFactory.cs`** — `EnsureMasterValvesImported(Document)` overload. Added `ApplicationServices` using.
6. **`Factories/SprinklerFactory.cs`** — `EnsureSeriesSprinklersImported(Document)` overload. Added `ApplicationServices` using.

All changes are additive (new overloads; parameterless overloads delegate to the explicit ones with `Active.*`, so existing callers are unaffected). Build: `dotnet build AutoCAD25_Debug` → 0 errors.

**Suggested commits:**
1. `fix(styles): GetMLeaderStyleID and CloneMLeaderStyle accept Database parameter`
2. `fix(palettes): InitializeIrrigationDrawing captures Document at entry, threads through`
3. `fix(factories): EnsureMasterValvesImported/EnsureSeriesSprinklersImported accept Document`
4. `fix(settings): SettingsFactory.InitializeSettings accepts Database parameter`
5. `fix(editor-selection): GetFromModelSpace accepts Database parameter`

**Not yet addressed:** `wrapUpInactiveDoc: false` in `IrrigationDrawingCheck`'s `SendStringToExecute` call — the async command can still outlive the document's active state. The capture-at-entry fix prevents the crash, but the command still runs against a non-active document. Changing to `wrapUpInactiveDoc: true` may be a future optimization (skips init if the user has already moved to another drawing).

### Full Active.* audit (Jul 30, 2026)

Every `Active.*` reference in the `InitializeIrrigationDrawing` call chain, classified:
- **UNSAFE**: reads `Active.*` at execution time — drifts if document switches mid-call
- **SAFE**: captures `Active.*` into a local before use, or receives `Document`/`Database` as a parameter

| File | Line | Method | Expression | Classification |
|------|------|--------|------------|----------------|
| **Path 1: InitializeIrrigationDrawing** | | | | |
| AID_Palettes.cs | 870 | InitializeIrrigationDrawing | `Active.Document == null` | UNSAFE — guard, drifts after |
| AID_Palettes.cs | 872 | InitializeIrrigationDrawing | `IsIrrigationDrawing()` | UNSAFE — calls Active.Document.LockDocument() |
| AID_Palettes.cs | 877 | InitializeIrrigationDrawing | `Active.Document.Name` | UNSAFE |
| AID_Palettes.cs | 884 | InitializeIrrigationDrawing | `RefreshPaletteVisibility()` | UNSAFE — see Path 2 |
| AID_Palettes.cs | 890 | InitializeIrrigationDrawing | `Styles.InitStyles()` | UNSAFE — see Path 3 |
| AID_Palettes.cs | 895 | InitializeIrrigationDrawing | `ValveFactory.EnsureMasterValvesImported()` | UNSAFE — Active.Document/Database |
| AID_Palettes.cs | 897 | InitializeIrrigationDrawing | `SprinklerFactory.EnsureSeriesSprinklersImported()` | UNSAFE — Active.Document/Database |
| **Path 2: RefreshPaletteVisibility** | | | | |
| AID_Palettes.cs | 803 | RefreshPaletteVisibility | `Active.Document == null` | UNSAFE |
| AID_Palettes.cs | 809 | RefreshPaletteVisibility | `IsIrrigationDrawing()` | UNSAFE |
| AID_Palettes.cs | 822 | RefreshPaletteVisibility | `SettingsFactory.InitializeSettings()` | UNSAFE — Active.Database |
| AID_Palettes.cs | 823 | RefreshPaletteVisibility | `HydraulicLogStorage.LoadLogsFromDrawing(Active.Document)` | UNSAFE |
| AID_Palettes.cs | 824 | RefreshPaletteVisibility | `BoundaryStorageService.LoadAllBoundaries(Active.Document)` | UNSAFE |
| **Path 2a: IsIrrigationDrawing** | | | | |
| AID_Palettes.cs | 1058 | IsIrrigationDrawing | `Active.Document == null` | UNSAFE |
| AID_Palettes.cs | 1067 | IsIrrigationDrawing | `Active.Document.LockDocument()` | **CRITICAL — UNSAFE** |
| AID_Palettes.cs | 1069 | IsIrrigationDrawing | `EditorSelection.GetFromModelSpace(...)` | UNSAFE (but EditorSelection captures db internally — see Path 4) |
| **Path 3: InitStyles → GetMLeaderStyleID** | | | | |
| Styles.cs | 76 | InitStyles | `Active.Document == null` | UNSAFE |
| Styles.cs | 78 | InitStyles | `Active.Document.LockDocument()` | **CRITICAL — UNSAFE** |
| Styles.cs | 190 | GetMLeaderStyleID | `Active.TransactionManager.StartTransaction()` | **CRASH SITE — CRITICAL** |
| Styles.cs | 193 | GetMLeaderStyleID | `Active.Database.MLeaderStyleDictionaryId` | **CRITICAL** |
| Styles.cs | 251 | GetMLeaderStyleID | `CloneMLeaderStyle(Active.Database, ...)` | UNSAFE |
| Styles.cs | 308 | CloneMLeaderStyle | `Active.Database.TransactionManager.StartTransaction()` | **CRITICAL** |
| Styles.cs | 311 | CloneMLeaderStyle | `Active.Database.WblockCloneObjects(...)` | **CRITICAL** |
| Styles.cs | 315/319 | CloneMLeaderStyle | `Active.Database.MLeaderStyleDictionaryId` / `PostMLeaderStyleToDb(Active.Database)` | **CRITICAL** |
| **Path 4: EditorSelection.GetFromModelSpace** | | | | |
| EditorSelection.cs | 36 | GetFromModelSpace | `var db = Active.Database` | SAFE — captured into local |
| EditorSelection.cs | 38 | GetFromModelSpace | `db.TransactionManager.StartTransaction()` | SAFE — uses captured db |
| **Path 5: SettingsFactory** | | | | |
| SettingsFactory.cs | 60 | GetSettings | `GetSettingsFromDictionary(Active.Database)` | UNSAFE |
| SettingsFactory.cs | 194 | GetSettingsFromDictionary | `Active.Document.LockDocument()` | **CRITICAL** |
| SettingsFactory.cs | 196 | GetSettingsFromDictionary | `Active.Database.TransactionManager.StartTransaction()` | **CRITICAL** |
| **Path 6: ValveFactory.EnsureMasterValvesImported** | | | | |
| ValveFactory.cs | 357 | EnsureMasterValvesImported | `Active.Document == null` | UNSAFE |
| ValveFactory.cs | 360 | EnsureMasterValvesImported | `ReadDBValves(Active.Database)` | UNSAFE |
| ValveFactory.cs | 366 | EnsureMasterValvesImported | `Active.Document.LockDocument()` | **CRITICAL** |
| **Path 7: SprinklerFactory.EnsureSeriesSprinklersImported** | | | | |
| SprinklerFactory.cs | 253 | EnsureSeriesSprinklersImported | `Active.Document == null` | UNSAFE |
| SprinklerFactory.cs | 254 | EnsureSeriesSprinklersImported | `ReadDBSprinklers(Active.Database)` | UNSAFE |
| SprinklerFactory.cs | 270 | EnsureSeriesSprinklersImported | `Active.Document.LockDocument()` | **CRITICAL** |
| **Path 8: NODHelper** | | | | |
| NODHelper.cs | 273 | AddXrecordToNamedDictionary(db) | `Active.GetDocument(db)?.LockDocument()` | SAFE — locks doc that owns db |
| NODHelper.cs | 389 | AddXrecordToNamedDictionary(db) | `Active.Database.TransactionManager.StartTransaction()` | **BUG — receives db param but uses Active.Database** |
| NODHelper.cs | 391 | AddXrecordToNamedDictionary(db) | `Active.Database.NamedObjectsDictionaryId` | **BUG — should use db.NamedObjectsDictionaryId** |
| NODHelper.cs | 346 | ClearNamedDictionary(db) | `Active.Document.LockDocument()` | UNSAFE — should use GetDocument(db) |

### NODHelper bug (separate from drift)

`NODHelper.AddXrecordToNamedDictionary(Database db, ...)` receives a `Database` parameter but uses `Active.Database` for `TransactionManager` and `NamedObjectsDictionaryId`. This is a **genuine bug**, not just a drift risk — it can write to the wrong database's NOD even without a drawing switch. The fix is to use the passed-in `db` parameter: `db.TransactionManager.StartTransaction()` and `db.NamedObjectsDictionaryId`.

### Fix plan

A detailed 6-phase fix plan with suggested commits is at:
`docs/superpowers/plans/2026-07-30-active-singleton-drift-fix.md` (in the Raindrop repo)

Phase 1: `InitializeIrrigationDrawing` — capture `Document` at entry, thread through
Phase 2: `GetMLeaderStyleID` / `CloneMLeaderStyle` — accept `Database` parameter (crash site)
Phase 3: `EditorSelection.GetFromModelSpace` — already safe, add explicit-database overload
Phase 4: `NODHelper.AddXrecordToNamedDictionary` — fix bug: use passed-in `db`, not `Active.Database`
Phase 5: `ValveFactory` / `SprinklerFactory` — add `Document`-accepting overloads
Phase 6: `SettingsFactory` — add `Document`-accepting overload

All changes are additive (new overloads, existing callers unaffected).

### Incomplete fix — text-style path (PR review, Jul 30, 2026)

The Jul 30 fix is **not fully complete**. A high-precision review of the diff
(`pr-review-toolkit` code-reviewer agent style — verify every symbol before
flagging) found two gaps where `Active.*` drift can still occur, plus one
indentation regression. These are **PR review findings**, not yet fixed.

**GAP 1 — `InitStyles(Document doc)` text-style branch still uses `Active.Database`** (WARNING):
`InitStyles(doc)` captures `db = doc.Database` and locks `doc`, then calls:
- `GetMLeaderStyleID(db, ...)` → correctly threaded → safe ✅
- `GetActiveTextStyleID(AID_Strings.BlockTextStyle)` / `GetActiveTextStyleID(AID_Strings.PipeSizeTextStyle)` → routes to `GetTextStyleID` (Styles.cs:54) which does `Database db = Active.Database` (Styles.cs:57) → **NOT the captured `db`** ❌

So the MLeader path was fixed but the **TextStyle path was not**. During a rapid switch the `TextStyleTable` scan can run against the wrong database. Fix: add `Database`-explicit overloads of `GetActiveTextStyleID`/`GetTextStyleID` and pass `db` through, mirroring the `GetMLeaderStyleID` pattern.

Note the misleading subtlety: `GetTextStyleID` *was* refactored in the diff to read `Database db = Active.Database` (capturing into a local). That looks like the fix but isn't — it still reads `Active.Database` at call time. "Captured into a local" ≠ "received from caller." This is exactly the distinction a careful reviewer must verify, not assume from the diff's appearance.

**GAP 2 — transitive `Active.*` lock mismatch in factory overloads** (WARNING):
`EnsureSeriesSprinklersImported(Document doc)` and `EnsureMasterValvesImported(Document doc)` lock `doc.LockDocument()`, then call:
- `MakeSprinklerBlock(spk, silent: true)` — internally re-locks `Active.Document` / uses `Active.Database`
- `Active.AddXrecordToNamedDictionary(...)` (SprinklerFactory.cs:301) — uses `Active.Document.LockDocument()` + `Active.Database` (Active.cs:149)

If `Active.Document` has drifted, the inner `Active.Document.LockDocument()` locks a **different** document than the outer `doc.LockDocument()`, and the XRecord write lands on the wrong database. The helper bodies are unchanged code (out of diff scope), but the new overload *introduces a call-site contract* that reaches them under a mismatched lock — that's in scope. The entry-point capture is correct; the transitive dependency is not threaded. Partial fix.

**GAP 3 — indentation regression in `SprinklerFactory.cs:279-308`** (WARNING, cosmetic, **FIXED post-review**):
The re-indent that removed the outer `using (Active.Document.LockDocument())` wrapper left the inner `using (doc.LockDocument())` block (lines 279-308) indented with **one extra tab** (4 tabs) vs. its method-body siblings (3 tabs, e.g. `Database db` at line 262). The content should have shifted left one tab but the `using` line gained a tab instead. Compiles fine (C# ignores whitespace) but violates the file's tab style. Verified with `sed -n '279p' File.cs | cat -A` (counted `^I` markers: 4 vs 3). **Fixed in the same commit before pushing** — dedented the block one tab level. The stale `// TODO this should only be called from settings form on OK` comment on `InitStyles()` was also removed.

**Dead code surfaced:** `GetMLeaderStyleFromDWG` (Styles.cs:295, uses `Active.Database` at line 322) is now unreferenced repo-wide — the `db`-overload routes through `CloneMLeaderStyle(db,...)` instead. SUGGESTION: delete it so no future contributor revives an `Active.Database`-dependent path. Verified dead with `grep -rn "GetMLeaderStyleFromDWG" . --include="*.cs"` (only hit = its own definition).

**Review technique used (reusable):** The review that found these gaps followed a verify-before-flag workflow — confirm every referenced overload exists (`grep -rn "public static.*GetMLeaderStyleID" --include="*.cs"`), inspect whitespace bytes (`cat -A`), compare against the parent (`git show HEAD:path | sed -n`), and trace transitive `Active.*` dependencies in helpers before declaring a fix complete. The diff *appears* to capture `db` everywhere; only reading the live `GetTextStyleID` body (Styles.cs:57) and the `Active.AddXrecordToNamedDictionary` body (Active.cs:149) revealed the gaps. Full technique: see `references/high-precision-verification.md` in the `requesting-code-review` skill (if adopted) or the same content embedded below.

### Verification (Jul 30, 2026)

**Post-fix test:** Tim ran 38 rapid drawing switches (I-THF1 ↔ L-WD-TAFT-RIDGE-F1, same pair teva crashed on) on debug build `2026.7.30.28586` with zero crashes and zero errors in Loki. Commands: COPYBASE, PASTECLIP, U, DROPGEOM. Performance: switch delays 77-115ms, I-THF1 activation ~500-700ms (IsIrrigationDrawing scan), L-WD ~80-90ms. No eLockChangeInProgress errors. InitializeIrrigationDrawing fired 2 times (once per drawing open) at 349ms and sub-1ms.

**Pre-fix baseline:** Tim ran 100 rapid drawing switches on pre-fix debug build `2026.7.30.12418` with zero crashes — the crash is timing-dependent (race condition), so a clean run on a debug build does not prove the bug is gone. The fix is structural (capture-at-entry), not timing-dependent.

## #684 — Terrain Settings Hang (OPEN)

**Drawing:** `D:\Dropbox\TIE\RVi Planning\Taft Ridge F1\drawings\I-THF1.dwg`

**Symptom:** Opening the drawing freezes AutoCAD for **minutes** (132s per `RefreshPaletteVisibility`, fires twice = ~4.5 min total). Not a crash — main thread is busy rebuilding the elevation model synchronously from `TerrainSettings [OnDeserialized]` callback.

**debug.log evidence:**
```
[13:00:44.180] Command INTERNAL_INITIALIZEIRRIGATIONDRAWING will start.
[13:02:56.432] PERF InitDrawing: RefreshPaletteVisibility=132247ms   <-- 132 s
[13:02:56.492] PERF InitDrawing: SyncTotal=132307ms
```

**Not yet fixed.** The terrain model rebuild should be deferred/lazy-loaded, not done synchronously during drawing init.

## Loki crash evidence summary (Jul 24, 2026 — SABINE/teva)

See `references/loki-query-guide.md` for full query instructions. Key query for crash events:
```logql
{app="raindrop"} |~ "(Unhandled Exception|Recovered crash|IsTermination)" | json
```

**User identity note:** "Ally" (Tim's name for this person) maps to Windows user `teva` on machine `SABINE` (license key suffix `240ECA-V3`). The Loki logs use Windows usernames and license-key suffixes, not personal names — cross-reference via license key or machine name when Tim uses a person's name.

## Searching for crash reports

When Tim mentions a crash from a team member (e.g. "Ally had crashes"), check:
1. **Loki logs** — query crash events with LogQL: `{app="raindrop"} |~ "(Unhandled Exception|Recovered crash|IsTermination)" | json` (see `references/loki-query-guide.md` for full query instructions). Filter by `MachineName` or `UserName` to find the specific user. Note: Loki uses Windows usernames and license-key suffixes, not personal names.
2. GitHub issues: `gh issue list --state all --search "crash drawing switch" --limit 10`
3. Gmail: search `from:<person> crash OR error OR drawing OR freeze`
4. Session history: `session_search` with the person's name + crash keywords

Note: crash reports may come through internal channels (Teams, Slack, verbal) not captured in email or GitHub. If no digital trail exists, ask Tim directly for the drawings and repro steps.

## Version timeline for crash fixes

| Version | Date | What shipped |
|---------|------|-------------|
| `2026.4.22` | Apr 22 | Pre-#527 fix |
| PR #528 merged | Apr 24 | #527 fix (init on DocumentCreated, idempotent MLeader, Document through deactivation) |
| `2026.5.11` | May 11 | First release containing #527 fix |
| `2026.6.1` | May 31 | June release |
| `2026.7.1` | Jun 30 | July release |
| `2026.7.22` | Jul 22 | Version running when SABINE crashed (Jul 24) — #527 fix was live |
| Jul 30 | Jul 30 | `Active.*` singleton drift fix implemented — PR #705 merged to DEV (`fix/active-singleton-drift-drawing-switch`). 6 parallel PR review agents: 0 critical, 0 blocking. 38-switch live test: zero crashes. BricsCAD build fix (missing `using Bricscad.ApplicationServices`) included in the merge commit. Dev release notes updated. Extends #527 fix to activation/init path. |
