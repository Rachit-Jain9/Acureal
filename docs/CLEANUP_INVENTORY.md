# Cleanup inventory

## Open gates

### Gate 4 — Investor package cryptographic signing

**Status: BLOCKED**

`handleInvestorPackage` currently returns an unsigned package. Do not add a fake signature — a fake is worse than none.

**Gate opens when:** key management provisioned (HSM/KMS), signing service deployed, verification UX shipped, compliance sign-off on scheme (RSA/ECDSA + envelope format).

Tracked in `TODO_MANUAL.md` item 7.

---

## Closed gates (summary)

| Gate | What was removed | Closed |
|---|---|---|
| 1 — Legacy JS financial engine | `financial.engine.js` (2,767 lines), `kernel.adapter.js`, 6 parity test suites | 2026-04-22 |
| 2 — Python debt-engine companion | No `.py` files, no `DEBT_ENGINE_PY_URL` refs remain | 2026-04-22 |
| 3 — Hardcoded India constants | All constants now import from `packages/financial-kernel/src/config/india.ts` | 2026-04-21 |
