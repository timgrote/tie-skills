# Known IDs

Cached client/contact/employee IDs for quick lookup without hitting the API.

## Clients

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
| DAZBOG COFFEE | — | — |
| Mosaic | — | — |

## Employees

| Name | ID | Email |
|---|---|---|
| Tim Grote | `emp-0fa11894` | tim@irrigationengineers.com |
| Ally Liebow | `emp-6909261c` | ally@irrigationengineers.com |
| matara | `emp-53831094` | matara@irrigationengineers.com |

## ID Formats

- Projects: `proj-xxxxxxxx`
- Clients: `c-xxxxxxxx`
- Contacts: `ct-xxxxxxxx`
- Contracts: `con-xxxxxxxx`
- Contract tasks: `ctask-xxxxxxxx`
- Invoices: `inv-xxxxxxxx`
- Proposals: `prop-xxxxxxxx`
- Employees: `emp-xxxxxxxx`

## Notes

- Query `/api/clients` to get the full current list with contact IDs
- New clients added after the skill was written won't appear here — hit the API for fresh data
