# Agronomic Rate Analysis for Nitrogen
## {PROJECT_NAME} — Recycled Water Irrigation

**Project:** {PROJECT_NAME}
**Prepared by:** Tim Grote, The Irrigation Engineers
**Date:** {DATE}
**Treater:** Denver Water (COE012000)
**Reclaimed Water Category:** Centralized, Category 3
**Nitrogen Content (TIN):** {TIN_VALUE} mg/L (Denver Water, {YEAR} value)

---

## Method

This analysis uses the **Calculated Method – Option C (Aggregated Nitrogen Agronomic Need)** per the CDPHE *Guidance for Completing Nitrogen Agronomic Rate Analysis for Reclaimed Water Users and Treaters* (May 2017).

The two-step method compares the annual nitrogen loading delivered by the reclaimed water (Step 1) against the site-wide annual nitrogen agronomic need of the vegetation (Step 2). If the loading is less than the need, the application is expected to be below the agronomic rate.

### Step 1 Formula — Annual Nitrogen Loading

```
Annual Nitrogen Loading (lbs/acre) =
    (Total volume of reclaimed water in million gallons per year) × (Average Annual TIN in mg/L) × 8.34
    ÷ (Total area irrigated with reclaimed water in acres)
```

Where 8.34 is the unit conversion factor: (3.785 L/gal × 1,000,000 gal/million gallons) ÷ 453,592 mg/lb.

### Step 2 Formula — Aggregated Nitrogen Agronomic Need (Option C)

```
Site Annual Agronomic Need (lbs/acre) =
    Σ(Area × Nitrogen Need) for each vegetation type
    ÷ Total irrigated acres
```

Nitrogen agronomic need values are from CDPHE Table 1: *Nitrogen Agronomic Need for Common Vegetation Types*.

---

## {FILING_NAME} Analysis

### Site Composition

| Vegetation Type | Irrigated Acres | % of Site | Nitrogen Need (lbs/acre) | Source |
|----------------|----------------|-----------|-------------------------|--------|
| Bluegrass (turf, rotor/spray) | {ACRES_TURF} | {%} | 174 | CDPHE Table 1 — Turf Grass (bluegrass) |
| Moderate Use Trees & Shrubs (drip) | {ACRES_DRIPLAND} | {%} | 25 | CDPHE default conservative value |
| Native Grass (rotor) | {ACRES_NATIVE} | {%} | 25 | CDPHE Table 1 — Colorado Native Grasses |
| **Total** | **{TOTAL_ACRES}** | **100%** | | |

### Step 1 — Annual Nitrogen Loading

- Total annual reclaimed water volume: {GALLONS} gallons = {MGAL} million gallons
- Average annual TIN: {TIN_VALUE} mg/L
- Total irrigated area: {TOTAL_ACRES} acres

```
Annual Nitrogen Loading = ({MGAL} × {TIN_VALUE} × 8.34) ÷ {TOTAL_ACRES}
                        = {LOADING_PRODUCT} ÷ {TOTAL_ACRES}
                        = {LOADING} lbs/acre
```

### Step 2 — Annual Nitrogen Agronomic Need (Option C)

| Area | Calculation | Result |
|------|------------|--------|
| Bluegrass | {ACRES_TURF} ac × 174 lbs/ac | {TURF_LBS} lbs |
| Trees & Shrubs | {ACRES_DRIP} ac × 25 lbs/ac | {DRIP_LBS} lbs |
| Native Grass | {ACRES_NATIVE} ac × 25 lbs/ac | {NATIVE_LBS} lbs |
| **Total** | | **{NEED_TOTAL} lbs** |

```
Site Annual Agronomic Need = {NEED_TOTAL} ÷ {TOTAL_ACRES}
                           = {NEED_PER_ACRE} lbs/acre
```

### Result

**Annual Nitrogen Loading: {LOADING} lbs/acre**
**Annual Nitrogen Agronomic Need: {NEED_PER_ACRE} lbs/acre**
**{LOADING} < {NEED_PER_ACRE} — The nitrogen loading is less than the agronomic need. Application is at or below agronomic rates. ✅**

---

## Summary Table

| Filing | Irrigated Acres | Annual Water (gal) | N Loading (lbs/ac) | N Need (lbs/ac) | Pass? |
|--------|-----------------|--------------------|--------------------|-----------------|-------|
| {FILING} | {TOTAL_ACRES} | {GALLONS} | {LOADING} | {NEED_PER_ACRE} | ✅ |

---

## Required Documentation Checklist

Per CDPHE guidance, the following documentation is included in this analysis:

- [x] **(a)** Statement that the **Calculated Method – Option C** is being used for the required analysis
- [x] **(b)** The loading calculations from Step 1, including the total nitrogen loading
- [x] **(c)** A list of the vegetation types present, the nitrogen agronomic need in lbs/acre for each type, and the source of the nitrogen agronomic need values used (CDPHE Table 1)
- [x] **(d)** The acres for each vegetation type
- [x] **(e)** The agronomic need calculation completed in accordance with Option C, including the annual nitrogen need
- [x] **(f)** Statement that the annual site-wide nitrogen load documented in (b) is less than the annual site-wide nitrogen need documented in (e)

---

## Irrigation System Description

The irrigation system is designed to apply reclaimed water at or below agronomic rates through the following measures:

- **Turf areas** (bluegrass) are irrigated with {TURF_SPRINKLER_TYPE} at {TURF_EFFICIENCY} efficiency
- **Trees and shrubs** are irrigated with drip irrigation ({DRIP_TYPE}), calibrated to meet the agronomic need of the plants present
- **Native grass areas** are irrigated with {NATIVE_SPRINKLER_TYPE} at {NATIVE_EFFICIENCY} efficiency, with a plant coefficient of 0.3 (vs. 0.88 for bluegrass), significantly reducing water application
- **Rain sensors** ({RAIN_SENSOR_TYPE}) are installed at each controller to interrupt irrigation during and after precipitation events
- **Smart controllers** ({CONTROLLER_TYPE}) provide ET-based scheduling to match plant water requirements
- The irrigation system is designed to irrigate only the intended landscape areas and avoid spraying water on buildings, domestic drinking water facilities, or other areas where human contact with reclaimed water is possible
- Irrigation is timed to take place during low-use times of day, and in high-use areas, irrigation will cease with enough time for drying prior to typical use

---

## References

1. CDPHE, *Guidance for Completing Nitrogen Agronomic Rate Analysis for Reclaimed Water Users and Treaters*, May 23, 2017
2. CDPHE, *WQP-21: Guidelines for the Determination of Agronomic Rate for Application of Reclaimed Water under Colorado Regulation 84*
3. Colorado Regulation 84, 5 CCR 1002-84, effective August 14, 2022
4. Denver Water UASMP Cheat Sheet, April 2024
5. Denver Water, *Water Budget — {PROJECT_NAME}*, {BUDGET_DATE}
6. The Irrigation Engineers, *Irrigation Plans {PROJECT_NAME}*, {PLAN_DATE}
