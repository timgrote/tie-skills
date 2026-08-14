# Raindrop Debug Bridge Reference

> Reference for troubleshooting live drawings via the in-process HTTP debug bridge.
> Last updated: 2026-07-28

## Overview

The debug bridge is an HTTP server (`localhost:5599`) hosted inside AutoCAD on DEBUG builds only. It provides read-only drawing introspection plus limited editor-driving and write capabilities. It is **the primary tool for troubleshooting a live drawing** — you can inspect real entity XData, counts, and layers without touching code or asking Tim to run commands.

Toggle it in AutoCAD with `RD_DEBUGBRIDGE`. DEBUG builds auto-start it on load.

## Driving the bridge

Use `.claude/actions/cad-bridge.sh` (in the Raindrop repo). It handles curl, JSON formatting, and producer-spec construction.

```bash
# Basic introspection
bash .claude/actions/cad-bridge.sh ping                    # plugin version, drawing name, units, active tab
bash .claude/actions/cad-bridge.sh summary                 # counts: zones, sprinklers, pipes, valves
bash .claude/actions/cad-bridge.sh entities <appName>      # all entities carrying that XData app name
bash .claude/actions/cad-bridge.sh xdata --handle <h>       # full XData dump for one entity
bash .claude/actions/cad-bridge.sh xdata --app <appName>    # XData of every entity with that app
bash .claude/actions/cad-bridge.sh xdata --selected        # XData of current selection

# Inventory and analysis
bash .claude/actions/cad-bridge.sh inventory                # typed counts (whole drawing)
bash .claude/actions/cad-bridge.sh inventory --inside <polyHandle>  # scoped to a boundary
bash .claude/actions/cad-bridge.sh find --selected          # resolve current selection to handles
bash .claude/actions/cad-bridge.sh find --app <appName>     # find by XData app name
bash .claude/actions/cad-bridge.sh find --inside <polyHandle> [--filter <name>]  # window-polygon

# Editor driving (Tier 3)
bash .claude/actions/cad-bridge.sh select <producer>        # set selection (grips + Properties)
bash .claude/actions/cad-bridge.sh zoom <producer>          # frame a collection
bash .claude/actions/cad-bridge.sh show <producer>          # zoom + select
bash .claude/actions/cad-bridge.sh clear                    # empty selection

# Domain queries
bash .claude/actions/cad-bridge.sh zones                   # zone directory: address -> valve handles
bash .claude/actions/cad-bridge.sh orphans [--full]         # unstationed/disconnected valves, orphan sprinklers/laterals
bash .claude/actions/cad-bridge.sh mainline-network        # mainline network summary
bash .claude/actions/cad-bridge.sh objects --type <T> [--where 'Prop>=v'] [--by Prop]  # filtered domain objects

# Layer discovery
curl -s "http://localhost:5599/layers"                       # all layers with entity count + visibility
curl -s "http://localhost:5599/layers?search=boundary"       # fuzzy search by substring
curl -s "http://localhost:5599/layers?prefix=3284"           # filter by prefix

# Pipe layers
bash .claude/actions/cad-bridge.sh run <COMMAND>            # fire a CAD command (e.g. IR_SIZEZONES)
bash .claude/actions/cad-bridge.sh capabilities            # manifest of endpoints/ops/producers/filters
```

Port override: `RD_BRIDGE_PORT=5599` (default). Per-request timeout: `RD_BRIDGE_MAXTIME=60`.

## Debugging workflow

1. **`ping`** — confirm the bridge is running and see which drawing is loaded.
2. **`summary`** — get high-level counts. Compare against what Tim reports (e.g. "I see 0 laterals but the summary shows 758").
3. **`entities <appName>`** — check which entities carry a given XData app name. Pipe to Python to group by layer:
   ```bash
   bash .claude/actions/cad-bridge.sh entities AID_PIPE_ID | python -c "
   import sys, json, collections
   data = json.load(sys.stdin)
   layers = collections.Counter(e['layer'] for e in data['entities'])
   for layer, count in layers.most_common(): print(f'{count:4d}  {layer}')
   "
   ```
4. **`xdata --handle <h>`** — dump full XData on a specific entity to see which app names it carries and what values are stored. This is the key diagnostic: compare what XData an entity *has* vs what the code *filters on*.
5. **Read the code** that builds the selection filter or constructs the inventory, and cross-reference with bridge evidence.

## Writing XData via the bridge (data repair)

The bridge supports writing XData to entities matching a producer. This is a powerful in-place data repair tool — you can fix missing XData tags without rebuilding or touching code. One write = one Ctrl+Z in AutoCAD.

```bash
# Syntax: xdata write <producer> --app <APP> --val <code>=<value> [--val ...]
# Producers: --layer, --app, --set, --handles, --selected, --filter, --zone, etc.

# Write AID_OBJECT marker to all polylines on a layer (type 1070 = int, value 42)
bash .claude/actions/cad-bridge.sh xdata write --layer "3284-Lateral-Sprinkler" --app AID_OBJECT --val 1070=42
bash .claude/actions/cad-bridge.sh xdata write --layer "3284-Lateral-Drip" --app AID_OBJECT --val 1070=42
```

**XData type codes** (DxfCode for XData values):
- `1000` = string
- `1040` = real (double)
- `1070` = 16-bit int
- `1071` = 32-bit int

The `AID_OBJECT` marker is conventionally `{type: 1070, value: 42}` (the "answer to everything" joke). Match what existing entities already carry — check with `xdata --handle` before writing.

**Verify after writing:**
```bash
bash .claude/actions/cad-bridge.sh xdata --handle <h>  # confirm AID_OBJECT now appears in the app list
```

## XData app-name catalog (key entries)

All app names are defined in `src/raindrop/AID_AppName.cs`. The critical ones for inventory troubleshooting:

| App name constant | String value | What it's on |
|---|---|---|
| `AID_OBJECT` | `"AID_OBJECT"` | Universal marker — written to *most* Raindrop entities. **Not always present on laterals** (see known issue below). |
| `MAIN_PIPE` | `"AID_MAIN_PIPE_ID"` | Mainline polylines |
| `SPRINKLER_LATERAL_PIPE` | `"AID_SPRINK_LAT_PIPE_ID"` | Sprinkler lateral polylines |
| `SHRUB_LATERAL_PIPE` | `"AID_SHRUB_LAT_PIPE_ID"` | Shrub lateral polylines |
| `TREE_LATERAL_PIPE` | `"AID_TREE_LAT_PIPE_ID"` | Tree lateral polylines |
| `POLYDRIP_PIPE` | `"AID_POLYDRIP_PIPE_ID"` | Poly drip polylines |
| `INLINE_DRIP_SUPPLY_PIPE` | (in AID_AppName.cs) | Inline drip manifold pipes |
| `SLEEVE_PIPE` | `"AID_SLEEVE_PIPE_ID"` | Sleeve pipes |
| `PIPE` | `"AID_PIPE_ID"` | Generic pipe marker (on all pipe types) |
| `SPRINKLER` | `"AID_Sprinkler"` | Sprinkler block references |
| `RCVALVE` | `"AID_RCVALVE"` | Remote control valve blocks |
| `VALVE` | `"AID_VALVE"` | Generic valve blocks |
| `MAINVALVE` | `"AID_MAINVALVE"` | Mainline valve blocks |
| `CONTROLLER` | `"AID_CONTROLLER"` | Controller blocks |
| `CONTROL_WIRE` | `"AID_CONTROLWIRE"` | Control wire polylines |

## Known issue: `AID_OBJECT` missing from lateral pipes

**Discovered: 2026-07-28, drawing I-CR66.dwg**

Lateral pipes (sprinkler laterals on `3284-Lateral-Sprinkler`, drip/bubbler laterals on `3284-Lateral-Drip`) were *not* written with `AID_OBJECT` XData. Mainline pipes *were*. This affects both inventory code paths (see below).

**Bridge evidence pattern:**
```bash
# Lateral — no AID_OBJECT
bash .claude/actions/cad-bridge.sh xdata --handle <lateralHandle>
# Shows: AID_PIPE_ID, AID_SPRINK_LAT_PIPE_ID, AID_VALVEID_HANDLE, RD_VELOCITY... but NO AID_OBJECT

# Mainline — has AID_OBJECT
bash .claude/actions/cad-bridge.sh xdata --handle <mainlineHandle>
# Shows: AID_MAIN_PIPE_ID, AID_PIPE_ID, AID_OBJECT
```

**Data fix (used successfully 2026-07-28):** Wrote `AID_OBJECT` to 758 lateral pipes via the bridge:
```bash
bash .claude/actions/cad-bridge.sh xdata write --layer "3284-Lateral-Sprinkler" --app AID_OBJECT --val 1070=42  # 482 entities
bash .claude/actions/cad-bridge.sh xdata write --layer "3284-Lateral-Drip" --app AID_OBJECT --val 1070=42      # 276 entities
```
Single Ctrl+Z undoes both writes.

**Note:** Drip/bubbler laterals on `3284-Lateral-Drip` are tagged as `AID_SPRINK_LAT_PIPE_ID` (not `AID_POLYDRIP_PIPE_ID`), so the inventory classifies them as "Sprinkler Laterals," not a separate drip category. Tim confirmed this is fine — they're separated by layer in the inventory output, not by XData app name.

## Frozen layers and selection (critical distinction)

There are **two inventory code paths** and they handle frozen layers very differently. When troubleshooting "frozen mainline showing up in inventory," first determine which path Tim is using.

### Path 1: Old `IrrigationModel.Quantify()` (legacy)

`IrrigationModel.cs:~2238` uses `Editor.GetSelection()` with `AllAppNamesFilter([AID_OBJECT])`.

`Editor.GetSelection()` is the **interactive pick** — AutoCAD natively excludes frozen layers from interactive selection. If mainline leaks through this path, check that *all* mainline layers are actually frozen. Mainline can be spread across many layers:
- `3284-Mainline Phase 1/2/3/4`
- `3284-Mainlione-Manifold` (note the typo "Mainlione")
- `3284-Mainline Residence`
- `3284-Mainline`

One unfrozen layer leaks those segments through. The typo layer `3284-Mainlione-Manifold` is easy to miss when freezing.

### Path 2: Quantities Palette `IR_Quantities` (current, what Tim actually uses)

`Commands.Irrigation.cs:1165` → `RaindropPalettes.ShowQuantitiesPalette()` → `QuantitiesViewModel.cs`.

This is the **active inventory path** Tim uses day-to-day. It has a frozen-layer bug:

1. **`RefreshAll()`** (`QuantitiesViewModel.cs:80`) calls `Active.Editor.SelectAll()` with **no filter at all** — pulls in every entity in model space, including frozen and off layers, into `_activeProductEntityIds`.
2. `SelectAll()` is a **database query** that ignores layer freeze/off state entirely.
3. When you draw an include boundary, `UpdateSelectedProducts()` (line 169) iterates all those IDs and does a **point-in-polygon containment check** (line 209-211) — purely geometric, no layer visibility check.
4. For a polyline, the "point" is `GetPoint3dAt(0)` (first vertex). If a frozen mainline's first vertex falls inside your boundary, it shows up.

**This is the bug:** `SelectAll()` returns frozen-layer entities, and the boundary filter only tests geometry, never layer visibility. Frozen mainline pipes whose first vertex is inside the boundary appear in the inventory.

**The clean pattern already exists** in `EditorSelection.GetFromModelSpace(appName, respectFrozenLayers: true)` (`EditorSelection.cs:33`) — it pre-caches frozen layer names and skips entities on frozen layers. The Quantities Palette just doesn't use it.

### `GetSelection` vs `SelectAll` vs `GetFromModelSpace` — quick reference

| Method | Frozen layers | Off layers | Where used |
|---|---|---|---|
| `Editor.GetSelection()` | **Excluded** (AutoCAD native) | Included | Old `Quantify()`, `GenerateLegend()` |
| `Editor.SelectAll()` | **Included** (database query) | Included | Quantities Palette `RefreshAll()` |
| `EditorSelection.GetFromModelSpace(app, respectFrozenLayers: true)` | **Excluded** (explicit check) | Included | Background/snapshot paths |
| `EditorSelection.GetAllObjectIDs()` | Post-filtered via `IsLayerFrozen` | Included | Some factory methods |

## Inventory code locations

| Method | File | Line (approx) | Filter used | Frozen-aware? |
|---|---|---|---|---|
| `IR_Quantities` command | `CAD Commands/Commands.Irrigation.cs` | 1165 | Opens palette | — |
| `QuantitiesViewModel.RefreshAll()` | `Presentation/Quantities/QuantitiesViewModel.cs` | 80 | `SelectAll()` — NO filter | **No** |
| `QuantitiesViewModel.UpdateSelectedProducts()` | `Presentation/Quantities/QuantitiesViewModel.cs` | 169 | Point-in-polygon containment | **No** (geometry only) |
| `QuantitiesViewModel.PromptForBoundarySelection()` | `Presentation/Quantities/QuantitiesViewModel.cs` | 254 | `GetSelection(LWPOLYLINE filter)` | Yes (interactive) |
| `Quantify()` (legacy) | `Irrigation/IrrigationModel.cs` | 2238 | `AllAppNamesFilter([AID_OBJECT])` | Yes (interactive) |
| `GenerateLegend()` | `Irrigation/IrrigationModel.cs` | 729 | `AppNameFilter("AID_OBJECT")` | Yes (interactive) |
| `IrrigationInventory(ids)` | `Irrigation/IrrigationInventory.cs` | 48 | Re-sorts by specific app names | N/A (post-selection) |
| `IrrigationInventory(ids, true)` | `Irrigation/IrrigationInventory.cs` | 217 | Single-transaction variant | N/A (post-selection) |
| `GetFromModelSpace()` | `CAD Utility/EditorSelection.cs` | 33 | XData app name + frozen check | **Yes** |
| `GetAllObjectIDs()` | `CAD Utility/EditorSelection.cs` | 112 | `SelectAll` + `IsLayerFrozen` post-filter | Yes (post-filter) |
