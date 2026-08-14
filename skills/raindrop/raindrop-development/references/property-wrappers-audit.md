# Property Wrappers Audit (issue #654)

Full dead-code audit of `src/raindrop/Property Wrappers/` vs `src/raindrop/ViewModels/Collections/`.
Investigation only — no files edited. Session: 2026-07-30.

## Live UI path (the replacement)

The live properties palette is the WPF `ObjectsPropertiesView`, instantiated at
`Palettes/AID_Palettes.cs:483`:
```csharp
AddControlToPalette("Properties", PropertyGridWpf ??= new ObjectsPropertiesView(), PropertyPaletteSet);
```
Populated by `Presentation/ObjectsProperties/PropertyEvents.cs` →
`IrrigationPropertySorter()`, which resolves the selection and dispatches to
`ViewModels/Collections/*` via a `type.Name` switch:
```
Pipe → PipeCollectionViewModel
HydraulicLink → HydraulicLinkCollectionViewModel
Sprinkler → SprinklerCollectionViewModel
ControlValve → ControlValveCollectionViewModel
Valve → ValveCollectionViewModel
Pump → PumpCollectionViewModel
HydraulicReservoir → ReservoirCollectionViewModel
Controller → ControllerCollectionViewModel
InlineDripGrid → InlineDripGridCollectionViewModel
PlantViewModel → PlantsCollectionViewModel
GroundTreatmentViewModel → GroundTreatmentCollectionViewModel
(mixed) → ProductCollectionViewModel
```

## Dead UI path (the consumers of the Property Wrappers)

- **`Palettes/IrrigationPropertyGrid.cs`** — WinForms `UserControl` declaring
  `List<PropertyPipe>`, `List<PropertyLink>`, `List<PropertySprinkler>`,
  `List<PropertyValve>`, `List<PropertyControlValve>` fields. All initialized as
  empty `new List<>()` and **never populated**. The control itself is **never
  instantiated** outside its own `*.Designer.cs` — no `new IrrigationPropertyGrid()`,
  no palette registration. Compiled but unwired = dead.
- **`Forms/AddPlantForm.cs`** — declares `public PropertyNewPlant Plant;`
  (never constructed; `InitPropGrid()` is empty). The form is **never
  instantiated** outside its `*.Designer.cs` = dead.

No `new PropertyXxx(` constructor calls exist anywhere in the tree outside the
Property Wrappers directory itself.

## Audit table

| # | File | Class(es) | References outside Property Wrappers/ | Live/dead | Carried forward into ViewModels/Collections | Verdict | Reason |
|---|------|-----------|----------------------------------------|-----------|---------------------------------------------|---------|--------|
| 1 | PropertyControlValve.cs | PropertyControlValve | IrrigationPropertyGrid.cs (field, never populated) | Dead | ControlValveCollectionViewModel (Area, ApplicationRate, PlantType, RequiredDepth, Efficiency, Runtime, ControllerId, StationNumber) + BaseValveCollectionViewModel (NominalSize, Demand, Elevation, RequiredPressure, AvailablePressure) | DEAD-REMOVE | 100% superseded; sole consumer is unwired legacy grid |
| 2 | PropertyLink.cs | PropertyLink | IrrigationPropertyGrid.cs (field + one `is PropertyLink` type-check in dead handler) | Dead | HydraulicLinkCollectionViewModel (PipeClass, NominalSize, InnerDiameter, OuterDiameter, Length, Roughness, Flow, Velocity, FrictionLoss, StartPressure, EndPressure) | DEAD-REMOVE | Fully reproduced by HydraulicLinkCollectionViewModel |
| 3 | PropertyNewPlant.cs | PropertyNewPlant | AddPlantForm.cs (field, never constructed) | Dead | PlantsCollectionViewModel (CommonName, BotanicName, Abbreviation, Category, Size, Height, Note, Hydrozone, CropCoefficient, IrrigationDemand, Cost, CanopyArea) — source is PlantViewModel | DEAD-REMOVE | Sole consumer unwired; plant props now in PlantsCollectionViewModel |
| 4 | PropertyNode.cs | PropertyNode (internal : HydraulicNode) | None — zero references | Dead | Node elevation in HydraulicLinkCollectionViewModel (StartPressure/EndPressure) + SprinklerCollectionViewModel (Elevation) | DEAD-REMOVE | Never referenced; 10-line stub |
| 5 | PropertyPipe.cs | PropertyPipe | IrrigationPropertyGrid.cs (field); 2 comment-only mentions in DebugBridgeService.SetPipe.cs | Dead | PipeCollectionViewModel (PipeClass, NominalSize, InnerDiameter, OuterDiameter, Length, Roughness) | DEAD-REMOVE | Comment-only external refs; PipeCollectionViewModel fully replaces |
| 6 | PropertyPump.cs | PropertyPump | None — zero references | Dead | PumpCollectionViewModel (PumpID, BoostPressure, PumpMode, Efficiency, BrakePower, DesignFlow, Elevation, Blockname) + extras (CurveData, OperatingFlowMin/Max, EfficiencyFlowMin/Max) | DEAD-REMOVE | Never instantiated; PumpCollectionViewModel is strict superset |
| 7 | PropertySprinkler.cs | PropertySprinkler | IrrigationPropertyGrid.cs (field, never populated) | Dead | SprinklerCollectionViewModel (Manufacture, Model, Nozzle, DesignFlow, DesignRadius, AdjustedRadius, DesignPressure, CalculatedPressure, TotalHead, Elevation, PressureHead, Area, Angle, Rotation, PrecipRate) | DEAD-REMOVE | Fully superseded; only dead grid references it |
| 8 | PropertyValve.cs | PropertyValve + nested ValveDefConverter | IrrigationPropertyGrid.cs (field, never populated) | Dead | BaseValveCollectionViewModel/ValveCollectionViewModel (NominalSize, Description, Demand, Elevation, RequiredPressure, AvailablePressure, PressureLoss). PumpType/PumpPower/PumpID have NO live path. ValveDefConverter is an empty unused stub. | DEAD-REMOVE | PressureLoss carried into BaseValveCollectionViewModel; PumpType/Power/ID dead; ValveDefConverter empty stub |
| 9 | DriplineTypeConverter - Copy.cs | DriplineTypeConverter | None — zero references | Dead | No corresponding Collection VM property (dripline handled by InlineDripGridCollectionViewModel) | DEAD-REMOVE | Never referenced; " - Copy" filename = accidental duplicate |
| 10 | PipeClassConverter.cs | PipeClassConverter | Internal only: [TypeConverter(typeof(...))] in PropertyLink.cs & PropertyPipe.cs (both dead) | Dead (transitive) | Replaced by PipeClassEditor on PipeCollectionViewModel & HydraulicLinkCollectionViewModel | DEAD-REMOVE | Only used by dead wrappers; live path uses PipeClassEditor |

## Per-file notes

- **PropertyControlValve** — 13 display properties, all read-mostly. Every one
  reproduced in ControlValveCollectionViewModel (zone props) or
  BaseValveCollectionViewModel (valve props). Legacy `RCVs` field never filled.
- **PropertyLink** — Most behavior-heavy wrapper (PipeClass setter writes to
  drawing, clears hydraulic data, refreshes palettes). All that logic now in
  HydraulicLinkCollectionViewModel.PipeClass setter (Items.SetPipesClass +
  PublishMainlineNetworkEvent) and PipeCollectionViewModel.
- **PropertyNewPlant** — Pure backing-field POCO (no constructor arg, no domain
  object). Referenced as uninitialized field in AddPlantForm (InitPropGrid empty).
  Plant props now flow through PlantViewModel → PlantsCollectionViewModel.
- **PropertyNode** — 10-line internal stub deriving from HydraulicNode. Zero
  external refs. Node elevation surfaced directly in link/sprinkler VMs.
- **PropertyPipe** — Self-described in header as unfinished experiment ("I
  can't figure out the implementation yet"). DebugBridgeService.SetPipe.cs
  mentions it only in comments. PipeCollectionViewModel is the complete replacement.
- **PropertyPump** — Zero external references. PumpCollectionViewModel reproduces
  all 8 of its properties and adds 6 more.
- **PropertySprinkler** — 15 display properties, all reproduced in
  SprinklerCollectionViewModel. Live VM converts rotation radians→degrees (refinement
  the old wrapper lacked).
- **PropertyValve** — PressureLoss carried into BaseValveCollectionViewModel
  (lines 88-99, with WriteXData + LinkChangedEvent). PumpType/PumpPower/PumpID
  are NOT in any Collection VM = dead (no live UI path). Nested ValveDefConverter
  is an empty class overriding only GetStandardValuesSupported returning true —
  no values, no external use.
- **DriplineTypeConverter - Copy.cs** — " - Copy" filename = copy-paste leftover.
  Builds dropdown from DripLineFactory.ProjectDripLineDefinitions(). No
  [TypeConverter(typeof(DriplineTypeConverter))] attribute exists anywhere.
- **PipeClassConverter** — Pipe-class dropdown for the PropertyGrid. Referenced
  only by two dead wrappers (PropertyLink, PropertyPipe). Live path uses
  AID.Presentation.Editors.PipeClassEditor ([Editor] on
  PipeCollectionViewModel & HydraulicLinkCollectionViewModel).

## Open caveat (resolve before deletion)

`PropertyValve.PumpType`/`PumpPower`/`PumpID` (EPANET pump modeling on a `Valve`)
have NO carry-forward into any CollectionViewModel. If those fields are still
intended to be user-editable via the grid for a valve-doubles-as-pump scenario,
that's a feature gap. PumpCollectionViewModel covers the Pump object's own pump
properties, but a Valve carrying pump metadata would lose that UI. Confirm with
Tim whether valves still carry pump metadata before deleting PropertyValve.cs.

## Audit technique (reusable)

1. List target dir + comparison dir (`ls` via terminal; search_files fails on
   space-containing Windows paths).
2. Read all files in both dirs (batch read_file calls).
3. Grep the whole tree for each class name, excluding the target dir itself:
   `cd <root> && grep -rn --include="*.cs" "ClassName" . | grep -v "<target-dir>/"`
4. Grep for `new PropertyXxx(` specifically — field declarations
   (`List<PropertyXxx> x = new List<>()`) are NOT constructor calls; empty lists
   are dead.
5. Trace the consumer file's own instantiation: grep for `new ConsumerClass(`
   across the tree. If the only hits are the consumer's own *.Designer.cs, the
   consumer is unwired = dead, which transitively deadens everything it
   references.
6. Identify the live replacement path (here: PropertyEvents.cs type switch →
   CollectionViewModels) and confirm it does NOT reference the old wrappers.
7. For each old class, diff its properties against the replacement VM's
   properties to confirm carry-forward; flag any that are NOT carried forward
   as potential feature gaps before recommending removal.
