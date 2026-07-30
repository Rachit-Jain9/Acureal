# Acureal — Privacy Policy

**Effective Date:** [DATE TO BE FILLED BY OPERATOR AT PUBLISH TIME]
**Version:** 2.0

> **DRAFT — LAWYER REVIEW REQUIRED before opening Acureal to any user other than the founder.** This text is structured around the **Digital Personal Data Protection Act, 2023**, the **Information Technology Act, 2000**, the **Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011** ("SPDI Rules"), and the **Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021**. Engage a Bengaluru technology / data-protection lawyer for red-line review and to fill in the placeholders before publishing.

This Privacy Policy describes how Acureal ("we", "us") collects, uses, discloses, and protects personal data of Users ("you") of the Acureal platform.

## 1. Roles and definitions

Under the Digital Personal Data Protection Act, 2023:

- Acureal is the **Data Fiduciary** for personal data of registered Users.
- You are a **Data Principal**.
- Personal data uploaded by you that relates to third parties (counterparties, brokers, lawyers in deal documents) is processed by Acureal as a **Data Processor** on your instructions; you remain the Data Fiduciary for that data and are responsible for the lawful basis of its collection.

## 2. What we collect

(a) **Account data:** name, email, phone (optional), password (hashed), organization name, role, IP address, user agent, timestamps of login and key actions.

(b) **Deal data you upload:** documents (sale deeds, encumbrance certificates, RTCs, khatas, RERA registrations, master-plan extracts, agreements, valuations) and structured data you enter into the deal workspace.

(c) **Derived data:** AI-extracted fields, confidence scores, evidence citations, signed snapshots, audit-trail entries.

(d) **Cookies and similar technologies:** essential cookies for authentication and session management. See the [Cookie Policy](/cookies).

(e) **Telemetry:** anonymized usage events for product improvement and billing (cost-per-AI-call). No raw document content is sent to telemetry.

## 3. Lawful basis for processing

(a) **Consent (DPDP §6).** Explicit, informed consent recorded against this Policy version at signup, and re-recorded whenever a material change is published.

(b) **Legitimate uses (DPDP §7).** Performance of contract, legal compliance, security and fraud prevention, where applicable.

## 4. Purposes of processing

- To provide the Platform and the deal-intelligence service you request.
- To extract structured data from your uploaded documents using AI.
- To generate narrative synthesis (risk briefs, IC memos) for your review.
- To bill, support, and communicate service-related notices.
- To detect and prevent fraud, abuse, and security incidents.
- To comply with applicable law (e.g., responding to lawful requests from competent Indian authorities).

## 5. Sensitive personal data

The Platform may incidentally process sensitive categories (financial information in agreements, government-issued identifiers in deeds). Such data is:

- stored encrypted in transit (TLS 1.2+) and at rest by our infrastructure providers;
- accessible only to authenticated, authorized members of your workspace via row-level security;
- never used to train external AI models — see §6 below.

## 6. Sub-processors and cross-border transfer

We use the following sub-processors. Some are based outside India; the Digital Personal Data Protection Act, 2023, §16 currently permits such transfers subject to government restriction. We disclose the list and the country of processing for transparency.

| Sub-processor | Purpose | Country | Provider safeguards |
|---|---|---|---|
| Supabase Inc. | Database, storage, auth | USA | SOC 2 Type II; data-region pinning available |
| Vercel Inc. | Hosting, edge runtime, blob storage | USA | SOC 2 Type II |
| Google LLC (Gemini API) | Document extraction (OCR / structured-field) | USA / multi-region | Google Cloud DPA; **no training on submitted prompts when accessed via API** |
| Google LLC (Identity Services) | Federated sign-in only ("Continue with Google"). Receives the email address you authorise during the sign-in handshake; returns an identity token to Acureal. Used only when you choose this method. | USA / multi-region | Google OAuth 2.0; account-linking requires explicit user consent at the Google account picker. |
| Anthropic PBC (Claude API) | Reasoning, narrative synthesis | USA | Anthropic Commercial DPA; **no training on submitted prompts** |
| OpenStreetMap Foundation | Map tiles | Multi-region | ODbL public data |

We disclose: the AI providers process the *content of documents you upload* to extract or summarize. We do not send raw documents to telemetry vendors.

If you require India-region-only processing, contact our Grievance Officer. This may limit available features.

Acureal is in the process of executing Data Processing Agreements (DPAs) with each sub-processor. Until the DPA portfolio is complete, the Platform is operated only by the founder.

## 7. Retention

| Data category | Retention |
|---|---|
| Account data (active) | for the life of your account |
| Account data (after closure) | 90 days for billing reconciliation, then deleted |
| Deal documents and workspace data | for the life of your account; you may delete individual documents at any time |
| AI call logs | 12 months for cost reconciliation and audit |
| Audit trail (deal_events) | 7 years for investor-grade audit; required for evidentiary purposes under the Indian Evidence Act / IT Act §65B |
| Server access logs | 180 days (CERT-In Direction April 2022 §II(v)) |
| Backup retention | rolling 30 days, point-in-time recovery |

You may request earlier erasure under §8 below; statutory retention prevails where applicable.

## 8. Your rights as a Data Principal

Under the Digital Personal Data Protection Act, 2023, §11–14, you have the right to:

- **Access** a summary of the personal data we hold about you and how it has been used.
- **Correction and erasure** of inaccurate or no-longer-needed data.
- **Grievance redress** via our Grievance Officer.
- **Nominate** another individual to exercise your rights in the event of death or incapacity.
- **Withdraw consent** at any time. Withdrawal does not affect the lawfulness of prior processing and may end your access to the Platform.

To exercise rights, write to grievance@[YOUR-DOMAIN] from the email on your account. We respond within 30 days (target: 7 days) and may need to verify identity before complying.

## 9. Security safeguards

- Passwords hashed with bcrypt (cost factor 12).
- Authentication via short-lived JWT tokens. Token-rotation hardening (refresh tokens, httpOnly cookies, MFA) is on the active roadmap.
- Documents stored with server-issued signed URLs; no public direct access.
- Database access enforced by row-level security on all tenant tables.
- Audit log entries cryptographically signed (HMAC-SHA256) and append-only.
- Daily AI cost cap per workspace to limit blast radius of credential abuse.

We follow ISO 27001-aligned practices (formal certification not yet attained). We do not warrant that no breach can occur; in the event of one, we follow the [Breach Notification Runbook](https://github.com/Rachit-Jain9/Acureal/blob/master/docs/legal/breach_notification_runbook.md) and notify the Indian Computer Emergency Response Team (CERT-In) within 6 hours of awareness, per CERT-In Directions April 2022 §II.

## 10. Children's data

The Platform is not intended for users under 18. We do not knowingly collect data from minors. If you believe a minor has registered, write to the Grievance Officer.

## 11. Cookies

See the [Cookie Policy](/cookies). We use only essential cookies; no advertising or third-party tracking cookies.

## 12. Third-party links

The Platform may link to government portals (K-RERA, BBMP, BDA, Bhoomi, Kaveri) and third-party data sources. We are not responsible for their privacy practices.

## 13. Changes to this Policy

We may update this Policy. Material changes will be announced in the Platform and via email at least fourteen (14) days before the effective date. The version history is preserved and available on request. Continued use after the effective date constitutes consent.

## 14. Grievance Officer / Data Protection contact

**Name:** [NAME]
**Designation:** Grievance Officer & Privacy Contact (Acting)
**Email:** grievance@[YOUR-DOMAIN]
**Postal Address:** [ADDRESS], Bengaluru, Karnataka, India
**Acknowledgement:** within 24 hours
**Resolution target:** within 15 days

If unsatisfied, you may approach the Data Protection Board of India (once constituted under the DPDP Act, 2023) or the local courts of Bengaluru.

---

*This document is version 2.0. Changes from v1.0: added Google LLC (Identity Services) as a sub-processor for federated "Continue with Google" sign-in. Prior versions retained on request.*
