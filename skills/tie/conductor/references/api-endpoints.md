# Full API Endpoint Reference

Complete list of all 92 routes from the OpenAPI schema at `/openapi.json`.
Routes requiring auth (`Not authenticated` error) are marked — the Tailscale-internal
API keyless access works for most CRUD routes but not for session-based ones.

## Projects

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/projects` | GET, POST | List all / create |
| `/api/projects/{project_id}` | GET, PATCH, DELETE | Full detail with nested contracts, invoices, proposals |
| `/api/projects/{project_id}/tasks` | GET, POST | Project-level tasks (assignees, due dates, priorities) |
| `/api/projects/{project_id}/deliverables` | GET, POST | Tracked deliverables (status, progress, deadline) |
| `/api/projects/{project_id}/invoices` | POST | Create invoice for project |
| `/api/projects/{project_id}/contacts` | GET, POST | Project contact associations |
| `/api/projects/{project_id}/contacts/{contact_id}` | DELETE | Remove contact from project |
| `/api/projects/{project_id}/notes` | GET, POST | Project notes |
| `/api/projects/notes/{note_id}` | GET, PATCH, DELETE | Note CRUD |
| `/api/updates/projects/{project_id}/stream` | GET | Activity stream (may timeout) |

## Tasks (project-level)

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/tasks/my` | GET | ⚠️ Returns non-list (needs auth session?) |
| `/api/tasks/done-today` | GET | Returns dict (needs auth session?) |
| `/api/tasks/tags` | GET | Returns `[]` (no tags in use yet) |
| `/api/tasks/bulk` | DELETE, PATCH | Bulk task operations |
| `/api/tasks/reorder` | PATCH | Reorder tasks |
| `/api/tasks/{task_id}` | GET, PATCH, DELETE | Task CRUD |
| `/api/tasks/{task_id}/notes` | POST | Add note to task |

⚠️ **No global `/api/tasks` GET endpoint that returns JSON.** `/api/tasks` returns the SPA HTML.
To list tasks across all projects, fetch `/api/projects/{id}/tasks` per project.
This is the main API gap for workload queries — a global tasks endpoint with
filtering by assignee, date range, and status would eliminate N+1 calls.

## Contracts

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/contracts` | POST | Create only (GET returns HTML) |
| `/api/contracts/{contract_id}` | GET, PATCH, DELETE | Contract detail with tasks |
| `/api/contracts/{contract_id}/tasks` | POST | Add contract task (billing line item) |
| `/api/contracts/{contract_id}/tasks/{task_id}` | PATCH, DELETE | Contract task CRUD |
| `/api/contracts/{contract_id}/deliverables` | POST | Create deliverable |
| `/api/contracts/{contract_id}/invoices` | POST | Create invoice from contract |
| `/api/contracts/{contract_id}/next-invoice-number` | GET | Next invoice number for contract |

## Deliverables

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/deliverables/{deliverable_id}` | PATCH, DELETE | Deliverable CRUD |
| `/api/projects/{project_id}/deliverables` | GET, POST | List/create per project |
| `/api/contracts/{contract_id}/deliverables` | POST | Create from contract |

## Invoices

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/invoices` | GET | List all invoices |
| `/api/invoices/{invoice_id}` | GET, PATCH, DELETE | Invoice CRUD |
| `/api/invoices/by-number/{invoice_number}` | GET | Lookup by invoice number |
| `/api/invoices/{invoice_id}/send` | POST | Mark as sent |
| `/api/invoices/{invoice_id}/finalize` | POST | Finalize invoice |
| `/api/invoices/{invoice_id}/create-next` | POST | Create next invoice in series |
| `/api/invoices/{invoice_id}/export-pdf` | POST | Export PDF |
| `/api/invoices/{invoice_id}/generate-sheet` | POST | Generate Google Sheet |

## Clients & Contacts

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/clients` | GET, POST | Client CRUD |
| `/api/clients/{client_id}` | GET, PATCH, DELETE | Client detail |
| `/api/clients/{client_id}/notes` | GET, POST | Client notes |
| `/api/clients/notes/{note_id}` | GET, DELETE | Note CRUD |
| `/api/contacts` | GET, POST | Contact CRUD (27 contacts) |
| `/api/contacts/import` | POST | Bulk import contacts |
| `/api/contacts/{contact_id}` | GET, PATCH, DELETE | Contact detail |
| `/api/contacts/{contact_id}/projects` | GET | Projects for a contact |
| `/api/contacts/{contact_id}/notes` | GET, POST | Contact notes |
| `/api/contacts/notes/{note_id}` | GET, DELETE | Note CRUD |

## Proposals

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/proposals` | GET, POST | Proposal CRUD |
| `/api/proposals/defaults` | GET | Default proposal settings |
| `/api/proposals/generate` | POST | Generate proposal |
| `/api/proposals/{proposal_id}` | GET, PATCH, DELETE | Proposal detail |
| `/api/proposals/{proposal_id}/tasks` | POST | Add task to proposal |
| `/api/proposals/{proposal_id}/tasks/{task_id}` | PATCH, DELETE | Proposal task CRUD |
| `/api/proposals/{proposal_id}/send` | POST | Send proposal |
| `/api/proposals/{proposal_id}/promote` | POST | Promote proposal to project/contract |
| `/api/proposals/{proposal_id}/export-pdf` | POST | Export PDF |
| `/api/proposals/{proposal_id}/download-pdf` | GET | Download PDF |
| `/api/proposals/{proposal_id}/generate-doc` | POST | Generate doc |

## Time Entries

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/time-entries` | GET, POST | List/create time entries |
| `/api/time-entries/summary` | GET | Summary (requires `project_id` query param) |
| `/api/time-entries/{entry_id}` | GET, PATCH, DELETE | Time entry CRUD |

## Employees

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/employees` | GET, POST | List/create employees |
| `/api/employees/{employee_id}` | GET, PATCH, DELETE | Employee CRUD |

## Activity & Updates

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/activity-log` | GET | ⚠️ Returns `{"detail": ...}` (needs auth?) |
| `/api/activity-log/mappings` | GET, POST | Activity log mappings |
| `/api/activity-log/mappings/{mapping_id}` | DELETE | Delete mapping |
| `/api/activity-log/overrides` | POST | Override activity log |

## Auth (session-based — not usable via curl without cookies)

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/auth/login` | POST | Login |
| `/api/auth/logout` | POST | Logout |
| `/api/auth/me` | GET | Current user |
| `/api/auth/avatar` | POST | Upload avatar |
| `/api/auth/settings` | GET, PUT | Auth settings |
| `/api/auth/signup` | POST | Signup |
| `/api/auth/reset-password` | POST | Reset password |
| `/api/auth/reset-request` | POST | Request reset |

## Calendar & Overview (auth-gated)

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/calendar` | GET | ❌ Requires auth |
| `/api/overview/items` | GET | ❌ Requires auth |

## Raindrop Integration

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/raindrop/analytics` | GET | Raindrop usage analytics |
| `/api/raindrop/events` | GET | Raindrop events |
| `/api/raindrop/exceptions` | GET | Raindrop exceptions |
| `/api/raindrop/leaderboard` | GET | User leaderboard |
| `/api/raindrop/trials` | GET | Trial users |
| `/api/raindrop/warnings` | GET | Raindrop warnings |
| `/api/raindrop/yearly` | GET | Yearly stats |

## Other

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/company` | GET, PUT | Company settings |
| `/api/company/database` | GET, PUT | Company database settings |
| `/api/company/logo` | POST | Upload logo |
| `/api/flows/contracts` | POST | Public flow (contract) |
| `/api/flows/payments` | POST | Public flow (payment) |
| `/api/flows/proposals` | POST | Public flow (proposal) |
| `/api/uploads/images` | POST | Upload image |
| `/api/wiki` | GET, POST | Wiki/knowledge base |
| `/api/wiki/categories` | GET | Wiki categories |
| `/api/wiki/{note_id}` | GET, PATCH, DELETE | Wiki note CRUD |
