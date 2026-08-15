---
name: conductor
description: "Manage TIE projects via Conductor API at tie-conductor."
version: 1.0.0
author: Hermes
tags: [conductor, projects, contracts, invoices, proposals, api, irrigation, tie]
---

# Conductor

Manage TIE projects, contracts, invoices, and proposals via the Conductor API.

## Connection

- **URL:** `http://tie-conductor` (Tailscale-only, no auth headers needed)
- **Repo:** `~/Podium` (cloned from `timgrote/podium`)
- **Stack:** FastAPI + PostgreSQL + Vue 3 SPA
- **Deploy:** auto on push to `master`, droplet at `tie-conductor` (Tailscale name)

```bash
# Quick API test
curl -s "http://tie-conductor/api/projects" | head -c 200
```

## API Endpoints

The API has 92 routes. See `references/api-endpoints.md` for the complete reference.
Key endpoints used in common queries:

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/projects` | GET, POST | List all / create. List returns aggregate billing fields |
| `/api/projects/{id}` | GET, PATCH, DELETE | Full detail with nested contracts, invoices, proposals |
| `/api/projects/{id}/tasks` | GET, POST | **Project tasks** — assignees, due dates, priorities, subtasks |
| `/api/projects/{id}/deliverables` | GET, POST | Tracked deliverables with status/progress/deadline |
| `/api/projects/{id}/notes` | GET, POST | Project notes (author, content, timestamp) |
| `/api/contracts` | POST | Create only (GET returns SPA HTML) |
| `/api/contracts/{id}` | GET, PATCH, DELETE | Contract detail with contract_tasks |
| `/api/contracts/{id}/tasks` | POST | Add billing line item |
| `/api/invoices` | GET | List all invoices |
| `/api/invoices/{id}` | GET, PATCH, DELETE | Invoice CRUD |
| `/api/invoices/{id}/send` | POST | Mark as sent |
| `/api/contacts` | GET, POST | All contacts (name, email, phone, role, client_id) |
| `/api/contacts/{id}/notes` | GET, POST | Contact notes |
| `/api/clients` | GET, POST | Client CRUD |
| `/api/clients/{id}/notes` | GET, POST | Client notes |
| `/api/employees` | GET | Team members |
| `/api/time-entries` | GET, POST | Time tracking (employee, project, hours, date) |
| `/api/proposals` | GET, POST | Proposal CRUD |

⚠️ **No global `/api/tasks` GET.** Returns SPA HTML. Must fetch per-project.
⚠️ `/api/calendar`, `/api/overview/items`, `/api/tasks/my`, `/api/tasks/done-today`,
`/api/activity-log` — all require auth session (return `Not authenticated` via curl).

## Two Types of "Tasks"

**Project tasks** (`task-xxxxxxxx`) — actionable to-do items with assignees, due dates,
priorities, subtasks, notes, tags. This is the project management layer. Fetched via
`GET /api/projects/{id}/tasks`. Fields: `title`, `description`, `status` (todo/done),
`priority` (1-5), `due_date`, `assignees` (array of employee objects), `completed_at`,
`subtasks`, `notes`, `tags`, `is_stale`, `is_pinned`.

**Contract tasks** (`ctask-xxxxxxxx`) — billing line items on a contract. Track billing
progress per deliverable. Fetched via contract detail `GET /api/contracts/{id}`.
Fields: `name`, `description`, `amount`, `billed_amount`, `billed_percent`, `billing_type`.

When Tim asks about "workload" or "what's coming up" — that's **project tasks**.
When he asks about "billing" or "unbilled" — that's **contract tasks**.

## Creating a Project

```bash
curl -s -X POST "http://tie-conductor/api/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "project_number": "26-091",
    "project_name": "Project Name",
    "job_code": "CLIENT-Abbrev",
    "status": "active",
    "client_id": "c-xxxxxxxx",
    "client_pm_id": "ct-xxxxxxxx",
    "location": "City, ST",
    "data_path": "Client Name/Project Folder"
  }'
```

**Fields:**
- `project_number` — format `YY-NNN` (e.g., `26-091`). Query existing projects to find the next number.
- `job_code` — shorthand, typically `CLIENT-ABBREV` (e.g., `RVi-C3SWAT`, `TBG-VCOM`)
- `status` — `lead`, `active`, `contract`, `complete`, `archive`
- `client_id` — from `/api/clients` (e.g., RVi Planning = `c-089c23ab`)
- `client_pm_id` — contact ID from client's contacts (e.g., John Beggs = `ct-f7bc5250`)
- `data_path` — relative path in the TIE Dropbox folder (e.g., `RVi Planning/C3 Swat`)

**Only `project_name` is required.** All other fields are optional on creation.

## Creating a Contract

```bash
curl -s -X POST "http://tie-conductor/api/contracts" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "proj-xxxxxxxx",
    "total_amount": 1000,
    "notes": "Verbal contract - T&E up to $1,000"
  }'
```

### ⚠️ Pitfall: total_amount is NOT updatable via PATCH

The `PATCH /api/contracts/{id}` endpoint only accepts: `signed_at`, `file_path`, `notes`, `tasks`. 
The `total_amount` field is **set on creation only** (or computed from tasks). 
If you need to change the amount, **delete and recreate** the contract:

```bash
curl -s -X DELETE "http://tie-conductor/api/contracts/con-xxxxxxxx"
# Then POST a new one
```

## Known Client & Contact IDs

| Client | ID | Key Contacts |
|---|---|---|
| RVi Planning | `c-089c23ab` | John Beggs `ct-f7bc5250`, Melanie Carpenter `ct-da93722f`, Ryan Graycheck `ct-e9447a8b` |
| TBG | `c-683dcd10` | Cathy Mathis `ct-c8ebf0a7` |
| DR Horton | `c-658ba11a` | Jenn Simmons `ct-68530c80` |
| Kelly | `c-1655b68b` | Kelly Hyzy `ct-7c10a19d` |
| Birdsall | `c-4c207708` | Jim Birdsall `ct-5ebab003` |
| Scotchboy | `c-fe2a24c3` | — |
| Landmark | `c-ce216259` | — |
| Legacy Park | `c-3f1d2dd3` | — |
| Cheyenne | `c-d353aa50` | — |
| Bonfire | `c-f3edbf1a` | — |
| Bellisimo | `c-24759617` | — |
| Iron Fire Development | `c-37b53f82` | — |
| STUDIOPLAATS | `c-a6c27476` | Shane Fagen `ct-2d284f97` |
| Sarah Williams (Creative Pathways) | `c-c0e771ae` | — |
| TABS LLC | `c-ea9fc557` | — |

## Team Members (Employees)

| Name | ID | Email |
|---|---|---|
| Tim Grote | `emp-0fa11894` | tim@irrigationengineers.com |
| Ally Liebow | `emp-6909261c` | ally@irrigationengineers.com |
| matara | `emp-53831094` | matara@irrigationengineers.com |

## JSON Parsing Pitfall

The API returns JSON with control characters (e.g., newlines in string values). Standard `json.loads()` will fail. Use:

```python
json.loads(text, strict=False)
# or hermes_tools.json_parse(text)
```

## Browser Access

The browser tool (Browserbase) does **NOT** have Tailscale access. Do not attempt to open `http://tie-conductor` in the browser — it will hit a login wall or 403. All API interaction must go through `curl` or Python via the terminal.

To let the user view a project, share the URL directly:
```
http://tie-conductor/projects/{project_id}
```

## Status Workflow

```
lead → contract → active → complete → archive
```

## Project Number Convention

Format: `YY-NNN` (e.g., `26-091`). Query all projects and find the highest existing number to determine the next one:

```bash
curl -s "http://tie-conductor/api/projects" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
nums = [int(p['project_number'].split('-')[1]) for p in data if p.get('project_number','').startswith('26-') and p['project_number'].split('-')[1].strip().isdigit()]
print(f'Next: 26-{max(nums)+1:03d}')
"
```

## Job Code Convention

Format: `CLIENT-ABBREVIATION` (e.g., `RVi-C3SWAT`, `TBG-VCOM`, `DRH-Silver Peaks`, `kly-PBC`). No strict standard — use the client prefix followed by a short project identifier.

## Database Schema (Key Tables)

- `projects` — core entity, IDs are generated text like `proj-xxxxxxxx`
- `clients` — companies/entities, IDs like `c-xxxxxxxx`
- `contacts` — people at clients, IDs like `ct-xxxxxxxx`
- `contracts` — agreements, IDs like `con-xxxxxxxx`, linked to projects
- `contract_tasks` — line items on contracts with billing tracking
- `invoices` — billing docs, IDs like `inv-xxxxxxxx`
- `invoice_line_items` — line items on invoices
- `proposals` — proposals, IDs like `prop-xxxxxxxx`
- `employees` — team members, IDs like `emp-xxxxxxxx`

All tables use soft deletes (`deleted_at` column). Queries must filter `WHERE deleted_at IS NULL`.

## Common Queries

Ready-to-use Python snippets for frequent questions. All use `curl -s` piped to `python -c`
with `strict=False` for the JSON parsing pitfall.

### Invoicing total for a month

```bash
curl -s "http://tie-conductor/api/invoices" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
month = '2026-08'  # change as needed
month_invs = [i for i in data if not i.get('deleted_at') and month in (i.get('sent_at') or i.get('created_at') or '')]
total = sum(i.get('total_due', 0) or 0 for i in month_invs)
print(f'Invoices in {month}: {len(month_invs)}, Total: \${total:,.2f}')
for i in sorted(month_invs, key=lambda x: x.get('sent_at') or x.get('created_at') or ''):
    dt = (i.get('sent_at') or i.get('created_at') or '')[:10]
    print(f'  {dt}  \${i.get(\"total_due\",0):>10,.2f}  {i.get(\"invoice_number\",\"?\"):30s}  {i.get(\"sent_status\",\"?\")}/{i.get(\"paid_status\",\"?\")}')
"
```

Key fields: `total_due` (amount), `sent_at` (when sent), `paid_status` (`paid`/`unpaid`),
`sent_status` (`sent`/`unsent`). Filter on `sent_at` falling back to `created_at`.
Exclude soft-deleted with `if not i.get('deleted_at')`.

### Upcoming deliverables/deadlines (next N weeks)

The project list endpoint returns `next_task_deadline` — a project-level field (not per-task).
Filter projects by this date to find what's coming up:

```bash
curl -s "http://tie-conductor/api/projects" | python -c "
import sys, json
from datetime import datetime, date
data = json.loads(sys.stdin.read(), strict=False)
today = date.today()
weeks = 2  # change as needed
end = date.fromordinal(today.toordinal() + weeks * 7)
upcoming = []
for p in data:
    if p.get('status') in ('complete', 'archive'):
        continue
    nd = p.get('next_task_deadline')
    if not nd:
        continue
    try:
        d = datetime.fromisoformat(nd.replace('Z','+00:00')).date()
    except:
        continue
    if today <= d <= end:
        upcoming.append((d, p))
upcoming.sort(key=lambda x: x[0])
for d, p in upcoming:
    print(f'  {d.isoformat()}  {p.get(\"project_number\",\"?\"):8s}  {p.get(\"project_name\",\"?\"):30s}  {p.get(\"client_name\",\"?\"):20s}  {p.get(\"status\",\"?\")}')
"
```

Then fetch each project's contract tasks for detail:

```bash
curl -s "http://tie-conductor/api/projects/{id}" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
for c in data.get('contracts', []):
    print(f'Contract: {c[\"id\"]}  total=\${c.get(\"total_amount\",0)}')
    for t in c.get('tasks', []):
        pct = t.get('billed_percent', 0)
        status = 'done' if pct >= 100 else 'pending' if t.get('billed_amount',0) == 0 else f'{pct:.0f}% billed'
        print(f'  [{status}]  {t.get(\"name\",\"?\")}  \${t.get(\"amount\",\"?\")}  (billed \${t.get(\"billed_amount\",0)})')
"
```

### Unbilled contract value across all active/contract projects

```bash
curl -s "http://tie-conductor/api/projects" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
# Collect project IDs for active/contract projects
ids = [p['id'] for p in data if p.get('status') in ('active','contract') and not p.get('deleted_at')]
print(f'Fetching {len(ids)} projects...')
" 2>&1
# Then loop: for pid in <ids>; do curl -s \"http://tie-conductor/api/projects/$pid\" | python -c '...'
```

Note: The list endpoint doesn't nest contracts. You must fetch each project detail
individually via `GET /api/projects/{id}` to get contract tasks. The list endpoint
does return `total_contracted`, `total_invoiced`, `total_paid`, `total_outstanding`
as aggregate fields per project — use those for a quick summary without fetching details.

### Outstanding (unpaid) invoices

```bash
curl -s "http://tie-conductor/api/invoices" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
unpaid = [i for i in data if not i.get('deleted_at') and i.get('paid_status') == 'unpaid' and i.get('sent_status') == 'sent']
total = sum(i.get('total_due', 0) or 0 for i in unpaid)
print(f'Outstanding sent/unpaid: {len(unpaid)}, Total: \${total:,.2f}')
for i in sorted(unpaid, key=lambda x: x.get('sent_at','')):
    print(f'  {(i.get(\"sent_at\") or \"\")[:10]}  \${i.get(\"total_due\",0):>10,.2f}  {i.get(\"invoice_number\",\"?\")}  {i.get(\"project_name\",\"?\")}')
"
```

### Next project number

```bash
curl -s "http://tie-conductor/api/projects" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
nums = [int(p['project_number'].split('-')[1]) for p in data if p.get('project_number','').startswith('26-') and p['project_number'].split('-')[1].strip().isdigit()]
print(f'Next: 26-{max(nums)+1:03d}')
"
```

### Key field reference

**Projects (list):** `id`, `project_number`, `job_code`, `project_name`, `status`,
`client_name`, `pm_name`, `location`, `data_path`, `total_contracted`, `total_invoiced`,
`total_paid`, `total_outstanding`, `next_task_deadline`, `last_activity`, `contract_count`,
`invoice_count`, `proposal_count`

**Projects (detail):** adds nested `contracts` array, each with `tasks` array

**Contract tasks:** `id`, `name`, `description`, `amount`, `billed_amount`,
`billed_percent`, `billing_type` (`fixed`), `sort_order`

**Invoices:** `id`, `invoice_number`, `project_id`, `contract_id`, `type` (`task`),
`total_due`, `sent_status` (`sent`/`unsent`), `paid_status` (`paid`/`unpaid`),
`sent_at`, `paid_at`, `invoice_date`, `due_date`, `project_name`, `client_name`

### Past-due invoices (30+ days)

Invoice `due_date` is never set in practice. Use `sent_at` + 30 days as the threshold:

```bash
curl -s "http://tie-conductor/api/invoices" | python -c "
import sys, json
from datetime import datetime, date, timedelta
data = json.loads(sys.stdin.read(), strict=False)
cutoff = date.today() - timedelta(days=30)
past_due = []
for i in data:
    if i.get('deleted_at') or i.get('paid_status') == 'paid':
        continue
    sent = i.get('sent_at') or ''
    if not sent:
        continue
    try:
        d = datetime.fromisoformat(sent.replace('Z','+00:00')).date()
    except:
        continue
    if d < cutoff:
        days_over = (date.today() - d).days
        past_due.append((days_over, i))
past_due.sort(key=lambda x: -x[0])
total = sum(i.get('total_due', 0) or 0 for _, i in past_due)
print(f'Past-due (30+ days, unpaid): {len(past_due)}, Total: \${total:,.2f}')
for days, i in past_due:
    print(f'  {days:>3}d  \${i.get(\"total_due\",0):>10,.2f}  {i.get(\"invoice_number\",\"?\"):30s}  {i.get(\"project_name\",\"?\")}  {(i.get(\"sent_at\") or \"\")[:10]}')
"
```

### Workload by person (next N weeks)

Fetches all active/contract project tasks, filters by assignee and due date range.
No global task endpoint — must fetch per-project:

```bash
curl -s "http://tie-conductor/api/projects" | python -c "
import sys, json, urllib.request
from datetime import datetime, date, timedelta

data = json.loads(sys.stdin.read(), strict=False)
today = date.today()
end = today + timedelta(weeks=1)  # change as needed

# Employee filter — set to None for everyone, or emp ID
EMP_FILTER = None  # e.g. 'emp-0fa11894' for Tim, 'emp-6909261c' for Ally, 'emp-53831094' for matara

# Fetch tasks for active/contract projects
project_ids = [p['id'] for p in data if p.get('status') in ('active','contract','lead') and not p.get('deleted_at')]
project_lookup = {p['id']: p for p in data}

all_tasks = []
for pid in project_ids:
    try:
        resp = urllib.request.urlopen(f'http://tie-conductor/api/projects/{pid}/tasks')
        tasks = json.loads(resp.read(), strict=False)
        for t in tasks:
            if t.get('deleted_at'):
                continue
            if t.get('status') == 'done':
                continue
            if EMP_FILTER:
                assignee_ids = [a['id'] for a in t.get('assignees', [])]
                if EMP_FILTER not in assignee_ids:
                    continue
            due = t.get('due_date')
            if due:
                try:
                    d = datetime.fromisoformat(due.replace('Z','+00:00')).date()
                except:
                    continue
                if not (today <= d <= end):
                    continue
            all_tasks.append((pid, t))
    except:
        pass

all_tasks.sort(key=lambda x: (x[1].get('due_date') or '9999', x[1].get('priority') or 9))
print(f'Tasks due in next week: {len(all_tasks)}')
for pid, t in all_tasks:
    p = project_lookup.get(pid, {})
    due = (t.get('due_date') or 'no date')[:10]
    assignees = ', '.join(a.get('first_name','?') for a in t.get('assignees', []))
    print(f'  {due}  P{t.get(\"priority\",\"?\")}  {p.get(\"project_number\",\"?\"):8s}  {p.get(\"project_name\",\"?\"):25s}  {t.get(\"title\",\"?\"):30s}  [{assignees}]')
"
```

**Employee IDs for filtering:**
- Tim: `emp-0fa11894`
- Ally: `emp-6909261c`
- matara: `emp-53831094`

### Completed last week (by person)

Same structure but filter `status=done` and `completed_at` in date range:

```bash
curl -s "http://tie-conductor/api/projects" | python -c "
import sys, json, urllib.request
from datetime import datetime, date, timedelta

data = json.loads(sys.stdin.read(), strict=False)
today = date.today()
start = today - timedelta(days=7)

EMP_FILTER = None  # set to emp ID to filter by person

project_ids = [p['id'] for p in data if not p.get('deleted_at')]
project_lookup = {p['id']: p for p in data}

done_tasks = []
for pid in project_ids:
    try:
        resp = urllib.request.urlopen(f'http://tie-conductor/api/projects/{pid}/tasks')
        tasks = json.loads(resp.read(), strict=False)
        for t in tasks:
            if t.get('status') != 'done':
                continue
            if EMP_FILTER:
                assignee_ids = [a['id'] for a in t.get('assignees', [])]
                if EMP_FILTER not in assignee_ids:
                    continue
            comp = t.get('completed_at') or ''
            if comp:
                try:
                    d = datetime.fromisoformat(comp.replace('Z','+00:00')).date()
                except:
                    continue
                if not (start <= d <= today):
                    continue
            done_tasks.append((pid, t))
    except:
        pass

done_tasks.sort(key=lambda x: (x[1].get('completed_at') or ''))
print(f'Completed last 7 days: {len(done_tasks)}')
for pid, t in done_tasks:
    p = project_lookup.get(pid, {})
    comp = (t.get('completed_at') or '')[:10]
    assignees = ', '.join(a.get('first_name','?') for a in t.get('assignees', []))
    print(f'  {comp}  {p.get(\"project_number\",\"?\"):8s}  {p.get(\"project_name\",\"?\"):25s}  {t.get(\"title\",\"?\"):30s}  [{assignees}]')
"
```

### Add a note to a project

```bash
curl -s -X POST "http://tie-conductor/api/projects/{project_id}/notes" \
  -H "Content-Type: application/json" \
  -d '{"content": "Shane said to proceed with 65% CDs by Monday. T&E up to $2K."}'
```

Notes have: `id`, `project_id`, `author_id`, `author_name`, `content`, `created_at`.
The author is set automatically based on the session (may appear as the API user).

### Add a project task

```bash
curl -s -X POST "http://tie-conductor/api/projects/{project_id}/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Send 65% CD set to Shane",
    "description": "Per Shane email 8/14 — 65% CDs by Monday, 95% CDs later",
    "due_date": "2026-08-18",
    "priority": 3,
    "assignees": ["emp-53831094"]
  }'
```

Task fields: `title`, `description`, `status` (todo/done), `priority` (1-5),
`due_date`, `assignees` (array of emp IDs), `start_date`, `reminder_at`,
`tags`, `parent_id` (for subtasks).

### Add a note to a contact or client

```bash
# Contact note
curl -s -X POST "http://tie-conductor/api/contacts/{contact_id}/notes" \
  -H "Content-Type: application/json" \
  -d '{"content": "Called re: tap size confirmation. Waiting on callback."}'

# Client note
curl -s -X POST "http://tie-conductor/api/clients/{client_id}/notes" \
  -H "Content-Type: application/json" \
  -d '{"content": "New PM starting Sept 1 — Cathy Mathis handing off."}'
```

### Contact/company lookup

```bash
# All contacts (27 as of Aug 2026)
curl -s "http://tie-conductor/api/contacts" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
for c in data:
    print(f'  {c[\"id\"]:16s}  {c.get(\"name\",\"?\"):25s}  {c.get(\"email\",\"?\"):35s}  {c.get(\"phone\",\"?\"):15s}  {c.get(\"role\",\"?\"):20s}  client={c.get(\"client_id\",\"-\")}')
"

# All clients
curl -s "http://tie-conductor/api/clients" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
for c in data:
    print(f'  {c[\"id\"]:16s}  {c.get(\"name\",\"?\"):25s}  {c.get(\"email\",\"?\")}')
"

# Projects for a specific contact
curl -s "http://tie-conductor/api/contacts/{contact_id}/projects"
```

### Deliverables status for a project

```bash
curl -s "http://tie-conductor/api/projects/{project_id}/deliverables" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
for d in data:
    print(f'  [{d.get(\"status\",\"?\"):10s}]  {d.get(\"progress_percent\",0):.0f}%  {d.get(\"name\",\"?\")}  deadline={d.get(\"deadline\",\"-\")}  sent={d.get(\"sent_at\",\"-\")[:10]}')
"
```

Deliverable fields: `id`, `project_id`, `contract_task_id`, `name`, `status`
(e.g. `accepted`, `pending`), `progress_percent`, `deadline`, `sent_at`,
`updated_by`, `updated_by_name`.

### Time entries (by person or project)

```bash
# All time entries
curl -s "http://tie-conductor/api/time-entries" | python -c "
import sys, json
data = json.loads(sys.stdin.read(), strict=False)
for e in data:
    print(f'  {e.get(\"date\",\"?\"):10s}  {e.get(\"employee_name\",\"?\"):10s}  {e.get(\"hours\",0):.1f}h  {e.get(\"project_name\",\"?\"):25s}  {e.get(\"description\",\"\")}')
"
```

Fields: `employee_id`, `employee_name`, `project_id`, `project_name`, `hours`, `date`,
`description`, `contract_task_id`, `contract_task_name`.

## Key Field Reference

**Projects (list):** `id`, `project_number`, `job_code`, `project_name`, `status`,
`client_name`, `pm_name`, `pm_email`, `pm_id`, `client_pm_name`, `client_pm_email`,
`location`, `data_path`, `total_contracted`, `total_invoiced`, `total_paid`,
`total_outstanding`, `next_task_deadline`, `last_activity`, `contract_count`,
`invoice_count`, `proposal_count`

**Projects (detail):** adds nested `contracts` (each with `tasks`), `invoices`, `proposals`,
`notes`, `current_invoice_id`

**Project tasks:** `id`, `title`, `description`, `status` (todo/done), `priority` (1-5),
`due_date`, `start_date`, `reminder_at`, `assignees` (array: `{id, first_name, last_name, email}`),
`completed_at`, `created_by`, `is_stale`, `is_pinned`, `tags`, `subtasks`, `notes`,
`parent_id`, `sort_order`

**Contract tasks:** `id`, `name`, `description`, `amount`, `billed_amount`,
`billed_percent`, `billing_type` (`fixed`), `sort_order`

**Invoices:** `id`, `invoice_number`, `project_id`, `contract_id`, `type` (`task`),
`total_due`, `sent_status` (`sent`/`unsent`), `paid_status` (`paid`/`unpaid`),
`sent_at`, `paid_at`, `invoice_date`, `due_date` (usually null), `project_name`,
`client_name`, `client_email`, `pm_name`, `pm_id`

**Deliverables:** `id`, `project_id`, `contract_task_id`, `name`, `status`,
`progress_percent`, `deadline`, `sent_at`, `updated_by`, `updated_by_name`

**Contacts:** `id`, `name`, `email`, `phone`, `role`, `notes`, `client_id`

**Time entries:** `id`, `employee_id`, `employee_name`, `project_id`, `project_name`,
`hours`, `date`, `description`, `contract_task_id`, `contract_task_name`

**Project notes:** `id`, `project_id`, `author_id`, `author_name`, `author_avatar_url`,
`content`, `created_at`

## API Gaps (future Podium features)

1. **No global `/api/tasks` GET** — must fetch per-project. A global endpoint with
   filtering by assignee, date range, status would eliminate N+1 calls for workload queries.
2. **Auth-gated endpoints** — `/api/calendar`, `/api/overview/items`, `/api/tasks/my`,
   `/api/tasks/done-today`, `/api/activity-log` all require a session. An API key auth
   mode would unlock these.
3. **Invoice `due_date` never populated** — users don't fill it in. Consider defaulting
   to `sent_at + 30 days` or making it required on send.
4. **No `PATCH /api/projects/{id}/tasks/{task_id}`** — task updates go through
   `/api/tasks/{task_id}` (separate from the project-scoped path). Not a gap, just
   a non-obvious routing pattern.

## Reference Files

- `references/api-endpoints.md` — complete 92-route reference from OpenAPI schema
- `references/known-ids.md` — cached client/contact/employee IDs for quick lookup
