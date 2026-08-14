# Domain Model — Zone Data, Area, Volume & Reporting Patterns

Reference for any analysis/reporting feature that needs per-zone irrigated area, plant
type, water volume, or the existing report/export patterns. Mapped during the
agronomic-rate-calculator feasibility investigation (Aug 2026).

## The zone data model — `ControlValve` (1 valve = 1 zone)

`src/raindrop/Irrigation/ControlValve.cs` — a `ControlValve` IS a zone. All of these
are persisted to XData on the valve block reference:

| Property | XData slot | Unit / type | Notes |
|---|---|---|---|
| `Area` | index 1 | square drawing units | Computed by `WeightedAreaSolver`, not hand-entered |
| `DesignDemand` | `DESIGN_DEMAND` appname | gpm (imperial) / L/min (metric) | The zone's design flow |
| `PlantType` | index 9 | string | **Free-form** — no controlled vocabulary (see "Vegetation type" below) |
| `RequiredDepth` | index 8 | inches (imperial) / mm (metric) | Net water the plants need per event |
| `Efficiency` | `EFFICIENCY` appname | int 1–100 | Distribution efficiency % |
| `ApplicationRate` | computed | in/hr or mm/hr | `PrecipRateFactorForUnit(unit) * DesignDemand / Area` |
| `RunTime` | computed | minutes | `CalculateRunTimeMinutes(RequiredDepth, ApplicationRate, Efficiency)` — net→gross (divides by efficiency) |
| `ControllerId` / `StationNumber` | index 6 / 7 | string / int | Address (e.g. A5) |

`IrrigationModel.GetAllControlValves()` (src/raindrop/Irrigation/IrrigationModel.cs:582)
is the batch aggregator — reads every RCV block ref in one pass with a shared
transaction. `IrrigationModel.LastKnownControlValves` caches the last result.

**ReadXData order matters:** index 1=area, 2=demand, 3=designatorHandle, 4=reqPressure,
5=availPressure, 6=controllerId, 7=stationNumber, 8=requiredDepth, 9=plantType. Older
drawings may have only 4 or 8 slots — the reader guards on `valveData.Count >= N`.

## Per-zone irrigated area — `WeightedAreaSolver`

`src/raindrop/Irrigation/Coverage/WeightedAreaSolver.cs` — CAD-free pure math.
Distributes each boundary polygon's true ground `Area` among the heads inside it in
proportion to each head's complex-arc footprint (π·R²·sweep/360 on the effective
radius), then totals **per valve**. Returns `WeightedAreaResult` with
`WeightedAreaByHead` (Dictionary<handle,double>) and `AreaByValve`
(Dictionary<valveId,double>). Parallelized via `Parallel.For`. So `ControlValve.Area`
is the sum of weighted areas of all heads on that valve — already in drawing square
units (convert to acres / sq-m for reporting).

`Boundary` (src/raindrop/Geometry/Boundary.cs) is the CAD-free closed-polyline math
class: built from `(vertex, bulge)` pairs, exposes `Area`, `Perimeter`, `Contains`,
`ClosestPoint`, `IntersectCircle`. Immutable; safe from worker threads.

`BoundaryStorageService` (src/raindrop/Services/) persists include/exclude boundary
`ObjectId`s to the NOD (`RD_BOUNDARIES` dict). The Quantities palette and uniformity
analysis both use it for scoping.

## Per-zone & per-boundary water volume — Uniformity analysis

`src/raindrop/CAD Commands/Commands.Uniformity.cs` + `src/raindrop/Irrigation/CatchCanGrid.cs`
already compute water volume per zone and per boundary:

- **Mode A (whole-boundary):** `demandGallons = Σ(flow) * runtimeMinutes` for all
  heads in the boundary; `appliedGallons = Σ(depth) * cellArea * volumeFactor`
  (integrated depth field); `WasteGallons = DemandGallons - AppliedGallons`.
- **Mode B (operational, per-zone):** groups in-boundary sprinklers by zone, looks up
  each zone's `ControlValve.RunTime`, builds one depth field per zone at that runtime,
  sums per-zone depths at every sample point. `CatchCanGrid` carries `DemandGallons`,
  `AppliedGallons`, `RuntimeMinutes`, `BoundaryArea`, `SprinklerCount`.

`UniformitySettings.VolumeFactor(unit)` (Presentation/Settings/Uniformity/) is the
depth×area→gallons conversion: ft→0.6234, in→0.004329, m→1.0 (L), mm→1e-6.

**What's NOT here:** annual volume (gal/year). Raindrop has per-event volume and
per-zone runtime, but no concept of annual run cycles or seasonal total. Any annual-
volume feature (water budget, agronomic loading) must add this input.

## Vegetation / plant type — what exists and what's free-form

- `ControlValve.PlantType` (string) — **free-form, display-only.** The hydrozoning
  SOP (docs/enki/sop/hydrozoning.md) explicitly notes: "Raindrop models zones but does
  not enforce hydrozoning rules. ControlValve.PlantType is display-only, not used to
  validate grouping. The water-need categories are not in the code; they're your
  standards."
- `SetRequiredDepths()` (IrrigationModel.cs:2355) — prompts user for plant type +
  required depth, assigns to selected valves. Builds `Dictionary<string,double>`
  (name→depth) from existing valves to populate the picker.
- `PlantTypeViewModel` / `PlantTypeWindow` (Presentation/PlantType/) — the WPF picker.
- `data/RD_Plants.json` — plant library; each entry has `Category` (e.g. "Deciduous
  shrub", "Evergreen shrub") — a possible basis for mapping free-form PlantType
  strings to a controlled vegetation-type vocabulary.
- `Landscape/Planting/` (Plant, PlantDefinition, PlantDefinitionCollection) — the
  plant-instance model for the planting design, separate from irrigation PlantType.

**For a controlled vegetation vocabulary (CDPHE Table 1, etc.):** there is NO
existing mapping. A new feature must either constrain PlantType (migration concern for
existing drawings) or add a lookup table (PlantType→category). Recommend the lookup
table to avoid breaking existing drawings.

## Reporting & export patterns (copy these for a new analysis feature)

### Runtime Schedule (TSV/XLSX) — the closest existing analog
`IrrigationModel.WritePrecipTable()` (IrrigationModel.cs:2410) + `GetPrecipTableString()`
(:2457) + `ControlValve.PrecipTableString()` (ControlValve.cs:494). Prompts for
valves, exports Controller / Station / Flow / Area / ApplicationRate / PlantType /
RequiredDepth / Runtime. `SaveFileDialog` → xlsx (via `ExcelHelper.WriteZoneExcelFile`,
ClosedXML) or tsv (raw StreamWriter). Header includes project title/subtitle +
unit-aware column labels (`Units.FlowUnit(metric)`, `Units.AreaUnit(metric)`,
`Units.PrecipUnit(metric)`).

### Quantities Palette (WPF/MVVM + Syncfusion Excel)
`Presentation/Quantities/QuantitiesViewModel.cs` — `ObservableObject`, boundary
include/exclude scoping via `BoundaryStorageService`, `RelayCommand` for refresh/
export. `Services/QuantitiesExcelExporter.cs` uses `Syncfusion.XlsIO` — two-sheet
workbook (Irrigation + Planting), grouped product tables, styled headers, autofit.
This is the pattern for a WPF analysis panel with Excel export.

### Uniformity palette (WPF/MVVM + heat-map)
`Presentation/Uniformity/UniformityViewModel.cs` — `NotificationObject`, holds
`List<CatchCanGrid> Results`, per-zone dropdown, `WriteableBitmap HeatMapBitmap`,
`SummaryText`, visibility toggles. The analysis command (`Commands.Uniformity.cs`)
computes results and pushes them into the VM; the view binds. This is the pattern for
a visual analysis panel.

## What's entirely absent (greenfield for agronomic/water-budget features)

Zero source matches for: `agronomic`, `nitrogen`, `regulation 84`, `reg84`,
`reclaimed water` (as a domain concept), `water budget`, `vegetation`, `TIN`. No
prior plumbing to extend, but no conflicts either.

Missing pieces for an agronomic rate calculator (and likely any similar feature):
1. **Controlled vegetation-type vocabulary** — PlantType is free-form; needs a
   mapping to CDPHE Table 1 categories.
2. **CDPHE Table 1 nitrogen agronomic need lookup** — new static data file in `data/`
   (follow the Plants_Imperial.json / Settings_Imperial.tsv conventions).
3. **Total annual water volume (gal/year)** — Raindrop has per-event volume only;
   new project-level setting or schedule-derived input.
4. **TIN mg/L (reclaimed water nitrogen content)** — `WaterSource.cs` currently only
   holds `AvailablePressure` + `MaxFlow`; needs extension or a new project setting.
5. **The calc + a report UI** — the math is trivial pure C# (follow
   `CalculateRunTimeMinutes` as the unit-testable static helper pattern); the UI
   follows the Uniformity/Quantities MVVM + Excel/TSV export patterns above.

## Effort shape

Medium. The two hardest data pieces (per-zone area, per-zone plant type) already
exist and aggregate via `GetAllControlValves()`. The report/export pattern is
established and copyable. The missing pieces are all additive and follow existing
conventions (Settings JSON section, `data/` lookup file, new `Presentation/` view,
new `IR_*` command). The one real design decision is the vegetation-type vocabulary
(constrain vs. map).
