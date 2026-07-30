# Acureal — Cookie Policy

**Effective Date:** [DATE TO BE FILLED BY OPERATOR AT PUBLISH TIME]
**Version:** 1.0

> **DRAFT — LAWYER REVIEW REQUIRED before opening Acureal to any user other than the founder.** India does not currently mandate a cookie banner, but we ship one as a transparency signal. If Acureal is offered to users in the EU / EEA / UK, a full ePrivacy / GDPR consent UI will need to replace this minimal notice.

Acureal uses only **essential cookies and similar local-storage technologies** necessary for the Platform to function. We do **not** use third-party advertising cookies, analytics cookies, or tracking pixels.

## What we store

| Storage | Name | Purpose | Duration |
|---|---|---|---|
| `localStorage` | `token` | Session JWT (only if you tick "Remember me") | 7 days |
| `sessionStorage` | `token` | Session JWT (default) | until browser closes |
| `localStorage` | `user` | Cached user profile for instant render | matches token |
| `localStorage` | `cookie_notice_dismissed` | Dismissal of the cookie notice | indefinite |
| `localStorage` | `redip.theme` | Light/dark theme preference for the dashboard | indefinite |

## Roadmap

We plan to migrate authentication to **httpOnly, Secure, SameSite=Lax cookies** in a future release. This will reduce exposure to XSS-based token theft. Until then, "Remember me" stores the token in `localStorage`; if you prefer not to, leave it unchecked and your session ends when the browser closes.

## Your choices

- Decline cookies in your browser; the Platform will not function (essential storage is required).
- Use private/incognito mode; storage is cleared on close.
- Clear site data via your browser settings at any time.

## Contact

grievance@[YOUR-DOMAIN]

---

*This document is version 1.0.*
