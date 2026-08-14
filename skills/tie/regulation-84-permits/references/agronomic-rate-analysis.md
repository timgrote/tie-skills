# Nitrogen Agronomic Rate Analysis for Regulation 84

CDPHE guidance for demonstrating that reclaimed water applied for irrigation will be at or below agronomic rates. Source: "Guidance for Completing Nitrogen Agronomic Rate Analysis for Reclaimed Water Users and Treaters" (May 23, 2017), available at https://cdphe.colorado.gov/water-quality-reclaimed-water-reuse-permits

## The Core Question

**Nitrogen loading** (how much N is applied via irrigation water) must be **less than** the **nitrogen agronomic need** (how much N the plants uptake). If loading < need, the application is at or below agronomic rate.

## Method Selection

### Simplified Method 1: ≥90% Turf Grass

**Qualification**: 90% or more of irrigated land is traditional turf grass (bluegrass, ryegrass — NOT buffalo grass or fescues).

**Rule**: Use 174 lbs/acre annual nitrogen agronomic need. Denver Water's TIN concentration already ensures loading stays below this for typical irrigation volumes.

**Documentation required**:
1. Statement that Simplified Method 1 is being used
2. Statement that ≥90% of irrigated land is turf grass
3. List of turf grass varieties present

### Simplified Method 2: 100% Drip Irrigation

**Qualification**: All irrigation at the site is drip irrigation.

**Rule**: Drip is assumed to match plant needs — no calculation needed.

**Documentation required**:
1. Statement that Simplified Method 2 is being used
2. Statement that all irrigation is drip, calibrated to meet agronomic need

### Simplified Method 3: Turf + 100% Drip Non-Turf

**Qualification**: Site has <90% turf but all non-turf areas use drip irrigation. Turf portion must meet Method 1 qualifications; drip portion must meet Method 2 qualifications.

**Documentation required**:
1. Statement that Simplified Method 3 is being used
2. Statement that all irrigated land is either turf or drip
3. List of turf grass varieties
4. Statement that non-turf irrigation is drip calibrated to agronomic need

### Calculated Method (for sites not qualifying for Simplified Methods)

Two-step analysis. Most TIE projects with mixed vegetation (bluegrass + trees/shrubs + native grass) need this method.

#### Step 1: Annual Nitrogen Loading

```
Annual N Loading (lbs/acre) = 
    (Total volume of reclaimed water in million gallons/year) × (Average Annual TIN in mg/L) × 8.34
    ÷ (Total area irrigated with reclaimed water in acres)
```

- **TIN** = Total Inorganic Nitrogen concentration in the reclaimed water
- **8.34** = unit conversion factor (3.785 L/gal × 1,000,000 gal/Mgal ÷ 453,592 mg/lb)
- Use **maximum expected** annual volume and TIN concentration

**Example**: 4-acre site, 1,000,000 gal/year, 20 mg/L TIN
→ (1 × 20 × 8.34) ÷ 4 = **41.7 lbs/acre**

#### Step 2: Annual Nitrogen Agronomic Need

Three options — use the simplest one that passes:

**Option A** — Loading ≤25 lbs/acre → use 25 lbs/acre for entire site (conservative default for any vegetation).

**Option B** — Loading < lowest vegetation need on site → use that lowest need for entire site.

**Option C** — Aggregated need: calculate per-area needs and weight by acreage:

```
Site Annual N Need = Σ(area_acres × need_lbs_per_acre) ÷ total_irrigated_acres
```

If Step 1 loading < Step 2 need → **passes**.

**Example (Option C)**: 1.75 irrigated acres = 1 ac bluegrass (174 lbs/ac) + 0.25 ac buffalo grass (88 lbs/ac) + 0.5 ac shrubs (25 lbs/ac)
→ (1×174 + 0.25×88 + 0.5×25) ÷ 1.75 = (174 + 22 + 12.5) ÷ 1.75 = **119 lbs/acre**

### Drip Irrigation Exclusion (optional within Calculated Method)

If the Calculated Method doesn't pass when drip areas are included, drip-irrigated areas can be **excluded**:
- Step 1: Subtract the estimated annual volume used for drip irrigation from total volume
- Step 2: Use Option C, excluding drip-irrigated land area from the calculation
- Additional documentation: state drip areas excluded, max expected drip volume, drip-irrigated surface area

### Site-Specific Method

When none of the above methods pass:
1. Consult a certified agronomist
2. Reduce anticipated water volume to reflect actual delivery
3. Change watering schedules/systems (water-saving heads, convert to drip, weather controls)
4. Add higher-uptake vegetation
5. Document the method and demonstrate loading < need

## Vegetation Nitrogen Needs (CDPHE Table 1)

| Vegetation | Annual N Need (lbs/acre) | Source |
|------------|--------------------------|--------|
| Colorado Native Grasses | 25 | CSU Extension (default for any landscape veg) |
| Buffalo grass, Blue Grama, Bermudagrass | 80 | CSU Extension "Lawn Grass 7.202" by Koski & Skinner |
| Tall or Fine Fescue | 108 | CSU Extension "Lawn Grass 7.202" |
| Turf Grass (bluegrass, ryegrass) | 174 | Water Quality Policy 21 |

**Conservative default**: 25 lbs/acre can be used for ANY landscape vegetation (based on CSU native grass rate). Use this for trees, shrubs, flowers, and undetermined vegetation.

**Important**: The 174 lbs/acre turf value only applies to high-N grasses (bluegrass, ryegrass). Do NOT use it for buffalo grass, fescues, or native/xeriscape turf-forming grasses.

## TIN Concentration

- Denver Water recycled water: **5.2 mg/L** as of 2025 (per Denver Water UASMP cheat sheet)
- **Verify current year value** with Denver Water before calculating
- Denver Water provides semi-annual water quality reports with nutrient data

## Documentation Requirements (Calculated Method Option C)

The agronomic rate analysis document must include:
1. a) Statement that **Calculated Method – Option C** is being used
2. b) Loading calculations from Step 1, including total nitrogen loading
3. c) List of vegetation types present, nitrogen needs (lbs/acre) for each, and source (CDPHE Table 1)
4. d) Acres for each vegetation type
5. e) Agronomic need calculation (per-area breakdown + aggregated total)
6. f) Statement that annual site-wide nitrogen load (b) is less than annual site-wide nitrogen need (e)

## When to Revise the Analysis

**Minor revisions** (document in current UASMP, no submission needed):
- Changes to landscaping, watering procedures, or reclaimed water treatment

**Significant revisions** (require Treater to submit modification request to CDPHE):
1. Analysis method changes (site no longer qualifies for its method)
2. For Calculated Method: loading ≥ need, or loading increased >50%, or need decreased >50%
3. Division specifically requests it

## Pena Station F2/F4 Worked Example (2026-08-06)

### Filing 2
- **Total irrigated acres**: 1.21 (bluegrass 0.21, trees/shrubs 0.79, native grass 0.21)
- **Annual gallons**: 724,212 (0.7242M gal)
- **TIN**: 5.2 mg/L

**Step 1 — Loading**: (0.7242 × 5.2 × 8.34) ÷ 1.21 = **26.0 lbs/acre**

**Step 2 — Need (Option C)**:
- Bluegrass: 0.21 ac × 174 = 36.5 lbs
- Trees/Shrubs: 0.79 ac × 25 = 19.8 lbs
- Native grass: 0.21 ac × 25 = 5.3 lbs
- Total: (36.5 + 19.8 + 5.3) ÷ 1.21 = **50.9 lbs/acre**

**Result**: 26.0 < 50.9 → ✅ PASSES

### Filing 4
- **Total irrigated acres**: 0.85 (bluegrass 0.24, trees/shrubs 0.47, native grass 0.14)
- **Annual gallons**: 568,878 (0.5689M gal)
- **TIN**: 5.2 mg/L

**Step 1 — Loading**: (0.5689 × 5.2 × 8.34) ÷ 0.85 = **29.0 lbs/acre**

**Step 2 — Need (Option C)**:
- Bluegrass: 0.24 ac × 174 = 41.8 lbs
- Trees/Shrubs: 0.47 ac × 25 = 11.8 lbs
- Native grass: 0.14 ac × 25 = 3.5 lbs
- Total: (41.8 + 11.8 + 3.5) ÷ 0.85 = **67.1 lbs/acre**

**Result**: 29.0 < 67.1 → ✅ PASSES
