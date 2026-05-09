import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dealQaAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const errMessage = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

// Tier-2 #11 — most-recent N Q&A rows for a deal. Used by the deal
// Overview tab to show conversation history alongside the active input.
export function useDealQaHistory(dealId, { limit = 10 } = {}) {
  return useQuery({
    queryKey: ['deal-qa-history', dealId, limit],
    queryFn: () => dealQaAPI.history(dealId, limit).then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 30_000,
  });
}

// Sync ask — kept for automated callers / fallback paths. The UI uses
// `useStreamDealQa` so the answer paints incrementally.
export function useAskDealQa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, question }) =>
      dealQaAPI.ask(dealId, question).then((r) => r.data.data),
    onSuccess: (row, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['deal-qa-history', dealId] });
      if (row?.cache_hit) {
        toast.success('Found a previous answer to this question.');
      }
    },
    onError: (err) => {
      // Backend persists failed attempts too (status='failed') so the
      // UI can render them in history. Surface the message; the row
      // itself comes back via err.response.data.data when available.
      toast.error(errMessage(err, 'Q&A request failed.'));
    },
  });
}

// Delete a single history row — used when an analyst wants to clean up
// a failed/wrong answer before sharing the deal page.
export function useDeleteDealQaRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, rowId }) =>
      dealQaAPI.deleteRow(dealId, rowId).then((r) => r.data.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['deal-qa-history', dealId] });
      toast.success('Q&A entry removed.');
    },
    onError: (err) => toast.error(errMessage(err, 'Failed to remove entry.')),
  });
}

// Progressive parser for the streamed JSON. The backend streams Claude's
// strict { "answer": "...", "citations": [...] } JSON object. We don't
// want to render raw JSON in the UI — we want the analyst to see the
// "answer" field grow word by word. This helper walks the buffer,
// finds "answer":", then reads the string body up to wherever the
// stream is currently. Handles `\"`, `\\`, `\n`, `\t`, `\r`, `\uXXXX`
// escapes. Returns null if the answer field hasn't opened yet.
export function extractStreamingAnswer(buffer) {
  if (!buffer) return null;
  const m = buffer.match(/"answer"\s*:\s*"/);
  if (!m) return null;
  let i = m.index + m[0].length;
  let out = '';
  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === '\\' && i + 1 < buffer.length) {
      const nx = buffer[i + 1];
      if (nx === 'n') out += '\n';
      else if (nx === 't') out += '\t';
      else if (nx === 'r') out += '\r';
      else if (nx === '"') out += '"';
      else if (nx === '\\') out += '\\';
      else if (nx === '/') out += '/';
      else if (nx === 'u' && i + 5 < buffer.length) {
        const hex = buffer.slice(i + 2, i + 6);
        const code = parseInt(hex, 16);
        if (Number.isFinite(code)) out += String.fromCharCode(code);
        i += 6;
        continue;
      } else {
        out += nx;
      }
      i += 2;
      continue;
    }
    if (ch === '"') break; // end of answer string
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Streaming Q&A hook. Returns:
 *   { ask({ dealId, question }), streamingText, isStreaming, abort }
 *
 * `streamingText` is the live answer text as the model writes it, parsed
 * out of the JSON stream so the UI never shows raw JSON. On stream end
 * the React-Query history list refetches and the local streaming state
 * clears — the persisted answer takes over from history rendering.
 */
export function useStreamDealQa() {
  const qc = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const handleRef = useRef(null);
  const bufferRef = useRef('');

  const ask = useCallback(
    ({ dealId, question }) => {
      if (isStreaming) return;
      bufferRef.current = '';
      setStreamingText('');
      setIsStreaming(true);

      const handle = dealQaAPI.stream(dealId, question, {
        onText: (delta) => {
          bufferRef.current += delta;
          const ans = extractStreamingAnswer(bufferRef.current);
          if (ans !== null) {
            setStreamingText(ans);
          }
        },
        onDone: (frame) => {
          // Cache-hit short-circuit comes back with the full row in one
          // frame and no text deltas. Surface the persisted answer
          // immediately so the user doesn't see an empty streaming
          // panel.
          if (frame?.cacheHit && frame?.row?.answer) {
            setStreamingText(frame.row.answer);
            toast.success('Found a previous answer to this question.');
          }
        },
      });
      handleRef.current = handle;

      handle.promise
        .then(() => {
          // Refresh history so the persisted row replaces the in-memory
          // streaming state.
          qc.invalidateQueries({ queryKey: ['deal-qa-history', dealId] });
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          toast.error(errMessage(err, 'Q&A stream failed.'));
          // Still refetch — the backend may have persisted a failed row.
          qc.invalidateQueries({ queryKey: ['deal-qa-history', dealId] });
        })
        .finally(() => {
          setIsStreaming(false);
          // Clear the in-memory streaming text once the persisted row
          // is on its way. Slight delay so the UI doesn't flicker
          // empty before history paints.
          setTimeout(() => {
            setStreamingText('');
            bufferRef.current = '';
          }, 150);
          handleRef.current = null;
        });
    },
    [isStreaming, qc],
  );

  const abort = useCallback(() => {
    handleRef.current?.abort?.();
  }, []);

  return { ask, streamingText, isStreaming, abort };
}
