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

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/projects` | GET, POST | List all / create. GET returns nested contracts, invoices, proposals |
| `/api/projects/{id}` | GET, PATCH, DELETE | Full detail view |
| `/api/clients` | GET, POST | Client CRUD |
| `/api/clients/{id}` | GET, PATCH | Client detail |
| `/api/contracts` | GET, POST | Contract CRUD |
| `/api/contracts/{id}` | GET, PATCH, DELETE | Contract detail with tasks |
| `/api/invoices` | GET, POST | Invoice management |
| `/api/invoices/{id}` | GET, PATCH | With line items |
| `/api/proposals` | GET, POST | Proposal CRUD |
| `/api/tasks` | GET, POST | Project task management |
| `/api/employees` | GET | Team members |
| `/api/company` | GET, PUT | Company settings |
| `/api/flows/{id}` | GET | Public client-facing pages (no auth) |

Standard CRUD: `GET /` (list), `GET /{id}` (detail), `POST /` (create), `PATCH /{id}` (update), `DELETE /{id}` (soft delete).

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

## Reference Files

- `references/known-ids.md` — cached client/contact/employee IDs for quick lookup
