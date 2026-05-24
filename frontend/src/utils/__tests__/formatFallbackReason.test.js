import { describe, it, expect } from 'vitest';
import { formatFallbackReason } from '../formatFallbackReason';

describe('formatFallbackReason', () => {
  it('returns null for empty / nullish input', () => {
    expect(formatFallbackReason(null)).toBeNull();
    expect(formatFallbackReason(undefined)).toBeNull();
    expect(formatFallbackReason('')).toBeNull();
    expect(formatFallbackReason('   ')).toBeNull();
  });

  it('extracts the clean tail from a JSON-spliced router string', () => {
    const raw = `Claude 404 404 {"type":"error","error":{"type":"not_found_error","message":"model: gemini-3-flash-preview"},"request_id":"req_011Cb"} — auto-failover succeeded on openai`;
    expect(formatFallbackReason(raw)).toBe('auto-failover succeeded on openai');
  });

  it('passes through a short clean string verbatim', () => {
    expect(formatFallbackReason('primary call timed out')).toBe('primary call timed out');
  });

  it('collapses a long error-trail with JSON to a generic note when no success tail', () => {
    const raw = 'OpenAI 500 {"error":"upstream service overloaded","request_id":"req_xyz123"}';
    expect(formatFallbackReason(raw)).toBe('auto-failover engaged');
  });

  it('rejects unknown provider names in the success tail', () => {
    const raw = 'X 500 — auto-failover succeeded on shadyvendor';
    expect(formatFallbackReason(raw)).toBe('auto-failover succeeded');
  });

  it('lower-cases the recognised provider name in the output', () => {
    const raw = 'Claude 429 — auto-failover succeeded on OpenAI';
    expect(formatFallbackReason(raw)).toBe('auto-failover succeeded on openai');
  });
});
