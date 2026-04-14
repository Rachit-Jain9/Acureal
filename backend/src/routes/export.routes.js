const express = require('express');
const { query: qv, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const XLSX = require('xlsx');
const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');
const pptxgen = require('pptxgenjs');

const router = express.Router();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

const escapeCsvField = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toCsvRow = (fields) => fields.map(escapeCsvField).join(',');

// GET /exports/deals
router.get(
  '/deals',
  authenticate,
  requireRole('admin', 'analyst'),
  [qv('stage').optional(), qv('city').optional()],
  handleValidation,
  async (req, res, next) => {
    return res.status(410).json({
      success: false,
      message: 'JSON IC report exports have been retired. Use PDF, PPTX, XLSX, or CSV exports instead.',
    });

    try {
      const conditions = ['1=1'];
      const values = [];
      let paramCount = 1;

      if (req.query.stage) {
        conditions.push(`d.stage = $${paramCount}`);
        values.push(req.query.stage);
        paramCount++;
      }
      if (req.query.city) {
        conditions.push(`LOWER(p.city) = LOWER($${paramCount})`);
        values.push(req.query.city);
        paramCount++;
      }

      const result = await query(
        `SELECT d.name as deal_name, d.deal_type, d.stage, d.priority,
          p.name as property_name, p.city, p.state, p.land_area_sqft,
          d.land_ask_price_cr, d.negotiated_price_cr,
          f.total_revenue_cr, f.total_cost_cr, f.gross_profit_cr,
          f.irr_pct, f.npv_cr, f.gross_margin_pct,
          u.name as assigned_to_name,
          d.created_at, d.updated_at
         FROM deals d
         LEFT JOIN properties p ON d.property_id = p.id
         LEFT JOIN financials f ON d.id = f.deal_id
         LEFT JOIN users u ON d.assigned_to = u.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY d.updated_at DESC`,
        values
      );

      const headers = [
        'Deal Name', 'Deal Type', 'Stage', 'Priority',
        'Property', 'City', 'State', 'Land Area (sqft)',
        'Ask Price (Cr)', 'Negotiated Price (Cr)',
        'Revenue (Cr)', 'Cost (Cr)', 'Profit (Cr)',
        'IRR %', 'NPV (Cr)', 'Margin %',
        'Assigned To', 'Created', 'Updated',
      ];

      const rows = result.rows.map((r) =>
        toCsvRow([
          r.deal_name, r.deal_type, r.stage, r.priority,
          r.property_name, r.city, r.state, r.land_area_sqft,
          r.land_ask_price_cr, r.negotiated_price_cr,
          r.total_revenue_cr, r.total_cost_cr, r.gross_profit_cr,
          r.irr_pct, r.npv_cr, r.gross_margin_pct,
          r.assigned_to_name, r.created_at, r.updated_at,
        ])
      );

      const csv = [toCsvRow(headers), ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="deals-export-${Date.now()}.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  }
);

// GET /exports/comps
router.get(
  '/comps',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const result = await query(
        `SELECT project_name, developer, city, locality, project_type,
          bhk_config, carpet_area_sqft, super_builtup_area_sqft,
          rate_per_sqft, total_units, launch_year, possession_year,
          rera_number, source, created_at
         FROM comps ORDER BY city, rate_per_sqft DESC`
      );

      const headers = [
        'Project', 'Developer', 'City', 'Locality', 'Type',
        'BHK', 'Carpet (sqft)', 'Super Built-up (sqft)',
        'Rate/sqft', 'Units', 'Launch Year', 'Possession Year',
        'RERA', 'Source', 'Added',
      ];

      const rows = result.rows.map((r) =>
        toCsvRow([
          r.project_name, r.developer, r.city, r.locality, r.project_type,
          r.bhk_config, r.carpet_area_sqft, r.super_builtup_area_sqft,
          r.rate_per_sqft, r.total_units, r.launch_year, r.possession_year,
          r.rera_number, r.source, r.created_at,
        ])
      );

      const csv = [toCsvRow(headers), ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="comps-export-${Date.now()}.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  }
);

// GET /exports/ic-report/:dealId
router.get(
  '/ic-report/:dealId',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const dealResult = await query(
        `SELECT d.*, p.name as property_name, p.city, p.state,
          p.land_area_sqft, p.zoning, p.address, p.survey_number,
          p.circle_rate_per_sqft, p.permissible_fsi,
          u.name as assigned_to_name,
          f.*
         FROM deals d
         LEFT JOIN properties p ON d.property_id = p.id
         LEFT JOIN users u ON d.assigned_to = u.id
         LEFT JOIN financials f ON d.id = f.deal_id
         WHERE d.id = $1`,
        [req.params.dealId]
      );

      if (dealResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      const deal = dealResult.rows[0];

      // Get activities
      const activitiesResult = await query(
        `SELECT a.*, u.name as performed_by_name
         FROM activities a LEFT JOIN users u ON a.performed_by = u.id
         WHERE a.deal_id = $1 ORDER BY a.activity_date DESC LIMIT 20`,
        [req.params.dealId]
      );

      // Get stage history
      const historyResult = await query(
        `SELECT dsh.*, u.name as changed_by_name
         FROM deal_stage_history dsh LEFT JOIN users u ON dsh.changed_by = u.id
         WHERE dsh.deal_id = $1 ORDER BY dsh.changed_at ASC`,
        [req.params.dealId]
      );

      // Risk assessment
      const risks = [];
      if (deal.irr_pct && deal.irr_pct < 15) risks.push({ level: 'high', factor: 'Low IRR', detail: `IRR at ${deal.irr_pct}% is below 15% threshold` });
      if (deal.gross_margin_pct && deal.gross_margin_pct < 10) risks.push({ level: 'high', factor: 'Thin margins', detail: `Gross margin at ${deal.gross_margin_pct}%` });
      if (deal.land_ask_price_cr && deal.residual_land_value_cr && deal.land_ask_price_cr > deal.residual_land_value_cr) {
        risks.push({ level: 'medium', factor: 'Land price above RLV', detail: `Ask ₹${deal.land_ask_price_cr} Cr vs RLV ₹${deal.residual_land_value_cr} Cr` });
      }
      if (!deal.rera_number) risks.push({ level: 'low', factor: 'No RERA registration', detail: 'RERA number not provided' });

      // Recommendation
      let recommendation = 'PROCEED';
      if (risks.filter((r) => r.level === 'high').length >= 2) recommendation = 'REJECT';
      else if (risks.filter((r) => r.level === 'high').length >= 1) recommendation = 'PROCEED WITH CAUTION';

      const report = {
        report_type: 'IC Report',
        generated_at: new Date().toISOString(),
        generated_by: req.user.name,
        deal: {
          name: deal.name,
          type: deal.deal_type,
          stage: deal.stage,
          priority: deal.priority,
          property: deal.property_name,
          city: deal.city,
          state: deal.state,
          land_area_sqft: deal.land_area_sqft,
          zoning: deal.zoning,
        },
        financials: {
          land_cost_cr: deal.land_cost_cr,
          total_revenue_cr: deal.total_revenue_cr,
          total_cost_cr: deal.total_cost_cr,
          gross_profit_cr: deal.gross_profit_cr,
          gross_margin_pct: deal.gross_margin_pct,
          irr_pct: deal.irr_pct,
          npv_cr: deal.npv_cr,
          equity_multiple: deal.equity_multiple,
          residual_land_value_cr: deal.residual_land_value_cr,
        },
        risk_assessment: risks,
        recommendation,
        stage_history: historyResult.rows,
        recent_activities: activitiesResult.rows,
      };

      res.json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  }
);

// ─── XLSX Export ─────────────────────────────────────────────────────────────

// GET /exports/deals/xlsx — multi-sheet workbook with deals + financials
router.get(
  '/deals/xlsx',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const dealsResult = await query(
        `SELECT d.name as "Deal Name", d.deal_type as "Type", d.stage as "Stage",
          d.priority as "Priority", d.asset_class as "Asset Class",
          p.name as "Property", p.city as "City", p.state as "State",
          p.land_area_sqft as "Land Area (sqft)",
          d.land_ask_price_cr as "Ask Price (Cr)", d.negotiated_price_cr as "Negotiated Price (Cr)",
          f.total_revenue_cr as "Revenue (Cr)", f.total_cost_cr as "Total Cost (Cr)",
          f.gross_profit_cr as "Gross Profit (Cr)", f.gross_margin_pct as "Margin %",
          f.irr_pct as "IRR %", f.npv_cr as "NPV (Cr)",
          f.equity_multiple as "Equity Multiple", f.residual_land_value_cr as "RLV (Cr)",
          u.name as "Assigned To",
          TO_CHAR(d.created_at, 'YYYY-MM-DD') as "Created",
          TO_CHAR(d.updated_at, 'YYYY-MM-DD') as "Updated"
         FROM deals d
         LEFT JOIN properties p ON d.property_id = p.id
         LEFT JOIN financials f ON d.id = f.deal_id
         LEFT JOIN users u ON d.assigned_to = u.id
         WHERE d.is_archived = FALSE
         ORDER BY d.updated_at DESC`
      );

      const compsResult = await query(
        `SELECT project_name as "Project", developer as "Developer",
          city as "City", locality as "Locality", project_type as "Type",
          bhk_config as "BHK Config", carpet_area_sqft as "Carpet (sqft)",
          super_builtup_area_sqft as "Super Built-up (sqft)",
          rate_per_sqft as "Rate/sqft (₹)", total_units as "Total Units",
          launch_year as "Launch Year", possession_year as "Possession Year",
          rera_number as "RERA", source as "Source"
         FROM comps ORDER BY city, rate_per_sqft DESC`
      );

      const wb = XLSX.utils.book_new();

      // Deals sheet
      const dealsWs = XLSX.utils.json_to_sheet(dealsResult.rows);
      XLSX.utils.book_append_sheet(wb, dealsWs, 'Deals Pipeline');

      // Comps sheet
      const compsWs = XLSX.utils.json_to_sheet(compsResult.rows);
      XLSX.utils.book_append_sheet(wb, compsWs, 'Comps');

      // Summary sheet
      const summaryData = [
        { Metric: 'Total Active Deals', Value: dealsResult.rows.length },
        { Metric: 'Export Date', Value: new Date().toISOString().slice(0, 10) },
        { Metric: 'Exported By', Value: req.user.name },
        { Metric: 'Platform', Value: 'REDIP — Real Estate Development Intelligence' },
      ];
      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="redip-deals-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);

// GET /exports/deals/:dealId/xlsx — single deal financial model workbook
router.get(
  '/deals/:dealId/xlsx',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const dealResult = await query(
        `SELECT d.*, p.name as property_name, p.city, p.state, p.land_area_sqft,
          p.zoning, p.address, u.name as assigned_to_name,
          f.land_cost_cr, f.total_construction_cost_cr, f.approval_cost_cr,
          f.marketing_cost_cr, f.finance_cost_cr, f.total_cost_cr,
          f.total_revenue_cr, f.gross_profit_cr, f.gross_margin_pct,
          f.irr_pct, f.npv_cr, f.equity_multiple, f.residual_land_value_cr,
          f.asset_class as financial_asset_class, f.model_params,
          f.discount_rate_pct, f.project_duration_months
         FROM deals d
         LEFT JOIN properties p ON d.property_id = p.id
         LEFT JOIN users u ON d.assigned_to = u.id
         LEFT JOIN financials f ON d.id = f.deal_id
         WHERE d.id = $1`,
        [req.params.dealId]
      );

      if (dealResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      const d = dealResult.rows[0];

      const wb = XLSX.utils.book_new();

      // Deal Overview sheet
      const overviewData = [
        { Field: 'Deal Name', Value: d.name },
        { Field: 'Deal Type', Value: d.deal_type },
        { Field: 'Stage', Value: d.stage },
        { Field: 'Priority', Value: d.priority },
        { Field: 'Asset Class', Value: d.asset_class },
        { Field: 'Property', Value: d.property_name || '—' },
        { Field: 'City', Value: d.city || '—' },
        { Field: 'State', Value: d.state || '—' },
        { Field: 'Land Area (sqft)', Value: d.land_area_sqft },
        { Field: 'Zoning', Value: d.zoning },
        { Field: 'Ask Price (₹ Cr)', Value: d.land_ask_price_cr },
        { Field: 'Negotiated Price (₹ Cr)', Value: d.negotiated_price_cr },
        { Field: 'Assigned To', Value: d.assigned_to_name },
        { Field: 'RERA Number', Value: d.rera_number || 'Not registered' },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewData), 'Deal Overview');

      // Financial Model sheet
      const financialData = [
        { Category: 'COSTS', Item: 'Land Cost', Value_Cr: d.land_cost_cr },
        { Category: 'COSTS', Item: 'Construction Cost', Value_Cr: d.total_construction_cost_cr },
        { Category: 'COSTS', Item: 'Approval Cost', Value_Cr: d.approval_cost_cr },
        { Category: 'COSTS', Item: 'Marketing Cost', Value_Cr: d.marketing_cost_cr },
        { Category: 'COSTS', Item: 'Finance Cost', Value_Cr: d.finance_cost_cr },
        { Category: 'COSTS', Item: 'TOTAL COST', Value_Cr: d.total_cost_cr },
        { Category: 'REVENUE', Item: 'Total Revenue', Value_Cr: d.total_revenue_cr },
        { Category: 'PROFIT', Item: 'Gross Profit', Value_Cr: d.gross_profit_cr },
        { Category: 'PROFIT', Item: 'Gross Margin %', Value_Cr: d.gross_margin_pct },
        { Category: 'RETURNS', Item: 'IRR %', Value_Cr: d.irr_pct },
        { Category: 'RETURNS', Item: 'NPV (₹ Cr)', Value_Cr: d.npv_cr },
        { Category: 'RETURNS', Item: 'Equity Multiple', Value_Cr: d.equity_multiple },
        { Category: 'RETURNS', Item: 'Residual Land Value (₹ Cr)', Value_Cr: d.residual_land_value_cr },
        { Category: 'ASSUMPTIONS', Item: 'Discount Rate %', Value_Cr: d.discount_rate_pct },
        { Category: 'ASSUMPTIONS', Item: 'Project Duration (months)', Value_Cr: d.project_duration_months },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(financialData), 'Financial Model');

      // Metadata sheet
      const metaData = [
        { Field: 'Report Type', Value: 'Deal Financial Export' },
        { Field: 'Generated By', Value: req.user.name },
        { Field: 'Generated At', Value: new Date().toISOString() },
        { Field: 'Deal ID', Value: d.id },
        { Field: 'Platform', Value: 'REDIP — Real Estate Development Intelligence' },
        { Field: 'Disclaimer', Value: 'This export is generated from current deal assumptions. All figures are in INR Crore unless stated otherwise. Verify all inputs before investment decisions.' },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaData), 'Metadata');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const safeName = (d.name || 'deal').replace(/[^a-z0-9]/gi, '-').toLowerCase();

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="redip-${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);

// ─── PDF Export ───────────────────────────────────────────────────────────────

// GET /exports/deals/:dealId/pdf — deal summary PDF
router.get(
  '/deals/:dealId/pdf',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const dealResult = await query(
        `SELECT d.*, p.name as property_name, p.city, p.state,
          p.land_area_sqft, p.zoning, p.address, p.survey_number,
          u.name as assigned_to_name,
          f.total_revenue_cr, f.total_cost_cr, f.gross_profit_cr,
          f.gross_margin_pct, f.irr_pct, f.npv_cr, f.equity_multiple,
          f.residual_land_value_cr, f.land_cost_cr
         FROM deals d
         LEFT JOIN properties p ON d.property_id = p.id
         LEFT JOIN users u ON d.assigned_to = u.id
         LEFT JOIN financials f ON d.id = f.deal_id
         WHERE d.id = $1`,
        [req.params.dealId]
      );

      if (dealResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      const d = dealResult.rows[0];

      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const page = pdfDoc.addPage(PageSizes.A4);
      const { width, height } = page.getSize();
      const margin = 50;
      let y = height - margin;

      const toPdfSafeText = (value) =>
        String(value ?? 'N/A')
          .replace(/₹|â‚¹/g, 'INR ')
          .replace(/Â·|·/g, ' | ')
          .replace(/â€”|—/g, '-')
          .replace(/–/g, '-')
          .replace(/×/g, 'x')
          .replace(/[^\x20-\x7E\n]/g, '');

      const drawText = (text, x, yPos, opts = {}) => {
        const { size = 10, isBold = false, color = rgb(0.1, 0.1, 0.1) } = opts;
        page.drawText(toPdfSafeText(text), { x, y: yPos, size, font: isBold ? boldFont : font, color });
      };

      const drawLine = (yPos) => {
        page.drawLine({ start: { x: margin, y: yPos }, end: { x: width - margin, y: yPos }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
      };

      const fmt = (v, suffix = '') => (v != null && v !== '' ? `${Number(v).toFixed(2)}${suffix}` : 'N/A');

      // Header bar
      page.drawRectangle({ x: 0, y: height - 60, width, height: 60, color: rgb(0.05, 0.15, 0.35) });
      drawText('REDIP', margin, height - 35, { size: 18, isBold: true, color: rgb(1, 1, 1) });
      drawText('Deal Summary Report', margin + 100, height - 35, { size: 12, color: rgb(0.8, 0.9, 1) });
      drawText(`Generated: ${new Date().toLocaleDateString('en-IN')}`, width - 200, height - 35, { size: 9, color: rgb(0.7, 0.8, 0.9) });
      drawText(`By: ${req.user.name}`, width - 200, height - 48, { size: 9, color: rgb(0.7, 0.8, 0.9) });

      y = height - 80;

      // Deal title
      drawText(d.name || 'Unnamed Deal', margin, y, { size: 16, isBold: true });
      y -= 18;
      drawText(`${d.deal_type?.toUpperCase()} · ${d.stage?.replace(/_/g, ' ').toUpperCase()} · ${(d.priority || 'medium').toUpperCase()} PRIORITY`, margin, y, { size: 9, color: rgb(0.4, 0.4, 0.4) });
      y -= 20;
      drawLine(y);
      y -= 16;

      // Property section
      drawText('PROPERTY', margin, y, { size: 8, isBold: true, color: rgb(0.2, 0.4, 0.8) });
      y -= 14;
      const propLines = [
        ['Name', d.property_name],
        ['Address', d.address],
        ['City / State', [d.city, d.state].filter(Boolean).join(', ')],
        ['Land Area', d.land_area_sqft ? `${Number(d.land_area_sqft).toLocaleString('en-IN')} sqft` : null],
        ['Zoning', d.zoning],
        ['Survey No.', d.survey_number],
      ];
      for (const [label, value] of propLines) {
        drawText(`${label}:`, margin, y, { size: 9, isBold: true });
        drawText(value || '—', margin + 100, y, { size: 9 });
        y -= 13;
      }
      y -= 6;
      drawLine(y);
      y -= 16;

      // Deal details
      drawText('DEAL DETAILS', margin, y, { size: 8, isBold: true, color: rgb(0.2, 0.4, 0.8) });
      y -= 14;
      const dealLines = [
        ['Asset Class', d.asset_class?.replace(/_/g, ' ')],
        ['Structure', d.deal_structure?.replace(/_/g, ' ')],
        ['Ask Price', d.land_ask_price_cr ? `₹${fmt(d.land_ask_price_cr)} Cr` : null],
        ['Negotiated Price', d.negotiated_price_cr ? `₹${fmt(d.negotiated_price_cr)} Cr` : null],
        ['Assigned To', d.assigned_to_name],
        ['RERA', d.rera_number || 'Not registered'],
      ];
      for (const [label, value] of dealLines) {
        drawText(`${label}:`, margin, y, { size: 9, isBold: true });
        drawText(value || '—', margin + 100, y, { size: 9 });
        y -= 13;
      }
      y -= 6;
      drawLine(y);
      y -= 16;

      // Financials section
      drawText('FINANCIAL SUMMARY', margin, y, { size: 8, isBold: true, color: rgb(0.2, 0.4, 0.8) });
      y -= 14;
      const finLines = [
        ['Land Cost', d.land_cost_cr ? `₹${fmt(d.land_cost_cr)} Cr` : null],
        ['Total Cost', d.total_cost_cr ? `₹${fmt(d.total_cost_cr)} Cr` : null],
        ['Total Revenue', d.total_revenue_cr ? `₹${fmt(d.total_revenue_cr)} Cr` : null],
        ['Gross Profit', d.gross_profit_cr ? `₹${fmt(d.gross_profit_cr)} Cr` : null],
        ['Gross Margin', d.gross_margin_pct ? `${fmt(d.gross_margin_pct)}%` : null],
        ['IRR', d.irr_pct ? `${fmt(d.irr_pct)}%` : null],
        ['NPV', d.npv_cr ? `₹${fmt(d.npv_cr)} Cr` : null],
        ['Equity Multiple', d.equity_multiple ? `${fmt(d.equity_multiple, 'x')}` : null],
        ['Residual Land Value', d.residual_land_value_cr ? `₹${fmt(d.residual_land_value_cr)} Cr` : null],
      ];
      for (const [label, value] of finLines) {
        drawText(`${label}:`, margin, y, { size: 9, isBold: true });
        drawText(value || '—', margin + 140, y, { size: 9 });
        y -= 13;
      }

      y -= 10;
      drawLine(y);
      y -= 14;

      // Disclaimer
      drawText('Disclaimer: Generated from current deal assumptions. All values in INR Crore unless stated. Verify all inputs before investment decisions.', margin, y, { size: 7, color: rgb(0.5, 0.5, 0.5) });

      const pdfBytes = await pdfDoc.save();
      const safeName = (d.name || 'deal').replace(/[^a-z0-9]/gi, '-').toLowerCase();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="redip-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      next(error);
    }
  }
);

// ─── PPTX Export ─────────────────────────────────────────────────────────────
// GET /exports/deals/:dealId/pptx — Investor-grade PowerPoint deck

router.get(
  '/deals/:dealId/pptx',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const { dealId } = req.params;

      // Fetch full deal with financials and property
      const dealResult = await query(
        `SELECT d.*,
          COALESCE(NULLIF(p.name,''), NULLIF(p.address,''), CONCAT(COALESCE(NULLIF(p.city,''),'Unknown city'),' Land opportunity')) as property_name,
          p.address as property_address, p.city, p.state, p.land_area_sqft, p.zoning,
          p.survey_number, p.owner_name, p.circle_rate_per_sqft, p.permissible_fsi,
          u.name as assigned_to_name,
          f.land_cost_cr,
          f.total_construction_cost_cr AS construction_cost_cr,
          f.approval_cost_cr, f.marketing_cost_cr, f.finance_cost_cr,
          f.gst_cost_cr, f.stamp_duty_cr,
          f.total_cost_cr,
          f.total_revenue_cr, f.gross_profit_cr, f.gross_margin_pct,
          f.irr_pct, f.npv_cr, f.equity_multiple, f.residual_land_value_cr,
          f.saleable_area_sqft, f.gross_area_sqft, f.carpet_area_sqft,
          f.selling_rate_per_sqft, f.construction_cost_per_sqft,
          f.fsi, f.loading_factor, f.plot_area_sqft,
          f.discount_rate_pct, f.project_duration_months,
          f.developer_margin_pct, f.asset_class as financial_asset_class,
          f.model_params, f.cash_flows
         FROM deals d
         LEFT JOIN properties p ON d.property_id = p.id
         LEFT JOIN users u ON d.assigned_to = u.id
         LEFT JOIN financials f ON d.id = f.deal_id
         WHERE d.id = $1`,
        [dealId]
      );

      if (dealResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }
      const d = dealResult.rows[0];

      // Fetch DD completion
      const ddResult = await query(
        `SELECT
          COUNT(*) FILTER (WHERE is_required) as total_required,
          COUNT(*) FILTER (WHERE is_required AND status IN ('completed','not_applicable')) as completed_required,
          COUNT(*) FILTER (WHERE severity = 'deal_breaker' AND status NOT IN ('completed','not_applicable')) as open_deal_breakers
         FROM dd_items WHERE deal_id = $1`,
        [dealId]
      );
      const dd = ddResult.rows[0] || {};

      // Fetch risk flags summary
      const riskResult = await query(
        `SELECT severity, COUNT(*) as count
         FROM risk_flags WHERE deal_id = $1 AND status IN ('open','flagged')
         GROUP BY severity`,
        [dealId]
      );
      const riskMap = {};
      riskResult.rows.forEach((r) => { riskMap[r.severity] = parseInt(r.count, 10); });

      // Fetch comps for the city
      const compsResult = await query(
        `SELECT project_name, rate_per_sqft, project_type
         FROM comps WHERE city ILIKE $1 AND is_verified = TRUE
         ORDER BY rate_per_sqft DESC LIMIT 6`,
        [d.city || 'Bengaluru']
      );

      // ─── Build PPTX ──────────────────────────────────────────────────────────

      const prs = new pptxgen();
      prs.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"

      // Colour palette
      const DARK_BLUE  = '0F2044';
      const ACCENT     = '2563EB';
      const LIGHT_GRAY = 'F1F5F9';
      const TEXT_DARK  = '1E293B';
      const TEXT_MID   = '475569';
      const WHITE      = 'FFFFFF';

      const fmt = (v, unit = '') => {
        if (v == null || v === '') return 'N/A';
        const n = parseFloat(v);
        if (isNaN(n)) return 'N/A';
        return `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit}`;
      };
      const cr = (v) => v != null ? `₹${fmt(v)} Cr` : 'N/A';
      const pct = (v) => v != null ? `${fmt(v)}%` : 'N/A';

      const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

      // ─────────────────────────────────────────────────────
      // SLIDE 1 — Cover
      // ─────────────────────────────────────────────────────
      const slide1 = prs.addSlide();

      // Dark background
      slide1.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: DARK_BLUE } });
      // Accent bar
      slide1.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.4, h: '100%', fill: { color: ACCENT } });

      slide1.addText('REDIP', {
        x: 0.7, y: 0.5, w: 11, h: 0.6,
        fontSize: 13, bold: true, color: '93C5FD', fontFace: 'Helvetica',
      });
      slide1.addText(d.name || 'Deal Summary', {
        x: 0.7, y: 1.3, w: 11, h: 1.2,
        fontSize: 36, bold: true, color: WHITE, fontFace: 'Helvetica', wrap: true,
      });
      slide1.addText(
        [d.asset_class, d.deal_structure, d.city, d.state].filter(Boolean).join(' · '),
        { x: 0.7, y: 2.7, w: 11, h: 0.5, fontSize: 15, color: '94A3B8', fontFace: 'Helvetica' }
      );

      // KPI strip
      const kpis = [
        { label: 'Stage',          value: (d.stage || '').replace(/_/g, ' ').toUpperCase() },
        { label: 'Ask Price',      value: cr(d.land_ask_price_cr) },
        { label: 'IRR',            value: pct(d.irr_pct) },
        { label: 'Gross Margin',   value: pct(d.gross_margin_pct) },
        { label: 'Equity Multiple',value: d.equity_multiple ? `${fmt(d.equity_multiple)}x` : 'N/A' },
      ];
      const kpiW = 2.5, kpiH = 1.2, kpiY = 4.8, kpiStartX = 0.7;
      kpis.forEach((k, i) => {
        const x = kpiStartX + i * (kpiW + 0.12);
        slide1.addShape(prs.ShapeType.rect, {
          x, y: kpiY, w: kpiW, h: kpiH,
          fill: { color: '1E3A5F' }, line: { color: '2563EB', width: 1 }, radius: 4,
        });
        slide1.addText(k.value, {
          x, y: kpiY + 0.08, w: kpiW, h: 0.6,
          fontSize: 18, bold: true, color: WHITE, fontFace: 'Helvetica', align: 'center',
        });
        slide1.addText(k.label, {
          x, y: kpiY + 0.7, w: kpiW, h: 0.35,
          fontSize: 9, color: '94A3B8', fontFace: 'Helvetica', align: 'center',
        });
      });

      slide1.addText(`Generated ${today} · Confidential — Internal Use Only`, {
        x: 0.7, y: 6.8, w: 11.5, h: 0.35,
        fontSize: 8, color: '475569', fontFace: 'Helvetica', italic: true,
      });

      // ─────────────────────────────────────────────────────
      // SLIDE 2 — Deal Overview
      // ─────────────────────────────────────────────────────
      const slide2 = prs.addSlide();
      slide2.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: DARK_BLUE } });
      slide2.addText('Deal Overview', {
        x: 0.4, y: 0.1, w: 10, h: 0.6,
        fontSize: 20, bold: true, color: WHITE, fontFace: 'Helvetica',
      });
      slide2.addText(`${d.name} · ${today}`, {
        x: 10.5, y: 0.25, w: 2.5, h: 0.3,
        fontSize: 8, color: '94A3B8', fontFace: 'Helvetica', align: 'right',
      });

      const section = (slide, title, x, y, w, h, items) => {
        slide.addShape(prs.ShapeType.rect, {
          x, y, w, h, fill: { color: LIGHT_GRAY }, radius: 4,
        });
        slide.addText(title, {
          x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.3,
          fontSize: 10, bold: true, color: DARK_BLUE, fontFace: 'Helvetica',
        });
        slide.addShape(prs.ShapeType.rect, {
          x: x + 0.2, y: y + 0.44, w: w - 0.4, h: 0.02,
          fill: { color: 'CBD5E1' },
        });
        items.forEach((item, idx) => {
          const iy = y + 0.55 + idx * 0.42;
          slide.addText(item.label, {
            x: x + 0.2, y: iy, w: (w - 0.4) * 0.5, h: 0.32,
            fontSize: 9, color: TEXT_MID, fontFace: 'Helvetica',
          });
          slide.addText(item.value, {
            x: x + 0.2 + (w - 0.4) * 0.5, y: iy, w: (w - 0.4) * 0.5, h: 0.32,
            fontSize: 9, bold: true, color: TEXT_DARK, fontFace: 'Helvetica', align: 'right',
          });
        });
      };

      // Property section
      section(slide2, 'Property', 0.3, 1.0, 6.2, 3.0, [
        { label: 'Name',         value: d.property_name || 'N/A' },
        { label: 'City / State', value: [d.city, d.state].filter(Boolean).join(', ') || 'N/A' },
        { label: 'Land Area',    value: d.land_area_sqft ? `${Number(d.land_area_sqft).toLocaleString('en-IN')} sqft` : 'N/A' },
        { label: 'Zoning',       value: d.zoning || 'N/A' },
        { label: 'Survey No.',   value: d.survey_number || 'N/A' },
        { label: 'Owner',        value: d.owner_name || 'N/A' },
      ]);

      // Deal section
      section(slide2, 'Deal', 6.8, 1.0, 6.0, 3.0, [
        { label: 'Asset Class',   value: (d.asset_class || '').replace(/_/g, ' ') || 'N/A' },
        { label: 'Structure',     value: (d.deal_structure || '').replace(/_/g, ' ') || 'N/A' },
        { label: 'Ask Price',     value: cr(d.land_ask_price_cr) },
        { label: 'Negotiated',    value: cr(d.negotiated_price_cr) },
        { label: 'Assigned To',   value: d.assigned_to_name || 'Unassigned' },
        { label: 'RERA',          value: d.rera_number || 'Not filed' },
      ]);

      // DD summary bar
      const ddTotal = parseInt(dd.total_required, 10) || 0;
      const ddDone  = parseInt(dd.completed_required, 10) || 0;
      const ddPct   = ddTotal > 0 ? Math.round((ddDone / ddTotal) * 100) : 0;
      const openBreakers = parseInt(dd.open_deal_breakers, 10) || 0;

      slide2.addText('DD Completion', {
        x: 0.3, y: 4.2, w: 5, h: 0.3, fontSize: 9, bold: true, color: DARK_BLUE, fontFace: 'Helvetica',
      });
      slide2.addShape(prs.ShapeType.rect, { x: 0.3, y: 4.55, w: 6.2, h: 0.3, fill: { color: 'E2E8F0' }, radius: 4 });
      if (ddPct > 0) {
        slide2.addShape(prs.ShapeType.rect, {
          x: 0.3, y: 4.55, w: 6.2 * ddPct / 100, h: 0.3,
          fill: { color: openBreakers > 0 ? 'DC2626' : '16A34A' }, radius: 4,
        });
      }
      slide2.addText(`${ddDone}/${ddTotal} required items · ${openBreakers} deal-breaker(s) open`, {
        x: 0.3, y: 4.9, w: 10, h: 0.3, fontSize: 8, color: TEXT_MID, fontFace: 'Helvetica',
      });

      // ─────────────────────────────────────────────────────
      // SLIDE 3 — Financial Summary with Charts
      // ─────────────────────────────────────────────────────
      const slide3 = prs.addSlide();
      slide3.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: DARK_BLUE } });
      slide3.addText('Financial Summary', {
        x: 0.4, y: 0.1, w: 10, h: 0.6,
        fontSize: 20, bold: true, color: WHITE, fontFace: 'Helvetica',
      });

      // KPI cards — top row
      const finKpis = [
        { label: 'Land Cost',     value: cr(d.land_cost_cr) },
        { label: 'Total Cost',    value: cr(d.total_cost_cr) },
        { label: 'Total Revenue', value: cr(d.total_revenue_cr) },
        { label: 'Gross Profit',  value: cr(d.gross_profit_cr) },
      ];
      finKpis.forEach((k, i) => {
        const x = 0.3 + i * 3.2;
        slide3.addShape(prs.ShapeType.rect, {
          x, y: 1.0, w: 3.0, h: 1.0,
          fill: { color: LIGHT_GRAY }, radius: 4,
        });
        slide3.addText(k.value, {
          x, y: 1.1, w: 3.0, h: 0.5,
          fontSize: 16, bold: true, color: ACCENT, fontFace: 'Helvetica', align: 'center',
        });
        slide3.addText(k.label, {
          x, y: 1.65, w: 3.0, h: 0.25,
          fontSize: 8, color: TEXT_MID, fontFace: 'Helvetica', align: 'center',
        });
      });

      // Returns KPI row
      const retKpis = [
        { label: 'IRR',            value: pct(d.irr_pct) },
        { label: 'Gross Margin',   value: pct(d.gross_margin_pct) },
        { label: 'NPV',            value: cr(d.npv_cr) },
        { label: 'Equity Multiple',value: d.equity_multiple ? `${fmt(d.equity_multiple)}x` : 'N/A' },
      ];
      retKpis.forEach((k, i) => {
        const x = 0.3 + i * 3.2;
        slide3.addShape(prs.ShapeType.rect, {
          x, y: 2.15, w: 3.0, h: 1.0,
          fill: { color: '1E3A5F' }, radius: 4,
        });
        slide3.addText(k.value, {
          x, y: 2.25, w: 3.0, h: 0.5,
          fontSize: 16, bold: true, color: '93C5FD', fontFace: 'Helvetica', align: 'center',
        });
        slide3.addText(k.label, {
          x, y: 2.8, w: 3.0, h: 0.25,
          fontSize: 8, color: '94A3B8', fontFace: 'Helvetica', align: 'center',
        });
      });

      // Cost waterfall bar chart
      const hasFinancials = d.total_cost_cr != null && d.total_revenue_cr != null;
      if (hasFinancials) {
        const landCost   = parseFloat(d.land_cost_cr) || 0;
        const constrCost = parseFloat(d.construction_cost_cr) || 0;
        const otherCost  = [
          d.approval_cost_cr,
          d.marketing_cost_cr,
          d.finance_cost_cr,
          d.gst_cost_cr,
          d.stamp_duty_cr,
        ].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
        const revenue    = parseFloat(d.total_revenue_cr) || 0;
        const maxChartValue = Math.max(revenue, landCost + constrCost + otherCost);

        slide3.addChart(prs.ChartType.bar, [
          {
            name: 'Cost Components vs Revenue (₹ Cr)',
            labels: ['Land Cost', 'Construction', 'Other Costs', 'Revenue'],
            values: [landCost, constrCost, otherCost, revenue],
          },
        ], {
          x: 0.3, y: 3.25, w: 7.5, h: 3.8,
          barDir: 'col',
          chartColors: ['2563EB', '3B82F6', '93C5FD', '16A34A'],
          showValue: true,
          dataLabelFontSize: 9,
          valAxisMaxVal: Math.ceil(maxChartValue * 1.1),
          catAxisLabelFontSize: 9,
          valAxisLabelFontSize: 9,
          legendPos: 'b',
          legendFontSize: 9,
          title: 'Cost Components vs Revenue (₹ Cr)',
          titleFontSize: 10,
        });

        // Margin donut
        const marginPct = Math.max(0, Math.min(100, parseFloat(d.gross_margin_pct) || 0));
        slide3.addChart(prs.ChartType.doughnut, [
          {
            name: 'Margin',
            labels: ['Gross Profit', 'Total Cost'],
            values: [marginPct, 100 - marginPct],
          },
        ], {
          x: 8.0, y: 3.25, w: 5.1, h: 3.8,
          chartColors: ['16A34A', 'E2E8F0'],
          holeSize: 60,
          showLabel: false,
          showPercent: true,
          dataLabelFontSize: 11,
          legendPos: 'b',
          legendFontSize: 9,
          title: 'Gross Margin',
          titleFontSize: 10,
        });
      } else {
        slide3.addText('Financial model not yet configured for this deal.', {
          x: 0.3, y: 3.5, w: 12.7, h: 0.5,
          fontSize: 11, color: TEXT_MID, fontFace: 'Helvetica', italic: true, align: 'center',
        });
      }

      // ─────────────────────────────────────────────────────
      // SLIDE 3b — Areas & Assumptions (only if financial model exists)
      // ─────────────────────────────────────────────────────
      if (hasFinancials) {
        const slideA = prs.addSlide();
        slideA.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: DARK_BLUE } });
        slideA.addText('Areas & Underwriting Assumptions', {
          x: 0.4, y: 0.1, w: 12, h: 0.6,
          fontSize: 20, bold: true, color: WHITE, fontFace: 'Helvetica',
        });

        // Areas bar chart
        const plotSqft     = parseFloat(d.plot_area_sqft || d.land_area_sqft) || 0;
        const grossSqft    = parseFloat(d.gross_area_sqft) || (plotSqft * (parseFloat(d.fsi) || 0));
        const saleableSqft = parseFloat(d.saleable_area_sqft) || 0;
        const carpetSqft   = parseFloat(d.carpet_area_sqft) || 0;

        if (plotSqft || grossSqft || saleableSqft) {
          slideA.addChart(prs.ChartType.bar, [{
            name: 'Area (sqft)',
            labels: ['Plot (Land)', 'Gross FAR', 'Saleable (Super)', 'Carpet'],
            values: [plotSqft, grossSqft, saleableSqft, carpetSqft],
          }], {
            x: 0.3, y: 1.05, w: 7.5, h: 3.0,
            barDir: 'bar',
            chartColors: ['0F766E', '0284C7', '2563EB', '7C3AED'],
            showValue: true,
            dataLabelFontSize: 9,
            catAxisLabelFontSize: 9,
            valAxisLabelFontSize: 9,
            legendPos: 'none',
            title: 'Area Breakdown (sqft)',
            titleFontSize: 10,
          });
        }

        // Input assumptions table
        const inputRows = [
          [{ text: 'Parameter', options: { bold: true, color: WHITE, fill: { color: DARK_BLUE } } },
           { text: 'Value',     options: { bold: true, color: WHITE, fill: { color: DARK_BLUE }, align: 'right' } }],
          ['Plot Area',              plotSqft ? `${plotSqft.toLocaleString('en-IN')} sqft` : 'N/A'],
          ['FSI',                    d.fsi != null ? fmt(d.fsi) : 'N/A'],
          ['Loading Factor',         d.loading_factor != null ? `${(parseFloat(d.loading_factor) * 100).toFixed(1)}%` : 'N/A'],
          ['Construction Cost',      d.construction_cost_per_sqft ? `₹${fmt(d.construction_cost_per_sqft)}/sqft` : 'N/A'],
          ['Selling Rate',           d.selling_rate_per_sqft ? `₹${fmt(d.selling_rate_per_sqft)}/sqft` : 'N/A'],
          ['Project Duration',       d.project_duration_months ? `${(d.project_duration_months / 12).toFixed(1)} years` : 'N/A'],
          ['Discount Rate',          d.discount_rate_pct != null ? `${fmt(d.discount_rate_pct)}%` : 'N/A'],
          ['Developer Margin',       d.developer_margin_pct != null ? `${fmt(d.developer_margin_pct)}%` : 'N/A'],
        ].map((row, i) => i === 0 ? row : [
          { text: row[0], options: { fontSize: 10, fill: { color: i % 2 === 0 ? 'F8FAFC' : WHITE } } },
          { text: row[1], options: { fontSize: 10, bold: true, align: 'right', fill: { color: i % 2 === 0 ? 'F8FAFC' : WHITE } } },
        ]);
        slideA.addTable(inputRows, {
          x: 8.0, y: 1.05, w: 5.1,
          fontFace: 'Helvetica',
          colW: [3.0, 2.1],
          border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
          rowH: 0.38,
        });

        // Area insight callout
        const loadingPct = d.loading_factor != null ? (parseFloat(d.loading_factor) * 100).toFixed(1) : null;
        const efficiencyPct = grossSqft > 0 && carpetSqft > 0 ? ((carpetSqft / saleableSqft) * 100).toFixed(1) : null;
        slideA.addShape(prs.ShapeType.rect, {
          x: 0.3, y: 4.3, w: 12.7, h: 2.6, fill: { color: 'F1F5F9' }, radius: 6,
        });
        slideA.addText('Area Efficiency Insight', {
          x: 0.5, y: 4.4, w: 12, h: 0.35,
          fontSize: 11, bold: true, color: DARK_BLUE, fontFace: 'Helvetica',
        });
        const insight = [
          plotSqft ? `Plot area: ${plotSqft.toLocaleString('en-IN')} sqft × FSI ${fmt(d.fsi)} = ${Math.round(grossSqft).toLocaleString('en-IN')} sqft of FAR area.` : null,
          loadingPct ? `With ${loadingPct}% loading for balconies and common areas, saleable super built-up = ${Math.round(saleableSqft).toLocaleString('en-IN')} sqft.` : null,
          efficiencyPct ? `Carpet efficiency ratio is ${efficiencyPct}% (carpet / saleable), industry benchmark 65–75%.` : null,
          d.selling_rate_per_sqft && saleableSqft ? `At ₹${Number(d.selling_rate_per_sqft).toLocaleString('en-IN')}/sqft, gross sales potential = ₹${(saleableSqft * parseFloat(d.selling_rate_per_sqft) / 1e7).toFixed(2)} Cr.` : null,
        ].filter(Boolean).join('\n\n');
        slideA.addText(insight || 'Insufficient data for insight generation.', {
          x: 0.5, y: 4.8, w: 12.3, h: 2.0,
          fontSize: 10, color: TEXT_DARK, fontFace: 'Helvetica', valign: 'top', wrap: true,
        });
      }

      // ─────────────────────────────────────────────────────
      // SLIDE 3c — Cash Flows (if model exists)
      // ─────────────────────────────────────────────────────
      let cashFlowSeries = null;
      try {
        const raw = d.cash_flows;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed?.yearly?.length) cashFlowSeries = parsed.yearly;
        else if (Array.isArray(parsed?.quarterly) && parsed.quarterly.length) cashFlowSeries = parsed.quarterly;
        else if (Array.isArray(parsed)) cashFlowSeries = parsed;
      } catch { /* ignore */ }

      if (cashFlowSeries && cashFlowSeries.length >= 2) {
        const slideCF = prs.addSlide();
        slideCF.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: DARK_BLUE } });
        slideCF.addText('Projected Cash Flows', {
          x: 0.4, y: 0.1, w: 12, h: 0.6,
          fontSize: 20, bold: true, color: WHITE, fontFace: 'Helvetica',
        });

        const labels = cashFlowSeries.map((cf, i) => cf.label || (cf.year != null ? `Y${cf.year}` : `Q${cf.quarter ?? i}`));
        const values = cashFlowSeries.map((cf) => Number(cf.net ?? cf) || 0);

        slideCF.addChart(prs.ChartType.bar, [{
          name: 'Net Cash Flow (₹ Cr)',
          labels,
          values,
        }], {
          x: 0.3, y: 1.05, w: 12.8, h: 4.2,
          barDir: 'col',
          chartColors: ['2563EB'],
          showValue: true,
          dataLabelFontSize: 8,
          catAxisLabelFontSize: 9,
          valAxisLabelFontSize: 9,
          legendPos: 'none',
          title: 'Unlevered Cash Flow Profile (₹ Cr)',
          titleFontSize: 11,
        });

        // Cumulative line below
        const cumulative = values.reduce((acc, v, i) => {
          acc.push((acc[i - 1] || 0) + v);
          return acc;
        }, []);
        const totalIn  = values.filter((v) => v > 0).reduce((a, b) => a + b, 0);
        const totalOut = Math.abs(values.filter((v) => v < 0).reduce((a, b) => a + b, 0));
        const netTotal = totalIn - totalOut;

        slideCF.addText(
          `Total inflow: ₹${fmt(totalIn)} Cr  ·  Total outflow: ₹${fmt(totalOut)} Cr  ·  Net: ₹${fmt(netTotal)} Cr  ·  Peak deployment: ₹${fmt(Math.min(...cumulative))} Cr`,
          { x: 0.3, y: 5.4, w: 12.8, h: 0.4, fontSize: 10, color: TEXT_DARK, fontFace: 'Helvetica', align: 'center', bold: true }
        );

        slideCF.addText(
          'Cash flow phasing reflects land + approvals upfront, construction (S-curve), sales collection tied to construction milestones, and final handover. Quarterly granularity used in underwriting; yearly view shown here for readability.',
          { x: 0.6, y: 5.9, w: 12.2, h: 1.3, fontSize: 10, color: TEXT_MID, fontFace: 'Helvetica', italic: true, wrap: true, valign: 'top' }
        );
      }

      // ─────────────────────────────────────────────────────
      // SLIDE 4 — Market Comps (if available)
      // ─────────────────────────────────────────────────────
      if (compsResult.rows.length > 0) {
        const slide4 = prs.addSlide();
        slide4.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: DARK_BLUE } });
        slide4.addText(`Market Comps · ${d.city || 'Bengaluru'}`, {
          x: 0.4, y: 0.1, w: 12, h: 0.6,
          fontSize: 20, bold: true, color: WHITE, fontFace: 'Helvetica',
        });

        // Comps table
        const tableRows = [
          [
            { text: 'Project', options: { bold: true, color: WHITE, fill: { color: DARK_BLUE } } },
            { text: 'Type',    options: { bold: true, color: WHITE, fill: { color: DARK_BLUE } } },
            { text: 'Rate/sqft (₹)', options: { bold: true, color: WHITE, fill: { color: DARK_BLUE } } },
          ],
          ...compsResult.rows.map((c, i) => [
            { text: c.project_name || '—', options: { fill: { color: i % 2 === 0 ? WHITE : 'F8FAFC' } } },
            { text: c.project_type || '—', options: { fill: { color: i % 2 === 0 ? WHITE : 'F8FAFC' } } },
            {
              text: c.rate_per_sqft ? `₹${Number(c.rate_per_sqft).toLocaleString('en-IN')}` : '—',
              options: { bold: true, align: 'right', fill: { color: i % 2 === 0 ? WHITE : 'F8FAFC' } },
            },
          ]),
        ];

        slide4.addTable(tableRows, {
          x: 0.4, y: 1.1, w: 12.2,
          fontSize: 10, fontFace: 'Helvetica',
          colW: [6.5, 3.0, 2.7],
          border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
          rowH: 0.45,
          align: 'left',
        });

        // Bar chart of comps rates
        if (compsResult.rows.length >= 2) {
          slide4.addChart(prs.ChartType.bar, [
            {
              name: 'Rate per sqft (₹)',
              labels: compsResult.rows.map((c) => (c.project_name || '').slice(0, 18)),
              values: compsResult.rows.map((c) => parseFloat(c.rate_per_sqft) || 0),
            },
          ], {
            x: 0.4, y: 4.0, w: 12.2, h: 3.1,
            barDir: 'bar',
            chartColors: [ACCENT],
            showValue: true,
            dataLabelFontSize: 8,
            catAxisLabelFontSize: 8,
            valAxisLabelFontSize: 8,
            legendPos: 'none',
            title: `Comparable Rates (₹/sqft) · ${d.city}`,
            titleFontSize: 10,
          });
        }
      }

      // ─────────────────────────────────────────────────────
      // SLIDE 5 — Risk Summary
      // ─────────────────────────────────────────────────────
      const slide5 = prs.addSlide();
      slide5.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: DARK_BLUE } });
      slide5.addText('Risk Summary', {
        x: 0.4, y: 0.1, w: 10, h: 0.6,
        fontSize: 20, bold: true, color: WHITE, fontFace: 'Helvetica',
      });

      const riskData = [
        { label: 'Critical', count: riskMap.critical || 0, color: 'DC2626' },
        { label: 'High',     count: riskMap.high     || 0, color: 'EA580C' },
        { label: 'Medium',   count: riskMap.medium   || 0, color: 'D97706' },
        { label: 'Low',      count: riskMap.low      || 0, color: '16A34A' },
      ];

      riskData.forEach((r, i) => {
        const x = 0.3 + i * 3.2;
        slide5.addShape(prs.ShapeType.rect, {
          x, y: 1.0, w: 3.0, h: 1.4,
          fill: { color: 'FFF7F7' }, line: { color: r.color, width: 2 }, radius: 4,
        });
        slide5.addText(String(r.count), {
          x, y: 1.1, w: 3.0, h: 0.7,
          fontSize: 36, bold: true, color: r.color, fontFace: 'Helvetica', align: 'center',
        });
        slide5.addText(`${r.label} Risk`, {
          x, y: 1.85, w: 3.0, h: 0.3,
          fontSize: 9, color: TEXT_MID, fontFace: 'Helvetica', align: 'center',
        });
      });

      // Risk donut chart
      const totalRisks = riskData.reduce((s, r) => s + r.count, 0);
      if (totalRisks > 0) {
        slide5.addChart(prs.ChartType.doughnut, [
          {
            name: 'Risk Severity',
            labels: riskData.map((r) => r.label),
            values: riskData.map((r) => r.count),
          },
        ], {
          x: 0.3, y: 2.6, w: 5.5, h: 4.2,
          chartColors: riskData.map((r) => r.color),
          holeSize: 55,
          showLabel: true,
          showPercent: true,
          dataLabelFontSize: 10,
          legendPos: 'b',
          legendFontSize: 9,
          title: 'Open Risks by Severity',
          titleFontSize: 10,
        });
      } else {
        slide5.addText('No open risk flags.', {
          x: 0.3, y: 3.0, w: 6, h: 0.5,
          fontSize: 12, color: '16A34A', bold: true, fontFace: 'Helvetica',
        });
      }

      // Recommendation box
      let recText = 'PROCEED', recColor = '16A34A', recBg = 'F0FDF4';
      if ((riskMap.critical || 0) > 0 || openBreakers > 0) {
        recText = 'REQUIRES REVIEW'; recColor = 'DC2626'; recBg = 'FEF2F2';
      } else if ((riskMap.high || 0) >= 2) {
        recText = 'PROCEED WITH CAUTION'; recColor = 'D97706'; recBg = 'FFFBEB';
      }

      slide5.addShape(prs.ShapeType.rect, {
        x: 6.2, y: 2.6, w: 6.9, h: 2.5,
        fill: { color: recBg }, line: { color: recColor, width: 2 }, radius: 8,
      });
      slide5.addText('IC Recommendation', {
        x: 6.2, y: 2.8, w: 6.9, h: 0.4,
        fontSize: 10, color: TEXT_MID, fontFace: 'Helvetica', align: 'center',
      });
      slide5.addText(recText, {
        x: 6.2, y: 3.25, w: 6.9, h: 0.8,
        fontSize: 22, bold: true, color: recColor, fontFace: 'Helvetica', align: 'center',
      });
      slide5.addText(
        `${(riskMap.critical || 0)} critical · ${(riskMap.high || 0)} high · ${openBreakers} DD deal-breaker(s) open`,
        { x: 6.2, y: 4.1, w: 6.9, h: 0.3, fontSize: 8, color: TEXT_MID, fontFace: 'Helvetica', align: 'center' }
      );

      // ─────────────────────────────────────────────────────
      // SLIDE 6 — Disclaimer
      // ─────────────────────────────────────────────────────
      const slide6 = prs.addSlide();
      slide6.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: LIGHT_GRAY } });
      slide6.addText('Disclaimer', {
        x: 1, y: 1.5, w: 11, h: 0.5,
        fontSize: 18, bold: true, color: DARK_BLUE, fontFace: 'Helvetica',
      });
      slide6.addText(
        'This presentation has been prepared by REDIP for internal investment committee review only. All financial projections are based on current deal assumptions and have not been independently verified. Values are in Indian Rupees (Crore) unless otherwise stated. Past performance is not indicative of future results. This document does not constitute investment advice. All recipients are bound by applicable confidentiality obligations. Do not distribute without prior written consent.',
        {
          x: 1, y: 2.2, w: 11, h: 3,
          fontSize: 11, color: TEXT_MID, fontFace: 'Helvetica', valign: 'top', wrap: true,
        }
      );
      slide6.addText(`Generated by REDIP · ${today} · For Internal Use Only`, {
        x: 1, y: 6.5, w: 11, h: 0.35,
        fontSize: 9, color: '94A3B8', fontFace: 'Helvetica', align: 'center', italic: true,
      });

      // ─── Stream PPTX ─────────────────────────────────────────────────────────
      const safeName = (d.name || 'deal').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const fileName = `redip-${safeName}-${new Date().toISOString().slice(0, 10)}.pptx`;

      const pptxBuffer = await prs.write({ outputType: 'nodebuffer' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(pptxBuffer);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
