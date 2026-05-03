'use strict';

const crypto = require('crypto');
const log = require('../lib/logger').child({ module: 'password-breach' });

// Have I Been Pwned — Pwned Passwords API uses k-anonymity:
// we send only the first 5 hex chars of the SHA-1 hash; the API returns
// every full hash that starts with that prefix and the number of times
// each appeared in known breaches. The plaintext password (and its full
// hash) never leave this process.
//
// API: https://haveibeenpwned.com/API/v3#PwnedPasswords
// No auth required for the range endpoint.
const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 3000;
const USER_AGENT = 'REDIP-signup-breach-check';

const isDisabled = () =>
  process.env.NODE_ENV === 'test' ||
  process.env.SKIP_PASSWORD_BREACH_CHECK === '1' ||
  process.env.SKIP_PASSWORD_BREACH_CHECK === 'true';

// Returns { breached: boolean, count: number, failedOpen?: boolean }.
// failedOpen=true means the HIBP API was unreachable; we let the signup
// proceed rather than punish the user for our connectivity. The bcrypt
// hash + cold-signup gate + login throttle are still in force.
const isPasswordBreached = async (password) => {
  if (isDisabled()) {
    return { breached: false, count: 0 };
  }

  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);

  try {
    const res = await fetch(HIBP_RANGE_URL + prefix, {
      headers: {
        'Add-Padding': 'true',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      log.warn('hibp_non_ok_response', { status: res.status });
      return { breached: false, count: 0, failedOpen: true };
    }

    const text = await res.text();
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const hashSuffix = line.slice(0, colonIdx).toUpperCase();
      if (hashSuffix === suffix) {
        const count = parseInt(line.slice(colonIdx + 1), 10) || 0;
        // HIBP pads its responses with synthetic lines (count 0) when
        // 'Add-Padding: true' is set; treat count=0 as not breached.
        return { breached: count > 0, count };
      }
    }

    return { breached: false, count: 0 };
  } catch (err) {
    if (err.name === 'AbortError') {
      log.warn('hibp_timeout');
    } else {
      log.warn('hibp_error', { message: err.message });
    }
    return { breached: false, count: 0, failedOpen: true };
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { isPasswordBreached };
