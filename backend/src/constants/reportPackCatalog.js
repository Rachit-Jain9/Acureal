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

  investor: {
    key: 'investor',
    label: 'Investor pack',
    hint: 'Returns-focused DOCX',
    docTitle: 'Investor Briefing',
    eyebrowText: 'Investor Briefing · Deal Review',
    footer: 'Investor Briefing · Organisation aid · Not investment advice or an offer',
    disclaimer:
      'This Investor Briefing is an organisation aid assembled from REDIP\'s structured deal data. It is not '
      + 'investment advice, an offer, a solicitation, or a valuation; modelled returns are scenario estimates, not '
      + 'guarantees, and depend on assumptions that may not hold. ' + SHARED_DISCLAIMER_TAIL,
    sections: [
      { id: 'returns_summary',    title: 'Return Profile',              lead: 'The headline return profile — IRR, equity multiple and value creation, straight from the deterministic kernel.' },
      { id: 'scenarios',          title: 'Scenarios & Sensitivity',     lead: 'How returns move across the bear, base and bull cases under the kernel\'s standard sensitivities. Estimates, not guarantees.' },
      { id: 'capital_stack',      title: 'Capital Stack',               lead: 'Financing scenarios scored against asset-class covenant norms — the equity/debt shape behind the base-case returns.' },
      { id: 'market_context',     title: 'Market Context',              lead: 'Where this site sits in its micro-market. Every figure carries its source and last-verified date; absence of a verified feed is stated plainly.' },
      { id: 'promoter',           title: 'Promoter & Execution',        lead: 'The promoter\'s recorded track record and REDIP\'s deterministic execution posture.' },
      { id: 'ic_readiness',       title: 'IC Readiness',                lead: 'How close the deal is to an investment-committee-ready package, by evidence bucket.' },
      { id: 'recommendations',    title: 'Diagnostic Call-outs',        lead: 'Deterministic call-outs composed from kernel signals — financial, market and structural only; statutory matters are excluded.' },
      { id: 'risk_register',      title: 'Risk Register',               lead: 'Open critical and high risk flags recorded on the deal.' },
      { id: 'closing',            title: 'Scope & Disclaimer',          lead: null },
    ],
  },

  buyer: {
    key: 'buyer',
    label: 'Buyer pack',
    hint: 'Buyer transparency DOCX',
    docTitle: 'Buyer Information Pack',
    eyebrowText: 'Buyer Information Pack',
    footer: 'Buyer Information Pack · Information aid · Verify RERA, title & approvals independently',
    disclaimer:
      'This Buyer Information Pack is an organisation aid prepared from the developer/advisor\'s records. It is NOT '
      + 'legal advice, financial advice, or any guarantee about the project, its registration, or its delivery. '
      + 'Verify the project\'s RERA registration directly on the Karnataka RERA portal (rera.karnataka.gov.in), and '
      + 'engage your own advocate to confirm title, encumbrances and approvals before any payment or booking. REDIP '
      + 'is a software tool — it is not the promoter, builder, or seller. ' + SHARED_DISCLAIMER_TAIL,
    sections: [
      { id: 'project_overview',     title: 'Project Overview',          lead: 'The essentials of the project at a glance.' },
      { id: 'rera_registration',    title: 'RERA Registration',         lead: 'The project\'s Karnataka RERA registration status. Verify this yourself on the official K-RERA portal before any booking.' },
      { id: 'statutory_approvals',  title: 'Approvals',                 lead: 'The statutory approvals on record and how far each has progressed. Status only — confirm originals with the developer.' },
      { id: 'security_title',       title: 'Title & Ownership',         lead: 'What the developer\'s records show about title and ownership. This is not a legal opinion — engage your own advocate.' },
      { id: 'professional_signoffs',title: 'Professional Sign-offs',    lead: 'Which professional certificates have been formally signed off on this project.' },
      { id: 'closing',              title: 'Important — Please Read',    lead: null },
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
