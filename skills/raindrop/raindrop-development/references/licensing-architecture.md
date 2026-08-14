# Raindrop Licensing Architecture

> Reference for any work touching licensing, trials, purchase flow, or Keygen/Stripe/n8n integration.
> Last updated: 2026-07-27

## Overview

Raindrop uses **Keygen.sh** for license key generation and validation, **Stripe** for payment, and **n8n** (self-hosted) as the automation layer between them. The old Zapier pipeline is dead.

## Key components

| Component | Location | Notes |
|---|---|---|
| License client (C#) | `src/raindrop/Activation/LicenseService.cs` | Validates keys against Keygen API, caches encrypted locally (7-day TTL) |
| Keygen API helper | `src/raindrop/Activation/KeyGenApiHelper.cs` | Ed25519 signature verification, response parsing |
| License UI | `src/raindrop/Presentation/License/` | LicenseWindow.xaml, LicenseViewModel.cs, ActivateTrialWindow |
| Machine fingerprint | `src/raindrop/Activation/MachineFingerprintService.cs` | Hardware fingerprint for device binding |
| n8n server | `n8n.irrigationengineers.com` | Self-hosted. Workflows for trial + purchase |
| Design doc (vault) | `D:\Vaults\Personal\Plans\hey-i-want-yo-delegated-breeze.md` | Full architecture, phase plan, verified facts |
| GitHub issues | #434, #578, #579 | #434 = convert Zapier→n8n (done server-side), #578 = plugin-side overhaul, #579 = server-side remaining |

## Keygen account

- Account ID: `40280a53-8cd5-4b54-9813-04727b10810f`
- Trial policy: `42090eb8-6372-40b3-b6b9-fe5e6e6e058b` (30 days, 1 machine)
- Yearly policy: `04745663-…` (365 days)
- Public key (Ed25519): `5fc1e6fd57fa3e81207be4ae0c8379601b688bcdba0a242333c0ff9b1aca479b`

## Stripe

- Account: `acct_2OkmA6FEeYhOuw1biiiy` ("Irrigationengineers")
- Product: `prod_QgIx1kKz0npz8O` ("Raindrop 1-Year License Key")
- One-time price: `price_0PowLOA6FEeYhOuwKViGEiiX` ($400, old store default)
- Recurring annual price: `price_0TeGiAA6FEeYhOuw2r2DtQQ7` ($400/yr, subscription)
- Subscription payment link: `https://buy.stripe.com/aFacMSaqkfyrcLk6RU2oE02` (unlinked — store still points at one-time)
- Old one-time link: `https://buy.stripe.com/6oE9Bo9WQ8u3dUI289`

## n8n workflows

- **Purchase**: `TnSJCMIeD1SujMwW` (ACTIVE) — Stripe `checkout.session.completed` → creates Yearly Keygen license → emails key → Discord alert → copies Tim. Idempotent on session ID.
- **Trial**: `01FnkHrYz8xgf0Ay` (INACTIVE) — webhook → email validation → Keygen trial license → email. Built but not activated (waiting for plugin Phase 2).

## CRITICAL SECURITY ISSUE

`LicenseService.cs` line ~636 hardcodes Keygen admin credentials:
```
support@irrigationengineers.com:)RHb)X$+]rNl*.
```

These creds are in git history and shipped DLLs. Anyone can decompile and get full account access. **This must be fixed** (issue #578 Phase 1).

### Fix (Phase 1, not yet done):
1. Delete: `GetToken()`, `IsNewMachine()`, `ValidateLicenseByMachineFingerprint()`, `GetLicensePolicy()`, `CreateTrialLicense()`, `_cachedToken` field, hardcoded creds.
2. Plugin should only use: `POST /licenses/actions/validate-key` (public, no auth), `POST /machines` and `DELETE /machines/{id}` (License-Key auth — already correct).
3. Read policy/status/expiry from the `validate-key` response (already returned, currently ignored in favor of admin `GetLicensePolicy()` call).
4. **Do NOT rotate the Keygen password until this ships** — rotating now breaks every installed copy that uses the admin creds for trial creation.

## Target architecture (from vault design doc)

```
TRIAL (no card, keygen-only):
  Plugin trial form (email) → POST n8n /trial-request
    → validate email (MX + disposable blocklist), dedupe by email
    → keygen POST /licenses (Product Token, Trial policy, metadata.email)
    → email trial key + download/docs links
  → user pastes key; cached locally

PURCHASE (annual subscription, card on file):
  Plugin "Purchase" → confirm email → open Stripe subscription Checkout
       prefilled_email + client_reference_id={fingerprint}
    → user pays → Stripe checkout.session.completed → n8n:
        • verify Stripe signature, branch on billing_reason
        • look up existing keygen license by buyer email
            - found (trial) → UPGRADE in place (if plan supports policy change) → SAME key
            - none          → CREATE new Yearly license
        • email key + Discord alert + copy Tim
  → trial converts: cached key revalidates as Full automatically (no paste)
  → fresh buyer: plugin polls n8n /raindrop/license?email=&fingerprint= → auto-activates

RENEWAL / LAPSE (hands-off):
  Stripe invoice.paid (subscription_cycle) → n8n → keygen renew → same key extended
  Stripe invoice.payment_failed / customer.subscription.deleted → n8n → keygen suspend
```

## What's done vs not done

### ✅ Done (server side)
- n8n Purchase workflow — tested with real $0 Stripe checkout
- n8n Trial workflow — built, inactive
- Stripe recurring $400/yr price + subscription link
- Keygen Product Token stored in n8n credentials
- Discord "Captain Hook" wired
- Idempotency on session ID

### ❌ Not done (server side)
- Poll endpoint `GET /webhook/raindrop/license?email=&fingerprint=` (blocks plugin Phase 3)
- Stripe webhook signature verification (needs signing secret from endpoint registration)
- Phase 4: renewal/lapse branches (low priority — renewals a year out)
- Go-live: point store at subscription link, register Stripe webhook, delete Zapier endpoint, migrate 2 users, rotate password

### ❌ Not done (plugin/C# side — issue #578)
- Phase 1: Remove admin creds from DLL (SECURITY — most urgent)
- Phase 2: Trial form posts to n8n webhook instead of in-app `CreateTrialLicense()`
- Phase 3: Purchase opens Stripe Checkout + poll endpoint for auto-activate

## Keygen constraint

Keygen `change-policy` may not be available on the current account tier. If not, trial→paid conversion creates a **new** Yearly key (not an in-place upgrade). The poll endpoint returns the new key so the plugin can swap it invisibly. Check current plan capabilities before assuming in-place upgrade works.

## Local cache structure

`%APPDATA%\Raindrop\cache\validate.enc` — encrypted JSON with:
- Key (license key)
- Policy (Trial/Full)
- Fingerprint (machine binding)
- Expiry (7-day cache TTL)
- MainExpiry (license expiry)
- Data (signed Keygen response)
