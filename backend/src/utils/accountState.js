'use strict';

/**
 * Terminal account states — the single place that decides whether a `users`
 * row is still allowed to hold a session.
 *
 * THREE distinct states, deliberately NOT collapsed into one another:
 *
 *   erased_at IS NOT NULL        DPDP Act 2023 §8(7) erasure has run. PII is
 *                                anonymized, password_hash is NULL. Terminal
 *                                and irreversible.
 *
 *   account_closed_at IS NOT NULL  User-initiated closure. The 90-day erasure
 *                                clock is running (accountClosure.service).
 *                                Reversible only by operator support, never by
 *                                an admin "reactivate user" click.
 *
 *   is_active = false            Admin deactivation. Ordinary, reversible,
 *                                orthogonal to closure.
 *
 * Why this is a READ-TIME guard and not a flag written at closure time:
 * closure is not the only way a row reaches a terminal state. `eraseClosedAccounts`
 * UPDATEs rows directly and never touches `is_active`; rows can also be closed
 * out-of-band (operator SQL, a future bulk-close, a restored backup). A guard
 * that only fires for rows that happened to pass through `closeAccount()` is
 * fail-open by construction. Checking the actual state at every gate is
 * default-deny — it covers rows the write path never saw, and it covers entry
 * points that do not exist yet.
 *
 * Precedence is most-terminal-first so the user sees the truest reason.
 */

// Order matters: erasure outranks closure outranks deactivation. Mirrors the
// status precedence in dsar.service.js so the DSAR export and the login gate
// can never disagree about what state an account is in.
const describeAccountState = (userRow) => {
  if (!userRow) return 'missing';
  if (userRow.erased_at) return 'erased';
  if (userRow.account_closed_at) return 'closed';
  if (userRow.is_active === false) return 'inactive';
  return 'active';
};

// Erased and closed accounts get the same message on purpose. An erased row
// has no recoverable identity to speak to, and confirming "this address was
// erased" to whoever holds the credentials leaks the prior existence of the
// account. Closed accounts get a real explanation because a closed user IS the
// legitimate owner — that reasoning is inherited from the original login block.
const CLOSED_MESSAGE =
  'This account has been closed. Contact grievance@acureal.in if this was unexpected.';
const DEACTIVATED_MESSAGE =
  'Your account has been deactivated. Please contact the administrator.';

/**
 * Throws a 403 (shaped like createError's output) when the row must not hold a
 * session. Callers pass their own createError so this module stays free of any
 * dependency on the express error middleware — it is pure and unit-testable.
 *
 * @param {object|null} userRow  Must carry erased_at, account_closed_at, is_active.
 * @param {function} createError (message, statusCode) => Error
 */
const assertAccountUsable = (userRow, createError) => {
  const state = describeAccountState(userRow);

  if (state === 'erased' || state === 'closed') {
    throw createError(CLOSED_MESSAGE, 403);
  }
  if (state === 'inactive') {
    throw createError(DEACTIVATED_MESSAGE, 403);
  }

  return state;
};

// True when the row is in a terminal (closure/erasure) state, regardless of
// is_active. Used where the caller needs the fact without the throw.
const isAccountTerminated = (userRow) => {
  const state = describeAccountState(userRow);
  return state === 'erased' || state === 'closed';
};

module.exports = {
  describeAccountState,
  assertAccountUsable,
  isAccountTerminated,
  CLOSED_MESSAGE,
  DEACTIVATED_MESSAGE,
};
