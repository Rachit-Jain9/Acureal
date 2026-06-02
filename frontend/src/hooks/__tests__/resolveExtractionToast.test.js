import { describe, it, expect } from 'vitest';
import { resolveExtractionToast } from '../useDocuments';

// Guards finding [3]: the extract endpoint returns 201 for completed, partial,
// AND failed runs, so the toast must reflect the real outcome — never a blanket
// green "Document extracted" when nothing (or a failure) came back.
describe('resolveExtractionToast', () => {
  it('reports an error for a failed extraction, surfacing the reason', () => {
    expect(resolveExtractionToast({ extraction_status: 'failed', error_message: 'Gemini timeout' }))
      .toEqual({ type: 'error', message: 'Extraction failed: Gemini timeout' });
  });

  it('reports a generic error when a failed extraction has no message', () => {
    expect(resolveExtractionToast({ extraction_status: 'failed' }))
      .toEqual({ type: 'error', message: 'Extraction failed — please retry.' });
  });

  it('warns (not success) when a completed extraction found no fields', () => {
    const r = resolveExtractionToast({ extraction_status: 'completed', structured_fields: {} });
    expect(r.type).toBe('warning');
    expect(r.message).toMatch(/no fields were found/i);
  });

  it('warns when structured_fields is null', () => {
    expect(resolveExtractionToast({ extraction_status: 'completed', structured_fields: null }).type).toBe('warning');
  });

  it('warns on a partial extraction that did capture some fields', () => {
    const r = resolveExtractionToast({ extraction_status: 'partial', structured_fields: { khata_no: '123' } });
    expect(r.type).toBe('warning');
    expect(r.message).toMatch(/partially extracted/i);
  });

  it('parses structured_fields when it arrives as a JSON string', () => {
    const r = resolveExtractionToast({ extraction_status: 'completed', structured_fields: '{"survey_number":"45/2"}' });
    expect(r).toEqual({ type: 'success', message: 'Document extracted' });
  });

  it('says evidence queued when ingestion ran', () => {
    const r = resolveExtractionToast({
      extraction_status: 'completed',
      structured_fields: { a: 1 },
      evidence_ingestion: { skipped: false },
    });
    expect(r).toEqual({ type: 'success', message: 'Evidence queued for review' });
  });

  it('says document extracted for a clean completed run with no ingestion', () => {
    const r = resolveExtractionToast({ extraction_status: 'completed', structured_fields: { a: 1 } });
    expect(r).toEqual({ type: 'success', message: 'Document extracted' });
  });
});
