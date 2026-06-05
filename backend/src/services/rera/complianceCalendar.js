'use strict';

/**
 * rera/complianceCalendar — deterministic post-registration K-RERA compliance
 * calendar (the operator's vision V4, first slice).
 *
 * Pure compute over the deal's own dates + the current date. NO DB, NO AI, NO
 * writes, NO cron (a reminder/notification job is a later slice that can reuse
 * the existing Vercel-cron + mailer infra). Read-only computed view.
 *
 * Honesty rules (CLAUDE.md "nothing false"):
 *   • We have NO actual filing data (the K-RERA portal scraper is inert), so we
 *     NEVER mark a past quarterly/annual deadline "overdue" — we cannot know if
 *     it was filed. Quarterly + annual items are FORWARD-LOOKING only.
 *   • "Overdue" is only used for the deal's OWN declared dates — the declared
 *     completion date and the certificate expiry date — where a past date is a
 *     genuine, deterministic signal.
 *   • Deadlines are labelled INDICATIVE — verify exact dates on the K-RERA
 *     portal (the precise QPR cut-off has portal-specific nuance).
 *
 * Scope:
 *   • registered (deal carries a RERA number) → an active calendar.
 *   • in-scope but not yet registered → a one-line preview (cadence only).
 *   • exempt / not-applicable → nothing.
 */

// K-RERA FAQ: quarterly project updates within 15 days of each quarter-end.
const QPR_DAYS_AFTER_QUARTER_END = 15;
const DUE_SOON_DAYS = 30;

// Quarter-ends (UTC): Mar 31, Jun 30, Sep 30, Dec 31 → [month (0-indexed), day].
const QUARTER_ENDS = [[2, 31], [5, 30], [8, 30], [11, 31]];

// Indian financial year ends Mar 31; the annual audited accounts are due within
// six months → Sep 30.
const ANNUAL_AUDIT_MONTH = 8; // September (0-indexed)
const ANNUAL_AUDIT_DAY = 30;

const INDICATIVE_NOTE =
  'Indicative deadlines from the standard K-RERA cadence (quarterly update within 15 days of each quarter-end; ' +
  'annual audited accounts within six months of the financial-year end). Verify exact dates on the K-RERA portal.';
const PREVIEW_NOTE =
  'Once the project is registered, post-registration compliance begins: a quarterly project update (within 15 days ' +
  'of each quarter-end) and an annual audited statement of accounts (within six months of the financial-year end).';

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcMidnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const daysBetween = (from, to) => Math.round((to.getTime() - from.getTime()) / 86400000);

const parseDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : utcMidnight(v);
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
};

/** The next `count` quarterly-update deadlines on/after today. */
const quarterlyDeadlinesFrom = (today, count) => {
  const out = [];
  const y0 = today.getUTCFullYear();
  for (let y = y0 - 1; y <= y0 + 2; y += 1) {
    for (const [m, d] of QUARTER_ENDS) {
      const qEnd = new Date(Date.UTC(y, m, d));
      const due = new Date(Date.UTC(y, m, d));
      due.setUTCDate(due.getUTCDate() + QPR_DAYS_AFTER_QUARTER_END);
      out.push({ qEnd, due });
    }
  }
  return out
    .filter((x) => x.due.getTime() >= today.getTime())
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .slice(0, count);
};

/** The next annual-audit deadline (Sep 30) on/after today. */
const nextAnnualAudit = (today) => {
  const y = today.getUTCFullYear();
  let due = new Date(Date.UTC(y, ANNUAL_AUDIT_MONTH, ANNUAL_AUDIT_DAY));
  if (due.getTime() < today.getTime()) due = new Date(Date.UTC(y + 1, ANNUAL_AUDIT_MONTH, ANNUAL_AUDIT_DAY));
  return due;
};

const buildItem = (id, kind, label, dueDate, today, description, allowOverdue) => {
  const du = daysBetween(today, dueDate);
  let status;
  if (du < 0) status = allowOverdue ? 'overdue' : 'upcoming';
  else if (du <= DUE_SOON_DAYS) status = 'due_soon';
  else status = 'upcoming';
  return { id, kind, label, due_date: isoDate(dueDate), days_until: du, status, description };
};

/**
 * composeComplianceCalendar(ctx, { applicabilityStatus, now })
 *   ctx: { reraNumber, completionDate, reraExpiryDate }
 * Returns { applicable, registered, status, items, summary?, note }.
 */
const composeComplianceCalendar = (ctx = {}, opts = {}) => {
  const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
  const today = utcMidnight(now);
  const applicabilityStatus = opts.applicabilityStatus || null;
  const registered = !!(ctx && ctx.reraNumber);

  if (!registered) {
    if (applicabilityStatus === 'in_scope' || applicabilityStatus === 'uncertain') {
      return { applicable: true, registered: false, status: 'preview', items: [], note: PREVIEW_NOTE };
    }
    return { applicable: false, registered: false, status: 'not_applicable', items: [], note: null };
  }

  const items = [];

  // Quarterly updates — the next two, forward-looking only.
  for (const { qEnd, due } of quarterlyDeadlinesFrom(today, 2)) {
    items.push(buildItem(
      `qpr:${isoDate(due)}`, 'quarterly',
      `Quarterly update — quarter ending ${isoDate(qEnd)}`,
      due, today,
      'File the quarterly project update (apartments/plots booked, construction progress with photos, approval status) on the K-RERA portal.',
      false,
    ));
  }

  // Annual audit — next Sep 30.
  items.push(buildItem(
    'annual_audit', 'annual', 'Annual audited statement of accounts',
    nextAnnualAudit(today), today,
    'File the annual audited statement of accounts (CA-certified) — due within six months of the financial-year end.',
    false,
  ));

  // Declared completion / extension — overdue if the declared date has passed.
  const completionDate = parseDate(ctx && ctx.completionDate);
  if (completionDate) {
    items.push(buildItem(
      'completion', 'extension', 'Declared completion / extension',
      completionDate, today,
      'Registration is valid to the declared completion date. If the project will run past it, apply for an extension before this date.',
      true,
    ));
  }

  // Certificate validity — overdue if expired.
  const expiryDate = parseDate(ctx && ctx.reraExpiryDate);
  if (expiryDate) {
    items.push(buildItem(
      'cert_expiry', 'validity', 'RERA certificate validity',
      expiryDate, today,
      'The K-RERA registration certificate is valid until this date.',
      true,
    ));
  }

  items.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));

  const summary = { total: items.length, overdue: 0, due_soon: 0, upcoming: 0 };
  for (const it of items) {
    if (summary[it.status] != null) summary[it.status] += 1;
  }

  return { applicable: true, registered: true, status: 'active', items, summary, note: INDICATIVE_NOTE };
};

module.exports = {
  composeComplianceCalendar,
  // exported for tests
  quarterlyDeadlinesFrom,
  nextAnnualAudit,
  parseDate,
  QPR_DAYS_AFTER_QUARTER_END,
};
