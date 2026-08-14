---
name: tie-file-manager
description: "Manage TIE project folders and file operations."
version: 1.0.0
author: Hermes
tags: [files, dropbox, projects, clients, irrigation, email-attachments, file-management]
---

# TIE File Manager

Manage the TIE (The Irrigation Engineers) project folder structure in Dropbox.

## Root Path

```
D:\Dropbox\TIE\
```

All paths below are relative to this root.

## Folder Hierarchy

```
TIE/
├── <Client Name>/                  ← one folder per client
│   ├── <Project Name>/             ← one folder per project
│   │   ├── from/                   ← files RECEIVED from client/consultant
│   │   │   └── YYYY-MM-DD/        ← date-stamped subfolders
│   │   ├── sent/                   ← files SENT to client
│   │   │   └── YYYY-MM-DD/        ← date-stamped subfolders
│   │   ├── drawings/               ← CAD (.dwg), PDFs, hydraulic calcs, .inp files
│   │   ├── Proposal-Invoices/      ← billing docs (also: invoices/, proposals/)
│   │   ├── RFI/                    ← Request for Information documents
│   │   ├── Reports/                ← project reports
│   │   └── <ProjectName>.md        ← optional project notes
│   └── Proposals/                  ← client-level proposals folder (sometimes)
├── Proposals/                      ← top-level proposals + templates
├── Admin/                          ← business admin
├── Templates/                      ← document templates
└── _PAST DUE INVOICES/
```

## Conventions

- **Client names** are the exact folder names (e.g., `RVi Planning`, `DR Horton`, `Mill Brothers`, `Forestar`)
- **Project names** are the exact subfolder names (e.g., `C3 Swat`, `Ave South`, `Erie PD`)
- **Date-stamped folders** use `YYYY-MM-DD` format (e.g., `2026-07-27`)
- **`from/`** receives files from clients — typically CAD files, comments, reference drawings
- **`sent/`** contains deliverables sent to clients — typically PDF plan sets
- **`drawings/`** is the working drawings folder — `.dwg`, `.pdf`, `.dsd`, `.inp`, `.log`, hydraulic analysis spreadsheets
- **Email attachments** from clients should be saved into `from/YYYY-MM-DD/` with today's date
- Some projects have topic-specific subfolders (e.g., `Booster Pump/`, `Meter Request Letter/`)
- Some projects lack `from/` or `sent/` if they're older or minimal

## Common Operations

### List clients
```bash
ls "D:/Dropbox/TIE/"
```

### List projects for a client
```bash
ls "D:/Dropbox/TIE/<Client Name>/"
```

### List project contents
```bash
ls "D:/Dropbox/TIE/<Client Name>/<Project Name>/"
```

### Save email attachment to project
1. Identify the attachment via Gmail API (see `google-workspace` skill)
2. Create date-stamped folder: `mkdir -p "D:/Dropbox/TIE/<Client>/<Project>/from/$(date +%Y-%m-%d)"`
3. Download attachment using the Gmail attachments API
4. Save to the date-stamped from/ folder

### Save a sent file
```bash
TODAY=$(date +%Y-%m-%d)
DEST="D:/Dropbox/TIE/<Client>/<Project>/sent/$TODAY"
mkdir -p "$DEST"
cp /path/to/file "$DEST/"
```

### Find a project by partial name
```bash
# Search across all clients
find "D:/Dropbox/TIE" -maxdepth 2 -type d -iname "*search term*"
```

### Create a new project folder with standard structure
```bash
PROJECT="D:/Dropbox/TIE/<Client>/<New Project>"
mkdir -p "$PROJECT"/{from,sent,drawings,Proposal-Invoices}
```

## Pitfalls

1. **Folder names have spaces** — always quote paths
2. **from/ may not exist** on older or minimal projects — create it with `mkdir -p` before saving
3. **Some clients have .md files at their level** (e.g., `RVi.md`, `DR Horton.md`) — these are notes, not projects
4. **Proposals can be at multiple levels** — client-level `Proposals/`, project-level `Proposal-Invoices/`, or top-level `TIE/Proposals/`
5. **sent/ subfolders are date-stamped** but from/ subfolders sometimes use the full date as the folder name directly (e.g., `2026-07-27/`), not prefixed
6. **Client names are proper nouns** — use exact casing: `RVi Planning` not `RVI Planning`
7. **The `_PAST DUE INVOICES` folder** uses underscore prefix — it's a special folder, not a client
