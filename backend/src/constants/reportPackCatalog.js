'use strict';

/**
 * reportPackCatalog — the declarative single source of truth for the
 * audience-tailored report packs (lender / investor / buyer).
 *
 * Each audience is pure data: its document framing (cover eyebrow, doc title,
 * footer, closing disclaimer) and an ORDERED list of sections. A section entry
 * names a composer id (resolved in `services/exports/reportPack/composePack.js`)
 * plus the audience-specific framing — the section title and the deterministic
 * "lead" sentence shown under it.
 *
 * Adding a fourth audience, or reordering/ reframing sections, is an edit HERE
 * — never in the composer or the renderer. The composer supplies the data; the
 * renderer draws it; this catalog decides what each reader sees and how it is
 * framed.
 *
 * Honesty (CLAUDE.md): the legal-four lanes (title, encumbrance, RERA
 * registration, statutory approvals) are framed as documentary STATUS only in
 * every audience; leads never assert a conclusion.
 */

const SHARED_DISCLAIMER_TAIL =
  'Market figures, where shown, carry their source and last-verified date; where no verified feed exists that is '
  + 'stated plainly. Title, encumbrance, RERA registration and statutory-approval positions are documentary status '
  + 'only — confirm each independently with qualified counsel and the issuing authorities. No figure in this pack is '
  + 'model-generated; all numbers come from REDIP\'s deterministic underwriting kernel.';

const REPORT_PACK_AUDIENCES = Object.freeze({
  lender: {
    key: 'lender',
    label: 'Lender pack',
    hint: 'Credit-focused DOCX',
    docTitle: 'Lender Briefing',
    eyebrowText: 'Lender Briefing · Credit Review',
    footer: 'Lender Briefing · Organisation aid · Not a credit decision or legal opinion',
    disclaimer:
      'This Lender Briefing is an organisation aid assembled from REDIP\'s structured deal data. It is not a credit '
      + 'decision, a valuation, or a legal opinion; the lending decision rests with the institution\'s own credit '
      + 'process. ' + SHARED_DISCLAIMER_TAIL,
    sections: [
      { id: 'credit_summary',     title: 'Credit Summary',              lead: 'Headline cost, leverage and coverage a credit committee screens first — straight from the deterministic kernel.' },
      { id: 'covenant_posture',   title: 'Leverage & Covenant Posture', lead: 'Loan-to-value, loan-to-cost and debt-service coverage against conventional Indian real-estate lending covenants.' },
      { id: 'downside_stress',    title: 'Downside & Stress',           lead: 'How the deal holds under the bear case — the scenario a lender underwrites to, not the base case.' },
      { id: 'security_title',     title: 'Security & Title Posture',    lead: 'Title and ownership evidence on file. Documentary status only — confirm the chain of title and encumbrances with counsel before lending.' },
      { id: 'statutory_approvals',title: 'Statutory Approvals',         lead: 'Approval inventory and the evidence maturity recorded for each. Status only — not a confirmation of validity.' },
      { id: 'rera_registration',  title: 'RERA Registration',           lead: 'Karnataka RERA registration posture and any outstanding filing blockers. Status only — never a compliance verdict.' },
      { id: 'risk_register',      title: 'Risk Register',               lead: 'Open critical and high risk flags recorded on the deal.' },
      { id: 'repayment_exit',     title: 'Repayment & Exit',            lead: 'Exit value, income coverage and timeline that frame repayment capacity.' },
      { id: 'closing',            title: 'Scope & Disclaimer',          lead: null },
    ],
  },
});

const getAudience = (key) => REPORT_PACK_AUDIENCES[key] || null;
const listAudiences = () => Object.values(REPORT_PACK_AUDIENCES);
const isAudience = (key) => Object.prototype.hasOwnProperty.call(REPORT_PACK_AUDIENCES, key);

module.exports = {
  REPORT_PACK_AUDIENCES,
  SHARED_DISCLAIMER_TAIL,
  getAudience,
  listAudiences,
  isAudience,
};
