# @redip/financial-kernel

Pure, deterministic underwriting kernel for REDIP.

## Hard rules

- TypeScript only
- No DB calls, network calls, Date.now, randomness, or UI dependencies
- Money handled as fixed-precision decimals (BigInt-backed)
- Monthly canonical time grain
- Provenance metadata on all derived KPIs

## Integration

Kernel is wired into the legacy engine behind the `FIN_KERNEL_V2` flag.
The flag is **off by default**. Legacy underwriting remains authoritative
until golden-test parity has been confirmed for every live deal in staging.

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

Output lands in `dist/` and is picked up by `backend/src/engines/kernel.adapter.js`.
