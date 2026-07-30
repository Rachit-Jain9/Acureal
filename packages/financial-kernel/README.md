# @redip/financial-kernel

Pure, deterministic underwriting kernel for Acureal.

## Hard rules

- TypeScript only
- No DB calls, network calls, Date.now, randomness, or UI dependencies
- Money handled as fixed-precision decimals (BigInt-backed)
- Monthly canonical time grain
- Provenance metadata on all derived KPIs

## Integration

The kernel is the sole financial computation path. `backend/src/engines/kernel.service.js` wraps it and is called directly by `financial.service.js`. There is no feature flag — the kernel always runs.

Operator escape hatches:
- `DEBT_ENGINE_KILL=1` — emergency zero-overlay fallback
- `DEBT_ENGINE_SILENT=1` — suppresses decision log lines (test use only)

## Supported asset classes

- residential_apartments
- plotted_development
- commercial_office
- retail
- industrial_warehousing
- hospitality
- mixed_use
- land_parcel
- villas
- redevelopment

## Building

```bash
npm install
npm run build
npm test
```

Output lands in `dist/` and is picked up by `backend/src/engines/kernel.service.js`.
