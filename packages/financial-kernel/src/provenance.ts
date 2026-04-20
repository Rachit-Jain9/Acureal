/**
 * Lightweight helpers for attaching provenance to kernel outputs.
 * Provenance lives alongside values so downstream callers can explain
 * any derived KPI without re-running the calculation.
 */

import type { ProvenanceEntry } from './types';

export function prov(
  key: string,
  source: string,
  transform?: string,
  assumptions?: readonly string[],
): ProvenanceEntry {
  const entry: { key: string; source: string; transform?: string; assumptions?: readonly string[] } = {
    key,
    source,
  };
  if (transform !== undefined) entry.transform = transform;
  if (assumptions !== undefined && assumptions.length > 0) entry.assumptions = assumptions;
  return Object.freeze(entry) as ProvenanceEntry;
}

export function mergeProvenance(
  ...groups: readonly (readonly ProvenanceEntry[])[]
): readonly ProvenanceEntry[] {
  const merged: ProvenanceEntry[] = [];
  for (const g of groups) {
    for (const entry of g) merged.push(entry);
  }
  return Object.freeze(merged);
}
