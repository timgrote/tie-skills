---
name: conductor-proposals
description: "Create irrigation proposals in Conductor with Google Doc generation."
version: 1.0.0
author: Tim Grote (timgrote), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [conductor, proposals, tie, irrigation, quoting]
    related_skills: [conductor, podium-api, google-workspace]
---

# Conductor Proposals

Create professional irrigation proposals in Conductor (Podium) and generate a
reviewable Google Doc. Covers the full flow: find the project, assemble scope
tasks from the template defaults, create the proposal, generate the Doc, and
hand the link to Tim for review.

## When to Use

- Tim asks you to create a proposal, quote, or T&E estimate for a project
- Tim forwards an email requesting a proposal and wants it entered in Conductor
- Tim says "give them a proposal for X scope at $Y"
- Don't use for: contracts (use the conductor skill's contract section),
  invoices (use the conductor skill's invoice section), or project creation
  without a proposal

## Prerequisites

- **Conductor API** at `http://tie-conductor` (Tailscale-only)
- **Auth:** Writes require a session cookie. Login via:
  ```python
  import json, urllib.request, http.cookiejar
  cj = http.cookiejar.CookieJar()
  op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
  op.open(urllib.request.Request('http://tie-conductor/api/auth/login',
      data=json.dumps({"email":"qa_test@conductor.test","password":"testtest"}).encode(),
      headers={'Content-Type':'application/json'}, method='POST'))
  ```
  Then use `op.open(...)` for all POST/PATCH calls. Reads (GET) work without auth.
- **Google Doc generation** happens server-side via Conductor's service account —
  no Google OAuth needed to *generate* the doc. But *reading* the doc content via
  the Google Docs API requires the Google Docs API to be enabled in the OAuth
  project (see Pitfalls).
- Load the `conductor` skill for full API reference and known client/contact IDs.

## Procedure

### 1. Find the Project

If Tim names a project, find it in Conductor:

```python
import json, urllib.request
resp = urllib.request.urlopen('http://tie-conductor/api/projects')
data = json.loads(resp.read(), strict=False)
for p in data:
    name = (p.get('project_name') or '').lower()
    client = (p.get('client_name') or '').lower()
    if any(k in name or k in client for k in ['keyword', 'keyword2']):
        print(f'{p["id"]:16s}  {p.get("project_number","?"):8s}  {p.get("project_name","?"):40s}  {p.get("client_name","?"):25s}  {p.get("status","?")}')
```

Match on project name, client name, or job code. If no match, Tim may need a new
project created first (see conductor skill's "Creating a Project" section).

**Check for existing proposals** on the project to avoid duplicates:
```python
resp = urllib.request.urlopen(f'http://tie-conductor/api/projects/{project_id}')
data = json.loads(resp.read(), strict=False)
print(f'Existing proposals: {len(data.get("proposals",[]))}')
```

### 2. Review Proposal Defaults (Template)

Conductor has built-in proposal task templates. Fetch them to match the standard
structure and wording:

```python
resp = urllib.request.urlopen('http://tie-conductor/api/proposals/defaults')
defaults = json.loads(resp.read(), strict=False)
```

**Default template tasks:**
- **Preliminary Irrigation Design** — coordinate water/power/landscape, calculate
  taps and water use, prepare preliminary plans with calculations, meter locations,
  mainline routing, irrigation types, details.
- **Irrigation Construction Documents** — prepare irrigation design and construction
  documents for final planting plans. Includes piping/sprinkler layout, hydraulic
  analysis, irrigation schedule, construction details, bid sheet with quantities.
- **Changes/On Call Coordination** — changes and modifications beyond initial
  submittals, answer RFIs during bidding, additional site visits and coordination.

**Engineer signatures** (from defaults):
- Tim Grote, P.E., Owner — 307.509.0238
- Ally Liebow, Principal — 970.224.4797
- Matara Liebow, Principal — 415.493.8567

**Hourly rates** (for T&E proposals):
- Professional Engineer: $180/hr
- Engineering Technician: $120/hr
- Designer: $120/hr

### 3. Assemble the Proposal

Determine the scope from Tim's instructions. Common patterns:

**Full design proposal** (preliminary + CDs + changes):
```python
tasks = [
    {"name": "Preliminary Irrigation Design", "amount": 1800, "billing_type": "fixed",
     "description": defaults['tasks'][0]['description']},
    {"name": "Irrigation Construction Documents", "amount": 3200, "billing_type": "fixed",
     "description": defaults['tasks'][1]['description']},
    {"name": "Changes/On Call Coordination", "amount": 600, "billing_type": "time_expense",
     "description": defaults['changes_task']['description']}
]
```

**Construction Administration T&E** (CA-only, like Lee Farm Phase 1):
```python
tasks = [
    {"name": "Construction Administration", "amount": 8000, "billing_type": "time_expense",
     "description": "Time and Expense, not to exceed $8,000. Scope includes: construction "
                    "phase support, irrigation drawing modifications and RFI responses, "
                    "site visits for pressure testing, walkthroughs, and on-call coordination."}
]
```

**Billing types:**
- `fixed` — lump sum per task
- `time_expense` — time and materials, typically with a not-to-exceed amount

### 4. Create the Proposal

```python
proposal = {
    'project_id': project_id,
    'total_fee': sum(t['amount'] for t in tasks),
    'tasks': tasks
}

req = urllib.request.Request('http://tie-conductor/api/proposals',
    data=json.dumps(proposal).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST')
resp = op.open(req)
result = json.loads(resp.read(), strict=False)
proposal_id = result['id']
```

### 5. Fix billing_type (if needed)

⚠️ **Pitfall:** The `POST /api/proposals` endpoint may default `billing_type` to
`fixed` even when `time_expense` is specified in the task payload. After creation,
PATCH each task that should be `time_expense`:

```python
for t in result['tasks']:
    if t['billing_type'] != 'time_expense' and original_task_was_time_expense:
        patch_req = urllib.request.Request(
            f'http://tie-conductor/api/proposals/{proposal_id}/tasks/{t["id"]}',
            data=json.dumps({'billing_type': 'time_expense'}).encode(),
            headers={'Content-Type': 'application/json'},
            method='PATCH')
        op.open(patch_req)
```

### 6. Generate the Google Doc

```python
doc_req = urllib.request.Request(
    f'http://tie-conductor/api/proposals/{proposal_id}/generate-doc',
    data=b'',
    headers={'Content-Type': 'application/json'},
    method='POST')
resp = op.open(doc_req)
result = json.loads(resp.read(), strict=False)
doc_url = result['data_path']  # Google Docs URL
```

The Doc is generated server-side using Conductor's Google service account. It
includes company header, proposal date, client info, scope tasks with
descriptions, total fee, engineer signature block, and contact info.

### 7. Open for Review

Open the Google Doc URL in the preview pane for Tim:

```
tool_call: open_preview, arguments: {"url": "<doc_url>"}
```

⚠️ The preview browser may not have Tim's Google session — the doc may show a
sign-in wall. Give Tim the raw URL to open in his browser directly:
```
https://docs.google.com/document/d/<doc_id>/edit
```

Also link the Conductor project view:
```
http://tie-conductor/projects/<project_id>
```

### 8. Report to Tim

Summarize:
- Project name and number
- Proposal ID and status (should be `draft`)
- Total fee and billing type
- Scope tasks with amounts
- Google Doc link
- Conductor project link

Tim will adjust the Google Doc directly. Don't send or promote the proposal
without his approval.

## Pitfalls

1. **billing_type defaults to `fixed` on creation** — even if you send
   `time_expense` in the task payload. PATCH each task afterward to fix.
2. **Auth required for writes** — GET works without cookies, but POST/PATCH
   need the session cookie from `/api/auth/login`. Use the QA account
   `qa_test@conductor.test` / `testtest`.
3. **Google Docs API may not be enabled** in the Hermes OAuth project — reading
   doc content via `$GAPI docs get <id>` fails with 403 "SERVICE_DISABLED".
   The doc still generates fine via Conductor's service account; just give Tim
   the URL to open in his own browser.
4. **Proposal stays in draft** — don't send or promote without Tim's approval.
5. **JSON parsing** — Conductor returns JSON with control characters. Always
   use `json.loads(text, strict=False)`.
6. **Email body may be empty** — Gmail's `get` command sometimes returns an
   empty body for multi-part emails. Read the thread instead, or use the
   snippet from search results.

## Verification

- [ ] Proposal created with correct project_id
- [ ] All tasks have correct billing_type (check via GET after PATCH)
- [ ] total_fee matches sum of task amounts
- [ ] Google Doc generated (data_path is a docs.google.com URL)
- [ ] Doc URL given to Tim for review
- [ ] Proposal status is `draft` (not sent)
