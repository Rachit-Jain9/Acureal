import { describe, expect, it } from 'vitest';
import { searchIndexState } from '../DocumentsTab';

/**
 * The searchability chip's copy.
 *
 * Until 2026-07-31 the document-indexing step never ran: production held zero
 * indexed passages against every uploaded document. The Documents tab showed a
 * green extraction chip the whole time, so the product appeared to have read a
 * file it could not then find or quote. The chip exists to make that state
 * impossible to hide again.
 *
 * Two properties make it trustworthy rather than decorative:
 *
 *   1. It shows the NEGATIVE state. Most chips in this file stay silent when
 *      there is nothing good to report; this one must not, because invisibility
 *      is precisely the bug it replaces.
 *   2. It never conflates "indexed the document's text" with "indexed our
 *      reading of the document". A scan yields only the latter, and the copy
 *      says so — the same discipline as coverageLabel's "sent, never read".
 */

describe('searchIndexState', () => {
  const extracted = { has_data: true, doc_type: 'sale_deed' };

  it('reports the passage count when the document is indexed', () => {
    const state = searchIndexState({ search_passages: 12 }, extracted);
    expect(state.indexed).toBe(true);
    expect(state.label).toBe('Searchable · 12 passages');
  });

  it('singularises a lone passage', () => {
    expect(searchIndexState({ search_passages: 1 }, extracted).label)
      .toBe('Searchable · 1 passage');
  });

  it('distinguishes the document\'s own text from our reading of it', () => {
    const fromDoc = searchIndexState(
      { search_passages: 5, search_text_source: 'document_transcription' },
      extracted,
    );
    const fromModel = searchIndexState(
      { search_passages: 5, search_text_source: 'model_reading' },
      extracted,
    );

    expect(fromDoc.title).toMatch(/document's own text/i);
    expect(fromModel.title).toMatch(/structured reading/i);
    // The weaker claim must never be described as quoting the document.
    expect(fromModel.title).not.toMatch(/own text/i);
  });

  it('SHOWS the negative state — an unsearchable document must not be silent', () => {
    const state = searchIndexState({ search_passages: 0 }, extracted);
    expect(state.indexed).toBe(false);
    expect(state.label).toBe('Not searchable');
    // And says what it means for the user, not just that a number is zero.
    expect(state.title).toMatch(/cannot cite/i);
  });

  it('stays silent before the document has been read at all', () => {
    // The extraction chips already tell that part of the story; two chips
    // saying "nothing has happened yet" is noise.
    expect(searchIndexState({ search_passages: 0 }, null)).toBeNull();
  });

  it('treats a missing count as zero rather than throwing', () => {
    expect(searchIndexState({}, extracted).indexed).toBe(false);
    expect(searchIndexState(undefined, extracted).indexed).toBe(false);
  });
});
