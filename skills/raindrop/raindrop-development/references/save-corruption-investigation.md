# Save Corruption Investigation — "An error occurred during save. Run RECOVER."

> Investigating AutoCAD's save warning: "An error occurred during save. We recommend that you run RECOVER on the drawing."
> Researched: 2026-08-07

## The error

AutoCAD shows a native dialog: *"Warning: An error occurred during save. We recommend that you run RECOVER on the drawing."* This is an AutoCAD-level warning, not a Raindrop exception — it does NOT appear in Serilog logs or debug.log. It fires when AutoCAD's save process detects database corruption or an exception during serialization.

## Log sources (three, all separate)

| Source | Path | What it captures | Limitations |
|--------|------|-------------------|-------------|
| debug.log | `Documents\Raindrop\Logs\debug.log` | `Debug.WriteLine` output | **Empty in Release builds** — `[Conditional("DEBUG")]` strips all calls. Header-only file. |
| crashlog.json | `%AppData%\Raindrop\crashlog.json` | `CrashLogPersister` crash dumps | Only written on actual crashes (unhandled exceptions), not save warnings. |
| Serilog buffer | `%AppData%\Roaming\Raindrop\logs\raindropautocad25-buffer-YYYYMMDD.json` | High-level events: load/unload, commands, save-settings, license checks | **Does NOT capture AutoCAD-native warnings.** Only Raindrop-logged events. One JSON object per line (newline-delimited). |

**None of these will contain the save warning.** The warning is AutoCAD-internal. The Serilog logs can only show what Raindrop was doing *around the time* of the save (which commands fired, which drawings were opened/switched).

## Reading Serilog buffer logs

```bash
# Most recent logs (files are dated, one per day)
ls -lat "$APPDATA/Raindrop/logs/"

# Read a day's log (one JSON object per line, not a JSON array)
cat "$APPDATA/Raindrop/logs/raindropautocad25-buffer-20251009.json"

# Fields per entry: @timestamp, level, messageTemplate, message, fields{AppName, AppVersion, BuildConfiguration, EnvironmentUserName, MachineName, ...}
# Levels: Information, Error, Warning
# Look for: rapid drawing switches (multiple InitializeIrrigationDrawing in quick succession),
#   Save Settings events, Error-level entries
```

## Raindrop code paths that can cause save corruption

### 0. ClearNamedDictionary orphaning DBDictionary objects (CONFIRMED ROOT CAUSE — Aug 7, 2026)

**This is the confirmed root cause when "multiply owned object" warnings accompany the save error.** Tim reported `*Warning* Multiply owned object, handle "1A20"` etc. on a drawing containing only valves and mainlines. `entget(handent "1A20")` confirmed the handles are `DICTIONARY` entities — not MLeader or MText objects.

**The bug:** `NODHelper.ClearNamedDictionary` (`NODHelper.cs:47-64`) calls `nod.Remove(dictionaryName)` **without `Erase()`-ing the old dictionary**:

```csharp
if (nod.Contains(dictionaryName))
{
    nod.Remove(dictionaryName);    // ← unparents the old dict, does NOT erase it
}
DBDictionary dictionary = new DBDictionary();
nod.SetAt(dictionaryName, dictionary);  // new dict takes the name slot
tr.AddNewlyCreatedDBObject(dictionary, true);
```

Per Autodesk's Artc2 on the .NET forum: *"The remove method on a dictionary simply removes that key/objectId pair... But that object is still in the Database — it just no longer has an owner."*

The old dictionary becomes an **orphan** — still in the database with valid ObjectIds, still holding its Xrecord children. Its children can get cross-linked to a new dictionary via `SetAt`, giving them two owners → "multiply owned object" on save.

**Critical:** AUDIT and RECOVER do NOT fix multiply-owned objects (per Autodesk's support article). The only fix is `(entdel(handent "1A20"))` for each handle. RECOVER doesn't erase orphaned objects — they survive and accumulate.

**Same bug pattern in other locations:**
- `NODHelper.cs:34` — `SetNamedDictionary` also does `nod.Remove(dictionaryName)` without erasing
- `HydraulicLogStorage.cs:70` — `logDict.Remove(item.Key)` on existing Xrecords without erasing them before re-adding

**Who calls ClearNamedDictionary (frequency):**
- `SettingsFactory.cs:184` — `SaveSettingsToDwgDictionary` on **every** `SaveToDrawing`, which fires from `SaveIrrigationSettings` (`AID_Application.cs:876`) on **every** `DocumentBecamedInactive` (line 851) — i.e., every drawing switch
- `PipeFactory.cs:375,392`, `SprinklerFactory.cs:403`, `Forms/SprinklerForm.cs:344`, `SprinklersSettingsViewModel.cs:311`, `ValvesSettingsViewModel.cs:160`

**Fix pattern (not yet implemented):** Before `nod.Remove(dictionaryName)`, open the old dictionary for write, iterate its entries, `Erase()` each Xrecord, then `Erase()` the dictionary itself:

```csharp
if (nod.Contains(dictionaryName))
{
    var oldDict = (DBDictionary)tr.GetObject(nod.GetAt(dictionaryName), OpenMode.ForWrite);
    foreach (DBDictionaryEntry entry in oldDict)
    {
        var obj = tr.GetObject(entry.Value, OpenMode.ForWrite);
        obj.Erase();
    }
    oldDict.Erase();
    nod.Remove(dictionaryName);
}
```

Same for `HydraulicLogStorage` — `Erase()` each old Xrecord before `Remove()`.

**Diagnosing a live drawing:**
```bash
# In AutoCAD command line, check what the multiply-owned handle is:
(entget(handent "1A20"))
# If (0 . "DICTIONARY") → it's a NOD sub-dictionary, confirming this bug
# If (0 . "MTEXT") or other → different cause (MLeader/MText ownership, see below)

# Delete each orphaned dictionary handle:
(entdel(handent "1A20"))
(entdel(handent "1A44"))
# Then AUDIT → fix errors → save
```

### 1. BeginSave handler writing NOD during save (SECONDARY)

`SettingsDictionaryFactory.cs:75`:
```csharp
doc.Database.BeginSave += (sender, e) => FlushWrittenToNod((Database)sender, cache);
```

`FlushWrittenToNod` (line 134) writes cached settings to the NOD via `NOD_Helper.AddXrecordToNamedDictionary(db, ...)`, which **starts a new transaction inside the BeginSave event** — modifying the database while AutoCAD is serializing it to disk.

The code explicitly acknowledges this risk (line 136):
> "The catch is mandatory: an exception escaping a BeginSave handler can abort or corrupt the save."

Failure modes:
- **doc is null** (line 159-167): if the database isn't in `DocumentManager` (e.g. during close), `using (doc?.LockDocument())` becomes a no-op → NOD write without a lock → `eLockViolation` caught but save may be corrupted.
- **Nested transaction during save**: `AddXrecordToNamedDictionary` starts its own transaction (line 108). A transaction during `BeginSave` modifies the DB mid-serialization — AutoCAD may detect this as corruption.
- The `catch` at line 176 calls `CaptureErrorQuietly` (logs to Serilog) — so if this path DOES fail, you'd see an Error-level entry in the Serilog buffer log around the same timestamp as the save warning.

### 2. SaveIrrigationSettings on document deactivation (COMPOUNDING FACTOR)

`AID_Application.cs:851` calls `SaveIrrigationSettings(e.Document)` on `DocumentBecameInactive`. This fires three NOD-write operations:
- `SettingsFactory.Settings.SaveToDrawing(doc)` — serializes settings to JSON, splits into 4000-char chunks, writes to NOD
- `HydraulicLogStorage.SaveCurrentLogsToDrawing(doc)`
- `BoundaryStorageService.SaveAllBoundaries(doc)` — writes boundary ObjectId handles to NOD

If deactivation fires while AutoCAD is also saving (or during rapid drawing switches), these NOD writes can collide with the save.

### 3. XData string > 255 chars → AUDIT corruption on save

`XData.cs:680-695`: The DXF 255-char limit for group-code-1000 strings. `WriteString` only warns via `Debug.WriteLine` (stripped in Release). If any XData write path sends a >255 char string without `ChunkedStringXData`, AUDIT detects corruption on the next save → RECOVER warning.

**This is a silent corruption path in Release builds** — the warning is stripped, the write succeeds, and the corruption is only detected by AutoCAD's AUDIT during save.

Callers using `ChunkedStringXData` are safe. Callers using `WriteString` with potentially long values are at risk. The `SettingsFactory.SaveSettingsToDwgDictionary` path splits at 4000 chars (well over 255), but writes to NOD xrecords (DxfCode.Text), not entity XData — different limit applies there.

### 4. SaveAs to older DwgVersion (known AutoCAD bug)

`SettingsViewModel.cs:397`:
```csharp
defaultDb.SaveAs(tempPath, DwgVersion.Current);
```

Per the Autodesk .NET forum: saving to an older DwgVersion via .NET `Database.SaveAs()` is a known AutoCAD bug that corrupts the DWG. `DwgVersion.Current` should be safe, but if this was ever changed to target an older format it would trigger the warning. Only used in `SaveAsDefault`, not regular saves.

## Environmental factors

- **Dropbox drawings**: All TIE drawings are on `D:\Dropbox\TIE\...`. Dropbox sync conflicts can corrupt DWG files if the file is synced while AutoCAD has it open. AutoCAD's lock file may not prevent Dropbox from syncing the DWG.
- **Rapid drawing switches**: Serilog logs show multiple `InitializeIrrigationDrawing` + `Opened Raindrop DWG` events in quick succession — this is the pattern that stresses the BeginSave/deactivation paths.

## Autodesk's official causes (non-plugin)

Per Autodesk support article:
- Drawing corruption from migrated templates, styles, blocks
- Proxy objects from other applications (Civil 3D enablers)
- File format mismatches
- These are generic — the plugin-specific causes above are more likely if the error only happens with Raindrop drawings.

## Investigation workflow

1. **Check Serilog buffer logs** at `%AppData%\Roaming\Raindrop\logs\` for Error-level entries around the time of the save warning — specifically `CaptureErrorQuietly` output from `FlushWrittenToNod`.
2. **Check if the drawing is on Dropbox** — try copying to a local path, working there, and saving. If the warning disappears, it's Dropbox.
3. **Run RECOVER on the drawing** — if it reports specific objects/entities, check those entities' XData for >255 char strings via the debug bridge (`xdata --handle <h>`).
4. **Test with a new blank drawing** — if the warning only appears on drawings Raindrop has touched, it's plugin-related. If it appears on all drawings, it's AutoCAD/template corruption.
5. **Check BuildConfiguration in Serilog logs** — Release builds strip `Debug.WriteLine`, so the 255-char XData warning is invisible. DEBUG builds will show it in VS Output if attached.
