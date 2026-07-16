import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUploadQueue, validateFile } from '../useUploadQueue';

const makeFile = (name, { size = 1024, type = '' } = {}) => {
  const f = new File(['x'.repeat(Math.min(size, 1024))], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('validateFile', () => {
  it('accepts a registered extension under the size cap', () => {
    expect(validateFile(makeFile('deed.pdf'))).toBeNull();
    expect(validateFile(makeFile('roll.xlsx'))).toBeNull();
    expect(validateFile(makeFile('parcel.kml'))).toBeNull();
    // Empty OS MIME (common for .csv/.kml on Windows) must NOT reject it.
    expect(validateFile(makeFile('comps.csv', { type: '' }))).toBeNull();
  });

  it('rejects an unregistered extension', () => {
    expect(validateFile(makeFile('malware.exe'))).toMatch(/not supported/);
  });

  it('rejects a file over the 50 MB cap', () => {
    expect(validateFile(makeFile('huge.pdf', { size: 60 * 1024 * 1024 }))).toMatch(/under 50 MB/);
  });
});

describe('useUploadQueue', () => {
  const makeMutation = (impl) => ({ mutateAsync: vi.fn(impl) });

  it('adds files, marking invalid ones as error rows (not all-or-nothing)', () => {
    const { result } = renderHook(() => useUploadQueue(makeMutation()));
    act(() => {
      result.current.addFiles([makeFile('a.pdf'), makeFile('b.exe'), makeFile('c.xlsx')]);
    });
    expect(result.current.items).toHaveLength(3);
    expect(result.current.counts.queued).toBe(2);
    expect(result.current.counts.error).toBe(1);
    expect(result.current.items.find((i) => i.name === 'b.exe').status).toBe('error');
  });

  it('tags each row with its extraction tier', () => {
    const { result } = renderHook(() => useUploadQueue(makeMutation()));
    act(() => result.current.addFiles([makeFile('deed.pdf'), makeFile('plan.dwg'), makeFile('roll.xlsx')]));
    const byName = Object.fromEntries(result.current.items.map((i) => [i.name, i.tier]));
    expect(byName['deed.pdf']).toBe('native');
    expect(byName['roll.xlsx']).toBe('parseable');
    expect(byName['plan.dwg']).toBe('stored_only');
  });

  it('uploads queued files sequentially and reports a summary', async () => {
    const order = [];
    const mutation = makeMutation(async ({ file, silent, onProgress }) => {
      order.push(file.name);
      expect(silent).toBe(true); // queue suppresses per-file toasts
      onProgress?.(100);
      return { data: { id: `doc-${file.name}` } };
    });
    const { result } = renderHook(() => useUploadQueue(mutation));
    act(() => result.current.addFiles([makeFile('a.pdf'), makeFile('b.xlsx')]));

    let summary;
    await act(async () => {
      summary = await result.current.run({ dealId: 'd1', category: 'legal' });
    });

    expect(order).toEqual(['a.pdf', 'b.xlsx']); // sequential, in order
    expect(summary.uploaded).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.uploadedDocs).toHaveLength(2);
    expect(result.current.items.every((i) => i.status === 'done')).toBe(true);
  });

  it('isolates a per-file failure without aborting the batch', async () => {
    const mutation = makeMutation(async ({ file }) => {
      if (file.name === 'bad.pdf') throw new Error('storage 500');
      return { data: { id: `doc-${file.name}` } };
    });
    const { result } = renderHook(() => useUploadQueue(mutation));
    act(() => result.current.addFiles([makeFile('ok.pdf'), makeFile('bad.pdf'), makeFile('ok2.pdf')]));

    let summary;
    await act(async () => {
      summary = await result.current.run({ dealId: 'd1', category: 'other' });
    });

    expect(summary.uploaded).toBe(2);
    expect(summary.failed).toBe(1);
    const bad = result.current.items.find((i) => i.name === 'bad.pdf');
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/storage 500/);
    // The two good files still uploaded.
    expect(result.current.items.filter((i) => i.status === 'done')).toHaveLength(2);
  });

  it('does not re-upload already-uploaded or invalid rows on a second run', async () => {
    const mutation = makeMutation(async ({ file }) => ({ data: { id: `doc-${file.name}` } }));
    const { result } = renderHook(() => useUploadQueue(mutation));
    act(() => result.current.addFiles([makeFile('a.pdf'), makeFile('bad.exe')]));
    await act(async () => { await result.current.run({ dealId: 'd1', category: 'other' }); });
    mutation.mutateAsync.mockClear();
    await act(async () => { await result.current.run({ dealId: 'd1', category: 'other' }); });
    expect(mutation.mutateAsync).not.toHaveBeenCalled(); // nothing left queued
  });

  it('threads per-file progress into the row', async () => {
    let emit;
    let resolveUpload;
    const mutation = makeMutation(({ onProgress }) => new Promise((resolve) => {
      emit = (pct) => onProgress(pct);
      resolveUpload = () => resolve({ data: { id: 'doc-1' } });
    }));
    const { result } = renderHook(() => useUploadQueue(mutation));
    act(() => result.current.addFiles([makeFile('a.pdf')]));
    let running;
    act(() => { running = result.current.run({ dealId: 'd1', category: 'other' }); });
    await waitFor(() => expect(emit).toBeDefined());
    // Mid-upload progress lands on the row...
    act(() => emit(42));
    await waitFor(() => expect(result.current.items[0].progress).toBe(42));
    // ...and completion snaps it to 100.
    await act(async () => { resolveUpload(); await running; });
    expect(result.current.items[0].progress).toBe(100);
    expect(result.current.items[0].status).toBe('done');
  });

  it('reset clears the queue', () => {
    const { result } = renderHook(() => useUploadQueue(makeMutation()));
    act(() => result.current.addFiles([makeFile('a.pdf')]));
    expect(result.current.items).toHaveLength(1);
    act(() => result.current.reset());
    expect(result.current.items).toHaveLength(0);
  });
});
