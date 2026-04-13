const express = require('express');
const { query: qv, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const XLSX = require('xlsx');
const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');

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

      const drawText = (text, x, yPos, opts = {}) => {
        const { size = 10, isBold = false, color = rgb(0.1, 0.1, 0.1) } = opts;
        page.drawText(String(text ?? '—'), { x, y: yPos, size, font: isBold ? boldFont : font, color });
      };

      const drawLine = (yPos) => {
        page.drawLine({ start: { x: margin, y: yPos }, end: { x: width - margin, y: yPos }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
      };

      const fmt = (v, suffix = '') => (v != null && v !== '' ? `${Number(v).toFixed(2)}${suffix}` : '—');

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

module.exports = router;
