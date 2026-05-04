'use strict';

/**
 * Tool registry foundation (Tier 3 — first PR).
 *
 * The "Deal Analyst" agent (per docs/AI_ROADMAP.md §7) needs a curated
 * set of narrow backend functions it can call to read deal data, run
 * deterministic computations, and draft narrative artifacts. Until now
 * we had no registry; the full agent loop was deferred behind a
 * "≥50 real deals" entry criterion.
 *
 * This file ships the registry pattern + a small starter tool set. Once
 * the entry criterion clears, the agent runner (a future PR) loads tools
 * by name + permission, validates inputs with each tool's Zod schema,
 * runs the handler under the requesting user's session (RLS enforces
 * tenant scope), and routes the result back into the model.
 *
 * Permission tiers (see AI_ROADMAP §7.2):
 *   read              → AI may call freely (returns data only)
 *   compute           → AI may call (deterministic; results cached per call)
 *   draft             → AI may call; output lands as ai_artifacts.status='draft'
 *   approval-required → AI cannot call directly; the runner surfaces a
 *                       confirmation prompt to the user before invoking
 *
 * Registering a new tool: add a {name, description, inputSchema, permission,
 * handler} entry to TOOLS. Inputs are validated by Zod before the handler
 * runs; the runner enforces permissions before dispatch.
 */

const { z } = require('zod');
const { query } = require('../../../config/database');

// Each tool: small, single-purpose, returns pre-shaped JSON.
// The AI sees `description` to decide when to call. Be specific.
const TOOLS = {
  // ── read tools ──────────────────────────────────────────────────────────
  getDeal: {
    name: 'getDeal',
    description:
      'Fetch a deal by id with its core fields (name, stage, priority, deal_type, financial summary, risk count). Use this once at the start of an analysis.',
    permission: 'read',
    inputSchema: z.object({ dealId: z.string().uuid() }),
    handler: async ({ dealId }) => {
      const result = await query(
        `SELECT d.id, d.name, d.stage, d.priority, d.deal_type, d.notes,
                d.land_ask_price_cr, d.negotiated_price_cr,
                p.city, p.address, p.property_type, p.land_area_acres, p.zoning,
                f.irr_pct, f.npv_cr, f.equity_multiple, f.gross_margin_pct,
                f.total_cost_cr, f.total_revenue_cr,
                (SELECT COUNT(*) FROM risk_flags rf WHERE rf.deal_id = d.id AND rf.status = 'open')::int AS open_risks
           FROM deals d
           LEFT JOIN properties p ON d.property_id = p.id
           LEFT JOIN financials f ON f.deal_id = d.id
          WHERE d.id = $1`,
        [dealId],
      );
      return result.rows[0] || null;
    },
  },

  searchComps: {
    name: 'searchComps',
    description:
      'Find verified-transaction comparables by city + asset class. Returns rate per sqft, BHK config, locality, project name. Use this to anchor pricing assumptions in market evidence.',
    permission: 'read',
    inputSchema: z.object({
      city: z.string().min(2).max(64),
      assetClass: z.string().optional(),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    handler: async ({ city, assetClass, limit = 10 }) => {
      const where = ['LOWER(city) ILIKE $1', 'is_verified = TRUE'];
      const params = [`%${String(city).toLowerCase()}%`];
      if (assetClass) {
        params.push(assetClass);
        where.push(`asset_class = $${params.length}`);
      }
      params.push(limit);
      const result = await query(
        `SELECT project_name, developer, locality, asset_class, rate_per_sqft,
                bhk_config, total_units, launch_year
           FROM comps
          WHERE ${where.join(' AND ')}
          ORDER BY rate_per_sqft DESC NULLS LAST
          LIMIT $${params.length}`,
        params,
      );
      return result.rows;
    },
  },

  searchEvidence: {
    name: 'searchEvidence',
    description:
      'Semantic search across the workspace\'s indexed document chunks. Use this to find supporting evidence for a claim — e.g. "encumbrance clauses", "approval delay terms".',
    permission: 'read',
    inputSchema: z.object({
      query: z.string().min(2).max(512),
      k: z.number().int().min(1).max(25).default(8),
      documentId: z.string().uuid().optional(),
    }),
    handler: async ({ query: q, k = 8, documentId = null }) => {
      const embeddings = require('../../embeddings.service');
      return embeddings.searchSimilar({ query: q, k, documentId });
    },
  },
};

const TOOL_NAMES = Object.keys(TOOLS);

const getTool = (name) => TOOLS[name] || null;

const listTools = (filter = {}) => {
  const { permission } = filter;
  return TOOL_NAMES
    .filter((name) => (!permission || TOOLS[name].permission === permission))
    .map((name) => {
      const t = TOOLS[name];
      return { name: t.name, description: t.description, permission: t.permission };
    });
};

const PERMISSION_RANK = { read: 0, compute: 1, draft: 2, 'approval-required': 3 };

const isPermissionAllowed = (toolPermission, runnerMaxPermission) => {
  return PERMISSION_RANK[toolPermission] <= PERMISSION_RANK[runnerMaxPermission];
};

/**
 * Validate input + invoke the tool handler. Used by the future agent
 * runner; exported now so the test suite + admin tooling can exercise
 * tools deterministically.
 *
 *   const result = await invokeTool('getDeal', { dealId }, { maxPermission: 'read' });
 *
 * Throws:
 *   - 'Unknown tool: X' for unregistered names
 *   - 'Tool X requires permission Y' when above the runner's max
 *   - Zod validation error on bad input shape
 */
const invokeTool = async (name, input, { maxPermission = 'read' } = {}) => {
  const tool = TOOLS[name];
  if (!tool) {
    const err = new Error(`Unknown tool: ${name}`);
    err.code = 'UNKNOWN_TOOL';
    throw err;
  }
  if (!isPermissionAllowed(tool.permission, maxPermission)) {
    const err = new Error(`Tool ${name} requires permission ${tool.permission} but runner has ${maxPermission}.`);
    err.code = 'TOOL_PERMISSION_DENIED';
    throw err;
  }
  const validated = tool.inputSchema.parse(input);
  return tool.handler(validated);
};

module.exports = {
  TOOLS,
  TOOL_NAMES,
  getTool,
  listTools,
  invokeTool,
  isPermissionAllowed,
  PERMISSION_RANK,
};
