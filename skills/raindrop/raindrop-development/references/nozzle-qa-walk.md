# Q/A Nozzle Walk & Palette Tree Mapping

> How Q/A nozzle cycling relates to the Sprinklers palette tree, and the
> sync gap as of branch feat/686-unify-insert-rotate-with-tweak-coverage.
> Last updated: 2026-07-29

## The key invariant

`SprinklerDefinition.Series` (`SprinklerDefinition.cs:66`) is a computed
property:

```csharp
public string Series => $"{Manufacturer}_{Model}_{Pressure}";
```

The Q/A walk filters the full `ActiveDWGSprinklers()` set by this `Series`
and sorts by `Radius` then `Flow`. The palette tree's deepest leaf group
(`SprinklersPressure.Sprinklers`) is built from the same
Manufacturer+Model+Pressure set. **So Q/A is literally stepping up/down
the leaf list of the palette tree.**

## Q/A call sites (three, all share the same walk)

1. **Insert jig** — `UserPlaceSprinkler` (`SprinklerFactory.cs:508`):
   `case "Q"` → `GetNextSprinklerInSeries` (`:543`),
   `case "A"` → `GetPreviousSprinklerInSeries` (`:548`). Mutates a LOCAL
   `sprDef` (`:555`).
2. **Tweak Coverage (per-head)** — `TweakOneHead` (`Commands.TweakCoverage.cs:118`):
   `NozzleUp`/`NozzleDown` keywords → `NextNozzleInSeries`/`PreviousNozzleInSeries`
   (`:283-285`). Mutates a LOCAL `workingDef` (`:288`).
3. **Triangular Grid** — `UserPlaceTriangularGrid` (`SprinklerFactory.cs:729`):
   Q → `GetNextFullCircleInSeries` (full-circle-only variant).

The public wrappers `NextNozzleInSeries` / `PreviousNozzleInSeries`
(`SprinklerFactory.cs:2708, 2714`) delegate to the private
`GetNext/PreviousSprinklerInSeries`, both of which call
`GetSeriesSprinklers(baseSprink, false)` (`:2652, 2682`).

`GetSeriesSprinklers` (`:3057`): filters by `Series`, optionally matches the
nozzle's last char (Q/H/F), sorts `Radius` then `Flow`.

## The palette tree structure (`SprinklersHierarchy.cs`)

```
Manufacturer
└── Model
    └── Pressure
        └── SprinklerDefinition (leaf)  ← Q/A walks THIS set
```

Built by `SprinklersHierarchy.Create(GetFilteredNozzles())`
(`SprinklersViewModel.cs:31`). The `BindableSelectedItemBehavior` two-way
binds `SelectedItem` to `SprinklersViewModel.SelectedSprinkler`
(`SprinklersViewV2.xaml:43`).

## The sync gap (as of #686)

**Nothing writes `SelectedSprinkler` on Q/A.** Confirmed by searching for
`SelectedSprinkler =` assignments — only the XAML binding sets it.
- Insert reads `ActiveSprinklersViewModel?.SelectedSprinkler` ONCE at the
  top (`SprinklerFactory.cs:514`), then Q/A only updates a local.
- Tweak Coverage never touches the palette at all (the standalone
  `IR_TweakCoverage` command picks from the drawing, no palette needed).

So the palette highlight stays on the originally-clicked nozzle through
the entire Q/A sequence. Syncing is feasible — guard null, set
`ActiveSprinklersViewModel.SelectedSprinkler = newSprink` on each Q/A —
and it's purely visual (the loops use their own local def, so logic is
unaffected).

## The filtering mismatch (the real caveat)

The palette tree is **filtered**, Q/A is not. `GetFilteredNozzles`
(`SprinklersViewModel.cs:159`) applies:
- `SelectedManufacturer` / `SelectedModel` dropdown filters
- `ShowFullRotors` toggle — when OFF, full-circle nozzles are
  **excluded** from the tree

`GetSeriesSprinklers(..., false)` walks **all** nozzles in the series
(fulls included, no manufacturer filter). So Q/A can land on a nozzle
the palette tree isn't currently displaying. Setting `SelectedSprinkler`
to a filtered-out item is safe (won't error) but the TreeView can't
highlight or scroll to it — it's not in `ItemsSource`. The two stay in
lockstep only when no filter is active.

Secondary: the palette leaf order is insertion order, not the
Radius→Flow sort Q/A uses. Selection is by object identity, so the
highlight lands correctly regardless of order — but the "up/down"
direction on screen may not match Q/A's up/down when filters/order differ.

## Palette-not-shown cases

- `AID_Palettes.SprinklersViewV2` is a static field, created lazily on
  first open, nulled only in a reset path (`AID_Palettes.cs:315`).
  Collapsing the palette hides it but the view/viewmodel persist for the
  session. `ActiveSprinklersViewModel` is generally non-null after first
  open.
- If the user never opened the Sprinklers palette, it's null — any sync
  code no-ops safely.
- Insert can't run without a palette selection (returns early at
  `:519`); Tweak Coverage runs standalone by picking from the drawing.
