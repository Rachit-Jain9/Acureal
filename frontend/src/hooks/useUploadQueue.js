import { useCallback, useRef, useState } from 'react';
import {
  isAllowedExtension,
  labelFor,
  extractionTierFor,
  ALLOWED_EXTENSIONS,
} from '../utils/documentFormats';

const MAX_SIZE_MB = 50;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

let seq = 0;
const nextId = () => {
  seq += 1;
  return `upl-${seq}`;
};

/**
 * Validate one File against the shared format registry (extension-based, like
 * the backend — the OS reports empty/odd MIME for .csv/.kml/.geojson, so a
 * MIME check would wrongly reject legitimate files). Returns an error string
 * or null.
 */
export function validateFile(file) {
  if (!file) return 'No file.';
  if (!isAllowedExtension(file.name)) {
    return `${file.name.split('.').pop()?.toUpperCase() || 'This'} files are not supported.`;
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `File must be under ${MAX_SIZE_MB} MB (this one is ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  return null;
}

/**
 * Multi-file upload queue with per-file progress.
 *
 * Each selected file becomes a row {id, file, status, progress, error,
 * documentId, tier}. Invalid files stay in the queue as 'error' rows (so the
 * user sees exactly which one and why) rather than the old all-or-nothing
 * single fileError. Uploads run SEQUENTIALLY — each file costs a backend
 * presign + confirm round-trip on Vercel serverless, and serial keeps the
 * per-file progress legible and the function pool happy.
 *
 * @param uploadMutation  a useUploadDocument() mutation instance
 */
export function useUploadQueue(uploadMutation) {
  const [items, setItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  // Read the latest queue inside the async loop without re-subscribing.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = useCallback((id, changes) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  }, []);

  const addFiles = useCallback((fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setItems((prev) => [
      ...prev,
      ...incoming.map((file) => {
        const error = validateFile(file);
        return {
          id: nextId(),
          file,
          name: file.name,
          size: file.size,
          status: error ? 'error' : 'queued',
          progress: 0,
          error,
          documentId: null,
          tier: extractionTierFor({ fileName: file.name }),
          label: labelFor(file.name),
        };
      }),
    ]);
  }, []);

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setIsRunning(false);
  }, []);

  /**
   * Upload every 'queued' item sequentially. Resolves with a summary
   * {uploaded, failed, uploadedDocs} so the caller can show ONE toast and
   * trigger extraction for the readable uploads.
   */
  const run = useCallback(async ({ dealId, category, description }) => {
    const queued = itemsRef.current.filter((it) => it.status === 'queued');
    if (!queued.length) return { uploaded: 0, failed: 0, uploadedDocs: [] };

    setIsRunning(true);
    const uploadedDocs = [];
    let failed = 0;

    for (const item of queued) {
      patch(item.id, { status: 'uploading', progress: 0, error: null });
      try {
        const res = await uploadMutation.mutateAsync({
          dealId,
          file: item.file,
          category,
          description,
          silent: true,
          onProgress: (pct) => patch(item.id, { progress: pct }),
        });
        const doc = res?.data || res;
        patch(item.id, { status: 'done', progress: 100, documentId: doc?.id || null });
        if (doc?.id) uploadedDocs.push({ ...doc, tier: item.tier });
      } catch (err) {
        failed += 1;
        const message = err?.response?.data?.message || err?.message || 'Upload failed.';
        patch(item.id, { status: 'error', error: message });
      }
    }

    setIsRunning(false);
    return { uploaded: uploadedDocs.length, failed, uploadedDocs };
  }, [patch, uploadMutation]);

  const counts = {
    total: items.length,
    queued: items.filter((it) => it.status === 'queued').length,
    error: items.filter((it) => it.status === 'error').length,
    done: items.filter((it) => it.status === 'done').length,
  };

  return { items, addFiles, remove, reset, run, isRunning, counts };
}

export { MAX_SIZE_MB, ALLOWED_EXTENSIONS };
