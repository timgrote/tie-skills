---
name: regulation-84-permits
description: "CO Reg 84 reclaimed water permit docs for TIE irrigation."
version: 1.0.0
author: Hermes
tags: [regulation-84, uasmp, reclaimed-water, recycled-water, denver-water, agronomic-rate, permits, irrigation, tie]
---

# Regulation 84 Reclaimed Water Permits

Prepare Colorado Regulation 84 (Reclaimed Water Control Regulation) permit documentation for TIE irrigation projects that use recycled/reclaimed water.

## When This Applies

Any TIE irrigation project where the water source is recycled/reclaimed water (Denver Water's recycled water system or another Treater). Triggered when:
- Project drawings show "recycled water" or "reclaimed water" piping/labels
- Denver Water irrigation plan approval mentions recycled water
- A Regulation 84 / UASMP permit folder appears in the project structure

## The Regulatory Framework

**Regulation 84** (5 CCR 1002-84) is the Colorado regulation governing use of reclaimed (recycled) domestic wastewater. For irrigation projects, it requires a **User Application and Site Management Plan (UASMP)** be submitted to CDPHE.

### Three Roles

| Role | Who | What they do |
|------|-----|--------------|
| **Treater** | Denver Water (usually) | Treats and supplies recycled water, fills out Part II of UASMP, has their own authorization (COE012000 for Denver Water) |
| **User** | Property owner/manager | Uses the recycled water, fills out Part I of UASMP, signs as Legally Responsible Individual |
| **Designer (TIE)** | Tim / Ally | Provides technical information the User needs: site maps, agronomic rate analysis, narrative descriptions of irrigation system compliance |

**TIE is neither the User nor the Treater.** TIE provides the technical attachments and narrative responses that the User incorporates into their UASMP submission.

### Key Facts (Denver Water as Treater)

- Treater Authorization Number: **COE012000**
- Water type: **Centralized, Category 3** (Denver Water provides Category 3 water)
- Access type: **Unrestricted-Access Landscape Irrigation** (publicly accessible)
- Denver Water contact: Damian Higham, 303-628-6537, damian.higham@denverwater.org
- Denver Water reviews Part I before filling out Part II and submitting to CDPHE
- Nitrogen content (TIN): **5.2 mg/L** as of 2025 — verify current year value with Denver Water

## What TIE Needs to Provide

The UASMP form requires three categories of input from the irrigation designer:

### 1. Agronomic Rate Analysis (Required Attachment E.3 — §84.9(A)(6))

**This is the major deliverable.** An analysis demonstrating that reclaimed water applied for irrigation will be at or below agronomic rates (nitrogen). See `references/agronomic-rate-analysis.md` for the full CDPHE methodology.

**Method selection** depends on site composition:
- **Simplified Method 1**: ≥90% turf grass → just state the method, no calculation needed
- **Simplified Method 2**: 100% drip irrigation → just state the method, no calculation needed
- **Simplified Method 3**: Mix of turf + 100% drip for non-turf → state the method
- **Calculated Method**: Two-step nitrogen analysis (Step 1: loading, Step 2: need) — see reference file
- **Site-Specific Method**: When calculated method doesn't pass, consult a certified agronomist

Most TIE projects have mixed vegetation (bluegrass + trees/shrubs + native grass) and won't qualify for Simplified Methods. Use the **Calculated Method, Option C** (aggregated need).

### 2. Site Maps (Required Attachments E.1 and E.2)

- **E.1** (§84.9(A)(5)): Map showing all areas where reclaimed water will be used/applied
- **E.2** (§84.9(A)(5)(b)): Map showing acreage/perimeter of irrigated site and type of landscape being irrigated

These can be on one map. The irrigation plan sheets (IR-1, IR-2, etc.) typically serve this purpose, but may need acreage callouts and vegetation type labels added.

### 3. Narrative Implementation Requirements (Sections C and D)

Descriptions of how the site complies with various Reg 84 requirements. See `references/uasmp-form-sections.md` for the section-by-section guide with example language adapted from Denver Water's cheat sheet.

Key sections where irrigation design knowledge is needed:
- C.1: How reclaimed water is used, public contact potential, water sources
- C.3: Purple pipe labeling (plans already show this)
- C.6: How irrigation is confined to authorized areas, avoids overspray
- D.1: Agronomic rate compliance (system design, rain sensors, smart controllers)
- D.2: Windblown spray control
- D.3: Flood and sheet irrigation prohibited (check YES)
- D.5: No reclaimed water piping to residential structures (check YES)

## Filling the UASMP PDF Form Directly

The UASMP form (WQC2017-2) is a **fillable PDF with 139 form fields** — text boxes for narratives, checkboxes for affirmations, and radio buttons for yes/no questions. Fill it directly with pymupdf instead of creating a separate narrative responses document for the client to transcribe.

**Tim wants to fill out the form himself** — produce a filled PDF, not a markdown document of narratives for the client to copy in.

### How to Fill PDF Form Fields

```python
import pymupdf

doc = pymupdf.open(r'C:\path\to\WQC2017-2.pdf')

# Text field
for w in doc[page_num - 1].widgets():
    if w.field_name == 'field name':
        w.field_value = 'your text'
        w.update()

# Checkbox
for w in doc[page_num - 1].widgets():
    if w.field_name == 'checkbox name':
        w.field_value = True
        w.update()

# Radio button (e.g., impoundment Yes/No — find by position, 2nd instance = No)
page = doc[page_num - 1]
count = 0
for w in page.widgets():
    if w.field_name == 'radio group name':
        count += 1
        if count == 2:  # second instance = "No"
            w.field_value = True
            w.update()

doc.saveIncr()  # or doc.save(new_path)
```

### Discovering Field Names

List all form fields on each page:
```python
for page in doc:
    for w in page.widgets():
        print(f"Page {page.number+1}: {w.field_type_string:12} | {w.field_name}")
```

### Key Form Fields by Page (WQC2017-2)

| Page | Section | Field name (partial match) | What to enter |
|------|---------|---------------------------|---------------|
| 2 | Header | `treater number` | COE012000 |
| 2 | Reason | `NEW USER AUTHORIZATION` | Check |
| 2 | A.2 | `Not Applicable` | Check (centralized, not localized) |
| 3 | A.5 | `Facility name` | Project name |
| 3 | A.5 | `Address` | From demand form |
| 3 | A.5 | `City_5`, `County`, `Zip_5` | From demand form |
| 3 | A.5 | `Latitude`, `Longitude` | Estimate, flag for verification |
| 4 | B | `Category 3` | Check |
| 4 | C.1 | `reclaimed water and list all` | Narrative |
| 4 | C.2 | `accordance with sections 846F12` | Narrative |
| 5 | C.3 | `RECLAIMED WATER NOT FOR DRINKING` | Narrative |
| 5 | C.4 | `required in section 846F4` | Placeholder for client |
| 5 | C.5 | `nonpotable water is in use` | Narrative |
| 5 | C.6 | `prepared` | Narrative |
| 6 | C.7 | `require reporting` | Narrative |
| 6 | C.8 | `accordance with 2586012` | Narrative |
| 6 | C.9 | `YES Operation of the reclaimed` | Check |
| 6 | C.10 | `requirements in section 8410B4e` | "Not applicable" |
| 6 | C.11 | `YES The User has coordinated` | Check |
| 7 | C.12 | `maintain an accurate UASMP` | Check (partial match — full name is long) |
| 7 | C.13 | `YES Users will report violations` | Check |
| 7 | C.14 | `YES Users will furnish` | Check |
| 7 | C.15 | `impoundment` radio | 2nd instance = No |
| 8 | D.1 | `application at evapotranspiration` | Narrative with calc results |
| 8 | D.2 | `Authorization` | Narrative |
| 8 | D.3 | `YES Flood and sheet` | Check |
| 9 | D.5 | `YES No reclaimed water piping` | Check |
| 10 | E.1 | `Attached A current map` | Check |
| 10 | E.2 | `Attached A map that indicates` | Check |
| 10 | E.3 | `Attached An analysis` | Check |

### Fields Left Blank for Client

- A.1 (User organization, legally responsible individual — name, title, phone, email, address)
- A.3 (Site contact)
- C.4 (training dates — placeholder text only)
- Section G (signature, date, printed name, title)
- Part II (pages 13-14 — Denver Water fills out)

### Saving the Filled Form

Copy the blank form to the output location, fill, then save:
```python
import shutil
shutil.copy2(src_blank, dst_filled)
doc = pymupdf.open(dst_filled)
# ... fill fields ...
doc.saveIncr()
```

## Building an Agronomic Rate Calculator Spreadsheet

In addition to the analysis document, produce an Excel spreadsheet with live formulas so the client can see the math and adjust inputs. Use the `xlsx` skill patterns (openpyxl, blue input cells, formula-driven results).

Key structure:
- **Summary sheet** — linked to detail sheets
- **Inputs sheet** — TIN, conversion factor, CDPHE Table 1 reference
- **Per-filing sheet** — site composition table, Step 1 loading, Step 2 need, pass/fail

Verify formulas with LibreOffice recalc on Windows:
```bash
"/c/Program Files/LibreOffice/program/soffice.exe" --headless --calc --convert-to xlsx --outdir /tmp/recalc "input.xlsx"
```
Then read back with `openpyxl.load_workbook(path, data_only=True)` to verify cached values.

Note: The `xlsx` skill's `recalc.py` script uses Unix sockets and does NOT work on Windows. Use the `soffice.exe --headless --convert-to` approach instead.

## Workflow

1. **Review the project folder** for Reg 84 permit files (usually under a "Regulation 84 Permits" subfolder)
2. **Identify the UASMP form** (typically a PDF titled "WQC..." or "UASMP")
3. **Extract data from project files**: water budgets (irrigated acres by vegetation type, gallons/year), irrigation plans (system components, controllers, POC info), Denver Water demand forms (addresses, tap sizes)
4. **Perform the agronomic rate calculation** and verify with Python
5. **Write the agronomic rate analysis** markdown document
6. **Build the agronomic rate calculator** Excel spreadsheet
7. **Fill the UASMP PDF form** directly (narratives in text fields, checkboxes, radio buttons)
8. **Verify spreadsheet formulas** with LibreOffice recalc
9. **Deliver to client**: filled PDF, agronomic rate analysis (markdown/PDF), calculator spreadsheet, and irrigation plan sheets for attachments E.1–E.3
10. **Client completes**: contact info (A.1, A.3), training dates (C.4), signature (Section G), submits to Denver Water

## Extracting Local PDF/DOCX/XLSX on Windows

Local PDFs cannot be fetched via `web_extract` (blocks `file:///` URLs). Use `terminal` with `python -c`:

```bash
# Install if needed (persists in session)
pip install pymupdf python-docx openpyxl

# Extract PDF text
python -c "
import pymupdf
doc = pymupdf.open(r'C:\path\to\file.pdf')
for i, page in enumerate(doc):
    text = page.get_text('text')
    if text.strip():
        print(f'--- Page {i+1} ---')
        print(text[:8000])
"

# Extract DOCX
python -c "
from docx import Document
doc = Document(r'C:\path\to\file.docx')
for para in doc.paragraphs:
    if para.text.strip():
        print(para.text)
"

# Extract XLSX
python -c "
import openpyxl
wb = openpyxl.load_workbook(r'C:\path\to\file.xlsx', data_only=True)
for ws in wb.worksheets:
    for row in ws.iter_rows(values_only=False):
        vals = [str(c.value) if c.value is not None else '' for c in row]
        if any(v for v in vals):
            print(' | '.join(vals))
"
```

The `execute_code` sandbox may not have these packages — use `terminal` with `python -c` after `pip install`.

## Key Data Sources in TIE Projects

| Source | Location | What it provides |
|--------|----------|-----------------|
| Water Budget spreadsheets | `<project>/Water Budgets/water-budget-F*.xlsx` | Irrigated acres by vegetation type, gallons/year, acre-feet/year, peak GPM |
| Water Budget PDFs | `<project>/Water Budgets/Water Budget - F*.pdf` | Same data in PDF form |
| Denver Water Demand Forms | `<project>/Water Demand Worksheets (DenverWater)/` | Property address, tap size, irrigation area (sq ft), max GPM |
| Irrigation Plans | `<project>/drawings/Irrigation Plans *.pdf` | POC info, controller types, sprinkler types, runtime schedules, vegetation types per station |
| Reg 84 permit folder | `<project>/Regulation 84 Permits/` | UASMP form, cheat sheet, regulation text, Denver Water sign template |

## Reference Files

- `references/agronomic-rate-analysis.md` — Full CDPHE methodology for nitrogen agronomic rate analysis (Simplified Methods, Calculated Method, vegetation need values, formula, documentation requirements)
- `references/uasmp-form-sections.md` — Section-by-section guide to the UASMP form with what TIE provides and example language
- `templates/agronomic-rate-analysis-template.md` — Fill-in-the-blanks template for the agronomic rate analysis deliverable (copy, replace {PLACEHOLDERS}, verify calculations with Python)
- `templates/uasmp-narrative-responses-template.md` — Fill-in-the-blanks template for UASMP sections C, D, E, and G narrative responses

## Key References

- CDPHE Reclaimed Water Permits: https://cdphe.colorado.gov/water-quality-reclaimed-water-reuse-permits
- CDPHE Agronomic Rate Guidance: https://drive.google.com/open?id=1291bopErYrOEJsOML2f-YRGZuDjuJCIX
- CDPHE WQP-21 Policy: https://drive.google.com/open?id=17RA0i5-QL20ssNgEZOT52A4njsWl8-2y
- Colorado Regulation 84 (full text): https://www.sos.state.co.us/CCR/GenerateRulePdf.do?ruleVersionId=10301
- Denver Water Recycled Water: Damian Higham, 303-628-6537, damian.higham@denverwater.org
- Raindrop agronomic calculator feature request: https://github.com/timgrote/Raindrop/issues/711

1. **TIN value changes yearly** — Denver Water's cheat sheet says 5.2 mg/L for 2025; verify the current year's value before calculating
2. **TIE doesn't sign the UASMP** — The Legally Responsible Individual (property owner/VP-level person) signs Part I; Denver Water signs Part II
3. **Don't use Simplified Method 1 for native grass** — The 174 lbs/acre turf value only applies to bluegrass/ryegrass, NOT buffalo grass, fescues, or native grasses
4. **Trees/shrubs on drip can be excluded** from the Calculated Method if needed (see reference file), but including them with the 25 lbs/acre conservative default usually works fine
5. **F2 and F4 are separate filings** — each needs its own UASMP, its own agronomic rate analysis, its own maps
6. **Section F (Localized Systems) does not apply** — Denver Water is a centralized system; skip this section
7. **Sections D.6, D.7, D.8** apply only to Category 1 water and resident-controlled irrigation — skip for Denver Water Category 3 unrestricted access
8. **Always verify calculations with Python** — use `execute_code` or `terminal` with Python to verify all arithmetic (loading, need totals, per-acre values) before finalizing. The conversion factor 8.34 = (3.785 × 1,000,000) ÷ 453,592 = 8.3459..., so use full precision (not 0.724 when you mean 724,212 gallons = 0.7242 Mgal). Rounding intermediate values can cause off-by-0.1 discrepancies between documents. Use 4+ significant digits for million-gallon values in the formula.

9. **Address source varies by project.** The property address may appear on Denver Water Demand Forms (in the form fields at the bottom of the PDF), water budget spreadsheets, or irrigation plan POC notes. Check all three — demand forms are usually the most reliable since they were filled out for the tap application.

10. **Native grass efficiency may differ.** E2 used 65% spray efficiency for native grass (vs. 70% for rotor on F2/F4). The efficiency value comes from the water budget spreadsheet, not a fixed assumption. Check each project's water budget for the actual system efficiency per vegetation type.

11. **Fill the PDF form directly, don't produce a separate narratives document.** Tim wants to fill out the UASMP form himself and return a completed PDF to the client — not hand the client a markdown document to transcribe. Use pymupdf to fill the form fields, checkboxes, and radio buttons directly.

12. **The xlsx skill's recalc.py does not work on Windows** — it uses Unix sockets. Use `soffice.exe --headless --convert-to xlsx --outdir /tmp/recalc` as a workaround, then read back with `openpyxl.load_workbook(path, data_only=True)` to verify cached formula values.
