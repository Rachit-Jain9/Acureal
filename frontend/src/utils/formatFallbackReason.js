/**
 * Sanitize the raw `fallbackReason` string the AI router returns when one
 * provider failed and another rescued the call.
 *
 * On a failing call, the router stitches together the upstream HTTP error
 * (often a JSON body from Claude or OpenAI) into a long string like:
 *
 *   Claude 404 404 {"type":"error","error":{"type":"not_found_error",
 *   "message":"model: gemini-3-flash-preview"},"request_id":"req_011Cb..."}
 *   — auto-failover succeeded on openai
 *
 * Rendering that verbatim in customer-facing UI is hostile: it leaks
 * provider names, surfaces messy raw JSON, and breaks the AI-disclosure
 * policy that says operator-facing surfaces stay clean of failover noise.
 *
 * This helper extracts the meaningful tail — "auto-failover succeeded on
 * <provider>" — and falls back to a generic "auto-failover succeeded"
 * when the suffix is missing. The provider list is restricted to the
 * three the platform actually routes through so a future router change
 * can't accidentally surface a vendor name we don't sanction.
 *
 * @param {string} raw - the fallbackReason string from the backend
 * @returns {string|null} a short clean phrase, or null when the input is
 *   empty / undefined (caller should not render the attribution line at
 *   all in that case).
 */
const SAFE_PROVIDERS = new Set(['openai', 'claude', 'gemini', 'anthropic']);

export function formatFallbackReason(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Look for the "auto-failover succeeded on <provider>" tail anywhere in
  // the string and surface only that phrase.
  const tailMatch = trimmed.match(/auto-failover succeeded on ([a-z][a-z0-9_-]{1,30})/i);
  if (tailMatch) {
    const provider = tailMatch[1].toLowerCase();
    if (SAFE_PROVIDERS.has(provider)) {
      return `auto-failover succeeded on ${provider}`;
    }
    return 'auto-failover succeeded';
  }

  // No recognisable success tail. If the string is short and contains no
  // JSON-looking chunk, pass it through (e.g. "primary call timed out").
  if (trimmed.length <= 120 && !/[{}[\]]/.test(trimmed)) {
    return trimmed;
  }

  // Otherwise — JSON blob or long error trail — collapse to a generic note.
  return 'auto-failover engaged';
}

export default formatFallbackReason;
