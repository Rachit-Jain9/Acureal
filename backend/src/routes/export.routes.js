const express = require('express');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');
const { query: qv } = require('express-validator');
const { handleValidation } = require('../middleware/validate');
const {
  DEAL_STAGES,
  DEAL_TYPES,
  PROPERTY_TYPES,
  normalizePropertyType,
} = require('../constants/domain');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { getDealExportContext } = require('../services/dealExport.service');
const dealService = require('../services/deal.service');
const compsService = require('../services/comps.service');
const { buildDealDeckPptx } = require('../services/dealPptx.service');
const { buildDealWorkbookXlsx } = require('../services/dealXlsx.service');
const { buildDealWorkbookV2 } = require('../services/exports/xlsx/v2/buildWorkbook');
const { buildDealReportDocx } = require('../services/exports/docx/buildReport');
const { buildReraReadinessDocx } = require('../services/exports/docx/buildReraReadiness');
const { composeReadiness } = require('../services/karnatakaReraReadiness.service');
const { buildReraContext } = require('../services/rera/complianceContext');
const { composeReraConsistency } = require('../services/rera/consistency');
const { composeComplianceCalendar } = require('../services/rera/complianceCalendar');
const signoffService = require('../services/signoff.service');
const { buildIcReadinessDocx } = require('../services/exports/docx/buildIcReadiness');
const { getDealWorkspace } = require('../services/dealWorkspace.service');
const { composePack } = require('../services/exports/reportPack/composePack');
const { buildReportPackDocx } = require('../services/exports/docx/buildReportPackDocx');
const { isAudience } = require('../constants/reportPackCatalog');
const approvalsService = require('../services/approvals.service');
const documentService = require('../services/document.service');
const { buildIntelligenceTearSheet } = require('../services/intelligenceExport.service');
const { buildDealTearSheet } = require('../services/dealTearSheet.service');

const router = express.Router();

const escapeCsvField = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toCsvRow = (fields) => fields.map(escapeCsvField).join(',');

const DEALS_XLSX_COLUMNS = [
  'Deal Name',
  'Type',
  'Stage',
  'Priority',
  'Asset Class',
  'Property',
  'City',
  'State',
  'Land Area (sqft)',
  'Ask Price (Cr)',
  'Negotiated Price (Cr)',
  'Revenue (Cr)',
  'Total Cost (Cr)',
  'Gross Profit (Cr)',
  'Margin %',
  'IRR %',
  'NPV (Cr)',
  'Equity Multiple',
  'RLV (Cr)',
  'Assigned To',
  'Created',
  'Updated',
];

const COMPS_XLSX_COLUMNS = [
  'Project',
  'Developer',
  'City',
  'Locality',
  'Type',
  'BHK Config',
  'Carpet (sqft)',
  'Super Built-up (sqft)',
  'Rate/sqft (₹)',
  'Total Units',
  'Launch Year',
  'Possession Year',
  'RERA',
  'Source',
];

const addJsonWorksheet = (workbook, name, columns, rows = []) => {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns.map((header) => ({
    header,
    key: header,
    width: Math.min(Math.max(String(header).length + 4, 14), 28),
  }));
  rows.forEach((row) => worksheet.addRow(row));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: 'middle' };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: 'A1',
    to: `${worksheet.getColumn(columns.length).letter}1`,
  };
  return worksheet;
};

// GET /exports/deals — retired; use per-deal CSV/XLSX/PPTX/PDF exports
router.get(
  '/deals',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res) => {
    res.status(410).json({
      success: false,
      message: 'JSON pipeline exports have been retired. Use per-deal PDF, PPTX, XLSX, or CSV exports instead.',
    });
  }
);

// GET /exports/deals/csv — filtered deals list as CSV.
//
// Accepts the same query params as GET /deals so an analyst can save
// a view, then export exactly that view's rows: status + asset class +
// city + my-deals etc. The filter combination is plumbed through
// `dealService.getDeals` so the visibility rules (organization scope +
// archived / dead / share-with-me) match the in-app list exactly.
//
// Single-sheet, plain-CSV output. For the rich multi-sheet workbook,
// callers want /exports/deals/xlsx (which doesn't yet take filters —
// follow-up).
router.get(
  '/deals/csv',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    qv('stage').optional().isIn(DEAL_STAGES),
    qv('dealType').optional().isIn(DEAL_TYPES),
    qv('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    qv('city').optional().trim(),
    qv('propertyType').optional().customSanitizer(normalizePropertyType).isIn(PROPERTY_TYPES),
    qv('search').optional().trim(),
    qv('includeArchived').optional().isBoolean().toBoolean(),
    qv('onlyArchived').optional().isBoolean().toBoolean(),
    qv('liveOnly').optional().isBoolean().toBoolean(),
    qv('assignedToMe').optional().isBoolean().toBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const assignedTo =
        req.query.assignedTo ||
        (req.query.assignedToMe ? req.user.id : undefined);
      const filters = {
        stage: req.query.stage,
        dealType: req.query.dealType,
        assignedTo,
        city: req.query.city,
        propertyType: req.query.propertyType,
        search: req.query.search,
        priority: req.query.priority,
        includeArchived: req.query.includeArchived,
        onlyArchived: req.query.onlyArchived,
        liveOnly: req.query.liveOnly,
      };
      // Cap at 5000 rows to keep the response time + memory predictable
      // — far above any realistic filter combination but a real ceiling
      // if someone export-spams the unfiltered list.
      const result = await dealService.getDeals(filters, { page: 1, limit: 5000 });
      const rows = result?.data || [];

      // Stable column order — matches what the user sees on the Deals
      // page so the CSV is recognisable. Numeric values land as raw
      // numbers (no currency suffix) so analysts can pivot them in
      // Sheets without text-cleaning.
      const headers = [
        'Deal Name', 'Type', 'Stage', 'Priority', 'Asset Class', 'Structure',
        'Property', 'City', 'State', 'Property Type',
        'Land Area (sqft)', 'Ask Price (Cr)', 'Negotiated Price (Cr)',
        'Revenue (Cr)', 'Total Cost (Cr)', 'Gross Profit (Cr)', 'Margin %',
        'IRR %', 'NPV (Cr)', 'Equity Multiple', 'RLV (Cr)',
        'Assigned To', 'RERA', 'Archived', 'Created', 'Updated',
      ];

      const fmtDate = (d) => {
        if (!d) return '';
        try {
          return new Date(d).toISOString().slice(0, 10);
        } catch {
          return '';
        }
      };
      const num = (v) => (v == null || v === '' ? '' : Number(v));

      const csvLines = [toCsvRow(headers)];
      for (const r of rows) {
        csvLines.push(toCsvRow([
          r.name, r.deal_type, r.stage, r.priority, r.asset_class, r.deal_structure,
          r.property_name || '', r.city || '', r.state || '', r.property_type || '',
          num(r.land_area_sqft),
          num(r.land_ask_price_cr),
          num(r.negotiated_price_cr),
          num(r.total_revenue_cr),
          num(r.total_cost_cr),
          num(r.gross_profit_cr),
          num(r.gross_margin_pct),
          num(r.irr_pct),
          num(r.npv_cr),
          num(r.equity_multiple),
          num(r.residual_land_value_cr),
          r.assigned_to_name || '',
          r.rera_number || '',
          r.is_archived ? 'yes' : 'no',
          fmtDate(r.created_at),
          fmtDate(r.updated_at),
        ]));
      }
      const csv = csvLines.join('\n');

      const today = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="redip-deals-${today}.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  },
);

// GET /exports/comps — verified-comps database as CSV.
//
// Accepts the same query params as GET /comps so the export respects
// the page's current filter combination — city + locality +
// projectType + rate band + launchYear + search. The list itself is
// org-scoped via RLS; the same scope flows through here.
//
// Backed by `compsService.getCompsForExport` which shares the WHERE
// builder with `getComps` so filter parity is guaranteed without
// duplication.
router.get(
  '/comps',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    qv('city').optional().trim(),
    qv('locality').optional().trim(),
    qv('projectType').optional().isIn(['residential', 'commercial', 'mixed_use']),
    qv('minRate').optional().isFloat({ min: 0 }),
    qv('maxRate').optional().isFloat({ min: 0 }),
    qv('launchYear').optional().isInt({ min: 2000, max: 2050 }),
    qv('search').optional().trim(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const filters = {
        city: req.query.city,
        locality: req.query.locality,
        projectType: req.query.projectType,
        minRate: req.query.minRate,
        maxRate: req.query.maxRate,
        launchYear: req.query.launchYear,
        search: req.query.search,
      };
      const rows = await compsService.getCompsForExport(filters, { maxRows: 5000 });

      const headers = [
        'Project', 'Developer', 'City', 'Locality', 'Type',
        'BHK', 'Carpet (sqft)', 'Super Built-up (sqft)',
        'Rate/sqft', 'Min Rate', 'Max Rate', 'Units',
        'Launch Year', 'Possession Year',
        'RERA', 'Verified', 'Source', 'Added',
      ];

      const fmtDate = (d) => {
        if (!d) return '';
        try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
      };

      const dataRows = rows.map((r) =>
        toCsvRow([
          r.project_name, r.developer, r.city, r.locality, r.project_type,
          r.bhk_config, r.carpet_area_sqft, r.super_builtup_area_sqft,
          r.rate_per_sqft, r.rate_per_sqft_min, r.rate_per_sqft_max,
          r.total_units, r.launch_year, r.possession_year,
          r.rera_number, r.is_verified ? 'yes' : 'no', r.source,
          fmtDate(r.created_at),
        ])
      );

      const csv = [toCsvRow(headers), ...dataRows].join('\n');
      const today = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="redip-comps-${today}.csv"`);
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
      {
      // PR-NX69 (2026-05-19) — pass userId + userRole so the AI augment
      // layer can enforce the BETA 1-free-report-per-user quota.
      // Admin/owner roles get unlimited.
      const exportContext = await getDealExportContext(req.params.dealId, {
        userId: req.user?.id || null,
        userRole: req.user?.role || null,
      });
      if (!exportContext) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      const d = exportContext.deal;
      const ddSummary = exportContext.dd.summary;
      const riskSummary = exportContext.risks.summary;
      const recommendation = exportContext.risks.recommendation;
      const benchmarkSummary = exportContext.market.benchmarks;
      const cashSeries = exportContext.cashFlows.yearly.length
        ? exportContext.cashFlows.yearly.slice(0, 8)
        : exportContext.cashFlows.quarterly.slice(0, 12);
      const compRows = exportContext.market.exportComps.slice(0, 6);
      const pendingDdRows = exportContext.dd.items
        .filter((item) => !['completed', 'not_applicable'].includes(item.status))
        .slice(0, 3);
      const aiOpinion =
        exportContext.ai.available && exportContext.ai.ic_opinion
          ? exportContext.ai.ic_opinion
          : `${recommendation.label}: ${recommendation.reason}`;
      const aiNextSteps =
        exportContext.ai.available && exportContext.ai.next_steps.length
          ? exportContext.ai.next_steps.slice(0, 3)
          : [
              'Close open deal-breaker diligence items before Investor-Grade review.',
              'Refresh verified comps and validate pricing assumptions.',
              'Re-run downside sensitivity before any investment call.',
            ];
      const aiTopRisks =
        exportContext.ai.available && exportContext.ai.top_risks.length
          ? exportContext.ai.top_risks.slice(0, 3)
          : exportContext.risks.items.slice(0, 3).map((risk) => ({
              title: risk.title || 'Open risk flag',
              detail: risk.description || 'Review the flagged issue before advancing the deal.',
              severity: risk.severity || 'medium',
            }));

      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const PAGE = [PageSizes.A4[1], PageSizes.A4[0]];
      const COLORS = {
        navy: rgb(0.06, 0.13, 0.27),
        accent: rgb(0.15, 0.39, 0.92),
        slate900: rgb(0.12, 0.16, 0.22),
        slate700: rgb(0.27, 0.33, 0.4),
        slate500: rgb(0.45, 0.5, 0.58),
        slate200: rgb(0.89, 0.91, 0.94),
        slate100: rgb(0.96, 0.97, 0.98),
        white: rgb(1, 1, 1),
        green: rgb(0.09, 0.64, 0.37),
        amber: rgb(0.85, 0.52, 0.07),
        red: rgb(0.86, 0.19, 0.19),
        blue: rgb(0.03, 0.52, 0.78),
      };

      const addPage = () => pdfDoc.addPage(PAGE);
      const safeText = (value) =>
        String(value ?? 'N/A')
          .replace(/[^\x20-\x7E\n]/g, ' ')
          .replace(/\s+\n/g, '\n')
          .replace(/\s{2,}/g, ' ')
          .trim() || 'N/A';
      const humanize = (value) =>
        String(value || '')
          .replace(/_/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\b\w/g, (match) => match.toUpperCase());
      const formatNumber = (value, decimals = 2) => {
        if (value === null || value === undefined || value === '') return 'N/A';
        return Number(value).toLocaleString('en-IN', {
          minimumFractionDigits: 0,
          maximumFractionDigits: decimals,
        });
      };
      const formatCr = (value) =>
        value === null || value === undefined || value === '' ? 'N/A' : `INR ${formatNumber(value)} Cr`;
      const formatPct = (value) =>
        value === null || value === undefined || value === '' ? 'N/A' : `${formatNumber(value)}%`;
      const formatRate = (value) =>
        value === null || value === undefined || value === '' ? 'N/A' : `INR ${formatNumber(value, 0)} / sqft`;
      const formatArea = (value) =>
        value === null || value === undefined || value === '' ? 'N/A' : `${formatNumber(value, 0)} sqft`;

      const wrapText = (text, selectedFont, size, maxWidth, maxLines = Infinity) => {
        const paragraphs = safeText(text).split('\n');
        const lines = [];
        for (const paragraph of paragraphs) {
          if (!paragraph) {
            lines.push('');
            continue;
          }
          let current = '';
          for (const word of paragraph.split(' ')) {
            const candidate = current ? `${current} ${word}` : word;
            if (selectedFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
              current = candidate;
            } else {
              if (current) lines.push(current);
              current = word;
            }
            if (lines.length >= maxLines) break;
          }
          if (current && lines.length < maxLines) lines.push(current);
          if (lines.length >= maxLines) break;
        }
        return lines.slice(0, maxLines);
      };

      const drawWrappedText = (page, text, options) => {
        const {
          x,
          y,
          width,
          size = 10,
          lineHeight = size + 3,
          color = COLORS.slate900,
          isBold = false,
          maxLines = Infinity,
        } = options;
        const selectedFont = isBold ? boldFont : font;
        const lines = wrapText(text, selectedFont, size, width, maxLines);
        lines.forEach((line, index) => {
          page.drawText(line || ' ', {
            x,
            y: y - index * lineHeight,
            size,
            font: selectedFont,
            color,
          });
        });
      };

      const drawHeader = (page, title, subtitle) => {
        const { width, height } = page.getSize();
        page.drawRectangle({ x: 0, y: height - 56, width, height: 56, color: COLORS.navy });
        page.drawText('REDIP', {
          x: 34,
          y: height - 34,
          size: 16,
          font: boldFont,
          color: COLORS.white,
        });
        page.drawText(title, {
          x: 118,
          y: height - 34,
          size: 14,
          font: boldFont,
          color: COLORS.white,
        });
        page.drawText(subtitle, {
          x: 118,
          y: height - 47,
          size: 8,
          font,
          color: rgb(0.76, 0.84, 0.95),
        });
      };

      const drawFooter = (page, text) => {
        const { width } = page.getSize();
        page.drawText(safeText(text), {
          x: 34,
          y: 18,
          size: 7,
          font,
          color: COLORS.slate500,
        });
        page.drawText(`Generated by ${safeText(req.user.name)} on ${new Date().toLocaleDateString('en-IN')}`, {
          x: width - 230,
          y: 18,
          size: 7,
          font,
          color: COLORS.slate500,
        });
      };

      const drawPanel = (page, { x, y, w, h, title, fill = COLORS.white }) => {
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: fill,
          borderColor: COLORS.slate200,
          borderWidth: 1,
        });
        page.drawText(title, {
          x: x + 14,
          y: y + h - 20,
          size: 11,
          font: boldFont,
          color: COLORS.navy,
        });
      };

      const drawMetricCard = (page, { x, y, w, h, label, value, tone = 'accent' }) => {
        const toneColor =
          tone === 'positive' ? COLORS.green : tone === 'negative' ? COLORS.red : tone === 'warning' ? COLORS.amber : COLORS.accent;
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: COLORS.white,
          borderColor: COLORS.slate200,
          borderWidth: 1,
        });
        page.drawRectangle({ x, y: y + h - 5, width: w, height: 5, color: toneColor });
        page.drawText(safeText(value), {
          x: x + 12,
          y: y + h - 28,
          size: 15,
          font: boldFont,
          color: COLORS.slate900,
        });
        page.drawText(safeText(label), {
          x: x + 12,
          y: y + 12,
          size: 8,
          font,
          color: COLORS.slate500,
        });
      };

      const drawKeyValueList = (page, { x, y, w, rows, rowGap = 16, labelWidth = 112 }) => {
        rows.forEach((row, index) => {
          const yPos = y - index * rowGap;
          page.drawText(`${safeText(row.label)}:`, {
            x,
            y: yPos,
            size: 8.5,
            font: boldFont,
            color: COLORS.slate700,
          });
          drawWrappedText(page, row.value, {
            x: x + labelWidth,
            y: yPos,
            width: w - labelWidth,
            size: 8.5,
            lineHeight: 11,
            color: COLORS.slate900,
            maxLines: 2,
          });
        });
      };

      const drawHorizontalBars = (page, { x, y, w, h, title, items, formatter }) => {
        drawPanel(page, { x, y, w, h, title, fill: COLORS.white });
        const maxValue = Math.max(1, ...items.map((item) => Number(item.value || 0)));
        const rowHeight = Math.min(26, (h - 46) / Math.max(items.length, 1));
        items.forEach((item, index) => {
          const rowY = y + h - 42 - (index + 1) * rowHeight;
          const baseX = x + 16;
          const chartWidth = w - 40;
          const barWidth = (chartWidth - 128) * (Number(item.value || 0) / maxValue);
          page.drawText(safeText(item.label), {
            x: baseX,
            y: rowY + 7,
            size: 8,
            font,
            color: COLORS.slate700,
          });
          page.drawRectangle({
            x: baseX + 88,
            y: rowY + 6,
            width: chartWidth - 128,
            height: 10,
            color: COLORS.slate100,
          });
          page.drawRectangle({
            x: baseX + 88,
            y: rowY + 6,
            width: Math.max(barWidth, 1),
            height: 10,
            color: item.color || COLORS.accent,
          });
          page.drawText(safeText(formatter(item.value)), {
            x: baseX + chartWidth - 34,
            y: rowY + 7,
            size: 8,
            font: boldFont,
            color: COLORS.slate900,
          });
        });
      };

      const drawCashFlowChart = (page, { x, y, w, h, rows }) => {
        drawPanel(page, { x, y, w, h, title: 'Projected Cash Flow Profile', fill: COLORS.white });
        const chartX = x + 18;
        const chartY = y + 28;
        const chartW = w - 36;
        const chartH = h - 56;
        const values = rows.map((row) => Number(row.net || 0));
        const maxPositive = Math.max(0, ...values);
        const maxNegative = Math.abs(Math.min(0, ...values));
        const totalRange = Math.max(maxPositive + maxNegative, 1);
        const zeroY = chartY + (chartH * maxNegative) / totalRange;
        const barWidth = chartW / Math.max(rows.length * 1.5, 1);

        page.drawLine({
          start: { x: chartX, y: zeroY },
          end: { x: chartX + chartW, y: zeroY },
          thickness: 1,
          color: COLORS.slate500,
        });

        rows.forEach((row, index) => {
          const value = Number(row.net || 0);
          const barHeight = (Math.abs(value) / totalRange) * chartH;
          const barX = chartX + index * barWidth * 1.5 + 6;
          const barY = value >= 0 ? zeroY : zeroY - barHeight;
          page.drawRectangle({
            x: barX,
            y: barY,
            width: barWidth,
            height: Math.max(barHeight, 1),
            color: value >= 0 ? COLORS.green : COLORS.accent,
          });
          page.drawText(safeText((row.label || `P${index + 1}`).slice(0, 10)), {
            x: barX - 2,
            y: chartY - 14,
            size: 7,
            font,
            color: COLORS.slate500,
          });
        });
      };

      const drawTable = (page, { x, y, colWidths, header, rows, rowHeight = 18, fontSize = 8, maxRows = rows.length }) => {
        const totalWidth = colWidths.reduce((sum, value) => sum + value, 0);
        page.drawRectangle({ x, y, width: totalWidth, height: rowHeight, color: COLORS.navy });
        let cursorX = x;
        header.forEach((cell, index) => {
          page.drawText(safeText(cell), {
            x: cursorX + 4,
            y: y + 5,
            size: fontSize,
            font: boldFont,
            color: COLORS.white,
          });
          cursorX += colWidths[index];
        });

        rows.slice(0, maxRows).forEach((row, rowIndex) => {
          const rowY = y - (rowIndex + 1) * rowHeight;
          page.drawRectangle({
            x,
            y: rowY,
            width: totalWidth,
            height: rowHeight,
            color: rowIndex % 2 === 0 ? COLORS.white : COLORS.slate100,
            borderColor: COLORS.slate200,
            borderWidth: 0.5,
          });
          let cellX = x;
          row.forEach((cell, index) => {
            drawWrappedText(page, cell, {
              x: cellX + 4,
              y: rowY + rowHeight - 11,
              width: colWidths[index] - 8,
              size: fontSize,
              lineHeight: fontSize + 1,
              color: COLORS.slate900,
              maxLines: 2,
            });
            cellX += colWidths[index];
          });
        });
      };

      const drawHeatmap = (page, { x, y, w, h, matrix, rowLabels, colLabels, title }) => {
        drawPanel(page, { x, y, w, h, title, fill: COLORS.white });
        const gridX = x + 64;
        const gridY = y + 22;
        const cellW = Math.min(32, (w - 90) / Math.max(colLabels.length, 1));
        const cellH = Math.min(22, (h - 56) / Math.max(rowLabels.length, 1));
        const values = matrix.flat().filter((value) => value !== null && value !== undefined);
        const minValue = values.length ? Math.min(...values) : 0;
        const maxValue = values.length ? Math.max(...values) : 1;
        const range = Math.max(maxValue - minValue, 1);

        colLabels.forEach((label, index) => {
          page.drawText(safeText(label), {
            x: gridX + index * cellW,
            y: y + h - 34,
            size: 7,
            font,
            color: COLORS.slate500,
          });
        });

        rowLabels.forEach((label, rowIndex) => {
          page.drawText(safeText(label), {
            x: x + 10,
            y: gridY + (rowLabels.length - rowIndex - 1) * cellH + 7,
            size: 7,
            font,
            color: COLORS.slate500,
          });
        });

        matrix.forEach((row, rowIndex) => {
          row.forEach((value, colIndex) => {
            const normalized = value === null || value === undefined ? 0.5 : (Number(value) - minValue) / range;
            const fill = rgb(0.93 - normalized * 0.52, 0.97 - normalized * 0.23, 1 - normalized * 0.72);
            const cellX = gridX + colIndex * cellW;
            const cellY = gridY + (rowLabels.length - rowIndex - 1) * cellH;
            page.drawRectangle({
              x: cellX,
              y: cellY,
              width: cellW - 1,
              height: cellH - 1,
              color: fill,
              borderColor: COLORS.white,
              borderWidth: 0.5,
            });
            if (value !== null && value !== undefined) {
              page.drawText(`${formatNumber(value, 1)}%`, {
                x: cellX + 4,
                y: cellY + 6,
                size: 6.5,
                font: boldFont,
                color: COLORS.slate900,
              });
            }
          });
        });
      };

      const page1 = addPage();
      drawHeader(
        page1,
        'Investor Package',
        `${safeText(d.name || 'Unnamed Deal')} | ${humanize(d.stage)} | ${humanize(d.asset_class)}`
      );
      const tone = recommendation.tone === 'positive' ? 'positive' : recommendation.tone === 'negative' ? 'negative' : 'warning';
      drawMetricCard(page1, { x: 34, y: 430, w: 145, h: 54, label: 'IRR', value: formatPct(d.irr_pct), tone });
      drawMetricCard(page1, { x: 191, y: 430, w: 145, h: 54, label: 'NPV', value: formatCr(d.npv_cr), tone });
      drawMetricCard(page1, { x: 348, y: 430, w: 145, h: 54, label: 'Revenue', value: formatCr(d.total_revenue_cr) });
      drawMetricCard(page1, { x: 505, y: 430, w: 145, h: 54, label: 'Total Cost', value: formatCr(d.total_cost_cr) });
      drawMetricCard(page1, { x: 662, y: 430, w: 145, h: 54, label: 'Gross Margin', value: formatPct(d.gross_margin_pct), tone });

      drawPanel(page1, { x: 34, y: 338, w: 773, h: 72, title: 'Decision Frame', fill: COLORS.slate100 });
      page1.drawText(recommendation.label.toUpperCase(), {
        x: 50,
        y: 372,
        size: 16,
        font: boldFont,
        color: tone === 'positive' ? COLORS.green : tone === 'negative' ? COLORS.red : COLORS.amber,
      });
      drawWrappedText(page1, recommendation.reason, {
        x: 240,
        y: 379,
        width: 548,
        size: 9,
        lineHeight: 12,
        color: COLORS.slate700,
        maxLines: 3,
      });
      page1.drawText(
        `DD completion ${formatNumber(ddSummary.completion_pct, 0)}% | ${riskSummary.critical} critical | ${riskSummary.high} high | ${ddSummary.open_deal_breakers} open deal-breakers`,
        {
          x: 50,
          y: 349,
          size: 8,
          font,
          color: COLORS.slate500,
        }
      );

      drawPanel(page1, { x: 34, y: 72, w: 488, h: 248, title: 'AI Investor-Grade View', fill: COLORS.white });
      drawWrappedText(page1, aiOpinion, {
        x: 48,
        y: 286,
        width: 458,
        size: 10,
        lineHeight: 14,
        color: COLORS.slate900,
        maxLines: 8,
      });
      page1.drawText('Recommended next steps', {
        x: 48,
        y: 158,
        size: 9,
        font: boldFont,
        color: COLORS.navy,
      });
      aiNextSteps.forEach((step, index) => {
        drawWrappedText(page1, `- ${step}`, {
          x: 48,
          y: 142 - index * 18,
          width: 454,
          size: 8.5,
          lineHeight: 11,
          color: COLORS.slate700,
          maxLines: 2,
        });
      });

      drawPanel(page1, { x: 540, y: 72, w: 267, h: 248, title: 'Deal Snapshot', fill: COLORS.white });
      drawKeyValueList(page1, {
        x: 554,
        y: 286,
        w: 239,
        rows: [
          { label: 'Property', value: d.property_name || 'N/A' },
          { label: 'Location', value: [d.city, d.state].filter(Boolean).join(', ') || 'N/A' },
          { label: 'Land Area', value: formatArea(d.land_area_sqft) },
          { label: 'Structure', value: humanize(d.deal_structure) || 'N/A' },
          { label: 'Effective Date', value: exportContext.effectiveDate || 'N/A' },
          { label: 'Duration', value: exportContext.durationYears ? `${formatNumber(exportContext.durationYears)} years` : 'N/A' },
          { label: 'Median Benchmark', value: formatRate(benchmarkSummary.median_rate_per_sqft) },
          {
            label: 'Sell Rate Gap',
            value:
              exportContext.market.pricingGapPct === null
                ? 'N/A'
                : `${formatNumber(exportContext.market.pricingGapPct, 1)}% vs benchmark`,
          },
          { label: 'Assigned To', value: d.assigned_to_name || 'Unassigned' },
        ],
      });
      drawFooter(
        page1,
        exportContext.ai.disclaimer ||
          'AI insights are grounded in stored deal data. Verify all facts before any investment decision.'
      );

      const page2 = addPage();
      drawHeader(page2, 'Underwriting and Cash Flows', 'Areas, assumptions, cost stack, and modeled phasing');
      drawPanel(page2, { x: 34, y: 324, w: 240, h: 200, title: 'Area Build-up', fill: COLORS.white });
      drawKeyValueList(page2, {
        x: 48,
        y: 488,
        w: 212,
        rows: [
          { label: 'Plot Area', value: formatArea(d.plot_area_sqft || d.land_area_sqft) },
          { label: 'Gross FAR Area', value: formatArea(d.gross_area_sqft) },
          { label: 'Saleable Area', value: formatArea(d.saleable_area_sqft) },
          { label: 'Carpet Area', value: formatArea(d.carpet_area_sqft) },
          { label: 'FSI', value: formatNumber(d.fsi, 2) },
          {
            label: 'Loading',
            value: d.loading_factor === null || d.loading_factor === undefined ? 'N/A' : `${formatNumber(Number(d.loading_factor) * 100, 1)}%`,
          },
        ],
      });

      drawPanel(page2, { x: 292, y: 324, w: 240, h: 200, title: 'Model Assumptions', fill: COLORS.white });
      drawKeyValueList(page2, {
        x: 306,
        y: 488,
        w: 212,
        rows: exportContext.assumptions.slice(0, 8).map((assumption) => ({
          label: assumption.label,
          value:
            typeof assumption.value === 'number'
              ? formatNumber(assumption.value, 2)
              : assumption.value === true
                ? 'Yes'
                : assumption.value === false
                  ? 'No'
                  : String(assumption.value),
        })),
      });

      drawHorizontalBars(page2, {
        x: 550,
        y: 324,
        w: 257,
        h: 200,
        title: 'Cost Stack',
        items: [
          { label: 'Land', value: d.land_cost_cr, color: COLORS.blue },
          { label: 'Construction', value: d.construction_cost_cr, color: COLORS.accent },
          { label: 'Approvals', value: d.approval_cost_cr, color: COLORS.amber },
          { label: 'Marketing', value: d.marketing_cost_cr, color: COLORS.green },
          { label: 'Finance', value: d.finance_cost_cr, color: COLORS.red },
        ],
        formatter: formatCr,
      });

      drawCashFlowChart(page2, { x: 34, y: 72, w: 773, h: 224, rows: cashSeries });
      page2.drawText(
        `Total inflow ${formatCr(exportContext.cashFlows.summary.totalInflow)} | Total outflow ${formatCr(exportContext.cashFlows.summary.totalOutflow)} | Peak deployment ${formatCr(exportContext.cashFlows.summary.peakDeployment)}`,
        {
          x: 48,
          y: 88,
          size: 8,
          font,
          color: COLORS.slate500,
        }
      );
      drawFooter(
        page2,
        'Cash flow phasing is generated from stored underwriting inputs. Recheck the model after any assumption change.'
      );

      const page3 = addPage();
      drawHeader(page3, 'Sensitivity, Market, and Risks', 'Downside resilience, comps, diligence, and next actions');
      if (exportContext.sensitivity.irrGrid.length) {
        drawHeatmap(page3, {
          x: 34,
          y: 278,
          w: 420,
          h: 246,
          title: 'IRR Sensitivity Matrix',
          matrix: exportContext.sensitivity.irrGrid.slice(0, 9),
          rowLabels: exportContext.sensitivity.constructionCosts.slice(0, 9).map((value) => formatNumber(value, 0)),
          colLabels: exportContext.sensitivity.sellingRates.slice(0, 9).map((value) => formatNumber(value, 0)),
        });
      } else {
        drawPanel(page3, { x: 34, y: 278, w: 420, h: 246, title: 'IRR Sensitivity Matrix', fill: COLORS.white });
        drawWrappedText(page3, 'Sensitivity output is not available for this deal yet.', {
          x: 52,
          y: 478,
          width: 388,
          size: 10,
          lineHeight: 14,
          color: COLORS.slate700,
          maxLines: 3,
        });
      }

      drawHorizontalBars(page3, {
        x: 472,
        y: 278,
        w: 335,
        h: 246,
        title: 'Comparable Rate Stack',
        items: compRows.map((comp, index) => ({
          label: `${(comp.project_name || 'Comp').slice(0, 16)} ${index + 1}`,
          value: comp.rate_per_sqft,
          color: COLORS.accent,
        })),
        formatter: formatRate,
      });

      drawPanel(page3, { x: 34, y: 72, w: 388, h: 184, title: 'Top Risks', fill: COLORS.white });
      drawTable(page3, {
        x: 48,
        y: 212,
        colWidths: [110, 60, 150],
        header: ['Risk', 'Severity', 'Why it matters'],
        rows: aiTopRisks.map((risk) => [risk.title, humanize(risk.severity || 'risk'), risk.detail]),
        rowHeight: 28,
        maxRows: 3,
      });

      drawPanel(page3, { x: 442, y: 72, w: 365, h: 184, title: 'Diligence and Next Steps', fill: COLORS.white });
      drawTable(page3, {
        x: 456,
        y: 212,
        colWidths: [135, 78, 134],
        header: ['DD item', 'Severity', 'Status'],
        rows: pendingDdRows.map((item) => [item.item_name, humanize(item.severity), humanize(item.status)]),
        rowHeight: 24,
        maxRows: 3,
      });
      page3.drawText('Action plan', {
        x: 456,
        y: 110,
        size: 8.5,
        font: boldFont,
        color: COLORS.navy,
      });
      aiNextSteps.forEach((step, index) => {
        drawWrappedText(page3, `- ${step}`, {
          x: 456,
          y: 96 - index * 18,
          width: 335,
          size: 8,
          lineHeight: 10,
          color: COLORS.slate700,
          maxLines: 2,
        });
      });
      drawFooter(
        page3,
        'For internal investor-review use only. All values reflect stored deal data and should be independently verified before any commitment.'
      );

      const pdfBytes = await pdfDoc.save();
      const safeName = (d.name || 'deal').replace(/[^a-z0-9]/gi, '-').toLowerCase();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="redip-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(Buffer.from(pdfBytes));
      return;
      }

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
         WHERE ${buildVisibleDealCondition('d')}
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

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'REDIP';
      workbook.created = new Date();
      workbook.modified = new Date();

      addJsonWorksheet(workbook, 'Deals Pipeline', DEALS_XLSX_COLUMNS, dealsResult.rows);
      addJsonWorksheet(workbook, 'Comps', COMPS_XLSX_COLUMNS, compsResult.rows);

      // Summary sheet
      const summaryData = [
        { Metric: 'Total Visible Deals', Value: dealsResult.rows.length },
        { Metric: 'Export Date', Value: new Date().toISOString().slice(0, 10) },
        { Metric: 'Exported By', Value: req.user.name },
        { Metric: 'Platform', Value: 'REDIP — Real Estate Development Intelligence' },
      ];
      addJsonWorksheet(workbook, 'Summary', ['Metric', 'Value'], summaryData);

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="redip-deals-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);

// GET /exports/deals/:dealId/xlsx — single deal investor-grade workbook
// Multi-sheet: Cover, Executive Summary (+AI IC opinion), Assumptions,
// Area & Cost Stack, Cash Flows (Quarterly + Yearly), Sensitivity,
// Comps, DD & Risks, Metadata.
router.get(
  '/deals/:dealId/xlsx',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const dealId = req.params.dealId;

      // PR-NX69 — pass userId + userRole for BETA quota gate on the AI augment.
      const exportContext = await getDealExportContext(dealId, {
        userId: req.user?.id || null,
        userRole: req.user?.role || null,
      });

      if (!exportContext) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      // Workbook variant — `?v=2` opts in to the new investor-grade
      // 4-sheet workbook (Inputs, Phasing, Cash Flow, Dashboard) with
      // named ranges + locked formulas + native chart on Dashboard.
      // Default remains the existing 13-sheet workbook until v2 is
      // proven in production.
      // Workbook variant — v2 is the new default (4 visible sheets +
      // hidden Calculations audit trail). Operator can opt back to the
      // legacy 13-sheet workbook with `?v=1` or by setting
      // `XLSX_V1_FORCE=1` in Vercel.
      const explicitV1 = String(req.query.v || '').trim() === '1' || process.env.XLSX_V1_FORCE === '1';
      const useV2 = !explicitV1;
      const builder = useV2 ? buildDealWorkbookV2 : buildDealWorkbookXlsx;

      const xlsxBuffer = await builder(exportContext, {
        brandName: 'REDIP',
        userName: req.user?.name || 'REDIP',
        generatedAt: new Date().toISOString(),
        strictValidation: useV2,
      });
      const xlsxSafeName = ((exportContext.deal && exportContext.deal.name) || 'deal')
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();
      // v2 is now the default — only tag the filename when the operator
      // opts back to v1, so they can tell which they downloaded.
      const variantSuffix = explicitV1 ? '-v1' : '';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="redip-${xlsxSafeName}${variantSuffix}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      return res.send(xlsxBuffer);
    } catch (error) {
      next(error);
    }
  }
);

// ─── DOCX Underwriting Report ────────────────────────────────────────────────

// GET /exports/deals/:dealId/docx — investor-grade underwriting report
// (paid product). Until the paywall scaffold ships, the route is gated
// behind `DOCX_REPORT_ENABLED=1`. Admins always have access regardless
// of the env flag (`requireRole('admin')` already restricts the route).
//
// Sections: Cover, Executive Summary (AI-Assisted IC opinion + KPIs),
// Site Information (Mapbox map when MAPBOX_TOKEN set), Overview,
// Comparables, Financials, Pros & Cons (AI-Assisted), Overall Score
// (deterministic 0–100), Disclaimer (split into "AI-Assisted" vs
// "Platform Data" badges per the operator brief).
router.get(
  '/deals/:dealId/docx',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const isAdmin = (req.user?.role === 'admin');
      const enabled = String(process.env.DOCX_REPORT_ENABLED || '').trim() === '1';
      if (!enabled && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'DOCX underwriting report is not yet available. Contact REDIP support to enable.',
        });
      }

      const dealId = req.params.dealId;
      // PR-NX69 — pass userId + userRole for BETA quota gate on the AI augment.
      const exportContext = await getDealExportContext(dealId, {
        userId: req.user?.id || null,
        userRole: req.user?.role || null,
      });
      if (!exportContext) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      const docxBuffer = await buildDealReportDocx(exportContext, {
        brandName: 'REDIP',
        userName: req.user?.name || 'REDIP',
        generatedAt: new Date().toISOString(),
      });
      const safeName = ((exportContext.deal && exportContext.deal.name) || 'deal')
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="redip-${safeName}-underwriting-${new Date().toISOString().slice(0, 10)}.docx"`);
      return res.send(docxBuffer);
    } catch (error) {
      next(error);
    }
  }
);

// ─── K-RERA Readiness Pack DOCX (Phase 3 / Pillar 4) ─────────────────────────

// GET /exports/deals/:dealId/rera-readiness/docx — Karnataka RERA Readiness
// Pack as a Word document. Honors CLAUDE.md hard rule via a prominent cover-
// page disclaimer + footer on every page: organisation aid only, not a
// RERA compliance verdict.
//
// Available for the same roles as other export routes (admin + analyst).
// No env-flag gate — this is a deal-team workflow aid, not a paid product.
router.get(
  '/deals/:dealId/rera-readiness/docx',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const dealId = req.params.dealId;

      // Pull the deal (asset class + name) — must be visible to caller.
      const dealRow = await dealService.getDealById(dealId).catch(() => null);
      if (!dealRow) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      // Pull approvals + documents the same way the workspace slice does.
      let approvals = [];
      try { approvals = await approvalsService.listByDeal(dealId); } catch { /* migration-tolerant */ }

      let documentsFlat = [];
      try {
        const docs = await documentService.getDocuments(dealId).catch(() => null);
        // Flatten the by-category response into a single array.
        if (Array.isArray(docs)) documentsFlat = docs;
        else if (docs && typeof docs === 'object') {
          for (const k of Object.keys(docs)) {
            if (Array.isArray(docs[k])) documentsFlat = documentsFlat.concat(docs[k]);
          }
        }
      } catch { /* document fetch failure → empty list, pack still works */ }

      // Professional sign-offs — a SIGNED sign-off marks its matching
      // certificate item verified, so the handover pack reflects the same
      // evidence the in-app cockpit shows. Migration-tolerant → [] pre-table.
      let signoffs = [];
      try { signoffs = await signoffService.listByDeal(dealId); } catch { /* migration-tolerant */ }

      const reraCtx = buildReraContext(dealRow, { approvals, documents: documentsFlat, signoffs });
      const readiness = composeReadiness(reraCtx);
      // Co-locate the cross-document consistency findings + the post-registration
      // compliance calendar so the handover pack matches the in-app cockpit.
      readiness.consistency = await composeReraConsistency(dealId, dealRow);
      readiness.compliance_calendar = composeComplianceCalendar(reraCtx, {
        applicabilityStatus: readiness.applicability && readiness.applicability.status,
      });

      const docxBuffer = await buildReraReadinessDocx(readiness, {
        brandName: 'REDIP',
        userName: req.user?.name || null,
        generatedAt: new Date().toISOString(),
      });

      const safeName = ((dealRow && dealRow.name) || 'deal')
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="redip-${safeName}-rera-readiness-${new Date().toISOString().slice(0, 10)}.docx"`,
      );
      return res.send(docxBuffer);
    } catch (error) {
      next(error);
    }
  },
);

// ─── IC Readiness Pack DOCX (Phase 3 / Pillar 5) ─────────────────────────────

// GET /exports/deals/:dealId/ic-readiness/docx — IC Readiness Pack as a
// Word document. The deal team hands this to IC for pre-IC review.
// Reads the workspace's `ic_readiness` slice (composed server-side from
// every other workspace slice — no duplicate composition here).
router.get(
  '/deals/:dealId/ic-readiness/docx',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const dealId = req.params.dealId;
      const workspace = await getDealWorkspace(dealId).catch(() => null);
      if (!workspace) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }
      const readiness = workspace.ic_readiness;
      if (!readiness) {
        return res.status(500).json({ success: false, message: 'IC Readiness slice unavailable.' });
      }

      const docxBuffer = await buildIcReadinessDocx(readiness, {
        brandName: 'REDIP',
        userName: req.user?.name || null,
        generatedAt: new Date().toISOString(),
      });

      const safeName = (readiness.deal_name || workspace.deal?.name || 'deal')
        .replace(/[^a-z0-9]/gi, '-').toLowerCase();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="redip-${safeName}-ic-readiness-${new Date().toISOString().slice(0, 10)}.docx"`,
      );
      return res.send(docxBuffer);
    } catch (error) {
      next(error);
    }
  },
);

// ─── Audience-tailored report packs (lender / investor / buyer) ─────────────
// GET /exports/deals/:dealId/pack/:audience/docx — one parameterized route
// serves every audience. The audience differences live in the declarative
// catalog + the pure composer; this route just loads the workspace once,
// composes the normalized pack model, and renders it. Same auth + response
// posture as the other DOCX exports.
//
// Honesty (CLAUDE.md): the composer keeps the legal-four lanes as documentary
// status / flags only and labels every market figure with source + freshness;
// the renderer carries the single quiet cover disclaimer. No env gate — these
// are deal-team workflow aids.
router.get(
  '/deals/:dealId/pack/:audience/docx',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const { dealId, audience } = req.params;
      if (!isAudience(audience)) {
        return res.status(400).json({ success: false, message: 'Unknown report-pack audience.' });
      }
      const workspace = await getDealWorkspace(dealId).catch(() => null);
      if (!workspace) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      const packModel = composePack(workspace, audience);
      const docxBuffer = await buildReportPackDocx(packModel, {
        brandName: 'REDIP',
        userName: req.user?.name || null,
        generatedAt: new Date().toISOString(),
      });

      const safeName = ((workspace.deal && workspace.deal.name) || 'deal')
        .replace(/[^a-z0-9]/gi, '-').toLowerCase();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="redip-${safeName}-${audience}-pack-${new Date().toISOString().slice(0, 10)}.docx"`,
      );
      return res.send(docxBuffer);
    } catch (error) {
      next(error);
    }
  },
);

// ─── PDF Export ───────────────────────────────────────────────────────────────

// GET /exports/deals/:dealId/pdf — investor tear-sheet PDF.
//
// 2-page landscape A4 covering the snapshot a partner needs to make a
// call: KPI strip + property + economics on page 1, AI synthesis +
// risk register + top comps on page 2. Uses the same editorial chrome
// (navy/accent palette, pdf-lib + StandardFonts, landscape A4) as the
// Market Intelligence tear-sheet so both PDFs feel like one product.
//
// The legacy 1-page summary lived inline here. It's been replaced by
// the dedicated dealTearSheet.service.js — that service is testable
// in isolation and reuses dealExport.service's getDealExportContext()
// (DD/risks/approvals/comps/AI insights) instead of running its own
// half-baked SQL.
//
// Same path + filename pattern as before so existing front-end download
// links keep working.
router.get(
  '/deals/:dealId/pdf',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const { bytes, fileName } = await buildDealTearSheet({
        dealId: req.params.dealId,
        generatedBy: req.user?.name || req.user?.email || 'REDIP user',
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(bytes);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      return next(error);
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
      {
      // PR-NX69 — pass userId + userRole for BETA quota gate on the AI augment.
      const exportContext = await getDealExportContext(req.params.dealId, {
        userId: req.user?.id || null,
        userRole: req.user?.role || null,
      });
      if (!exportContext) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      {
        const pptxBuffer = await buildDealDeckPptx(exportContext, {
          brandName: 'REDIP',
          userName: req.user?.name || 'REDIP user',
          generatedAt: new Date().toISOString(),
        });

        const safeName = (exportContext.deal?.name || 'deal')
          .replace(/[^a-z0-9]/gi, '-')
          .toLowerCase();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="redip-${safeName}-${new Date().toISOString().slice(0, 10)}.pptx"`,
        );
        res.send(pptxBuffer);
        return;
      }

      }

    } catch (error) {
      next(error);
    }
  }
);

// GET /exports/intelligence/tear-sheet?city=Bengaluru
//
// Single-shot multi-page PDF tear-sheet of the Market Intelligence
// dashboard. Builds the same data the page renders (macro KPIs +
// residential + office + retail + industrial + hospitality + transactions)
// into a date-stamped, source-cited investor-grade PDF.
//
// Auth: any authenticated user can pull a tear-sheet (no admin-only gate
// — the data inside is the same data they can see on the page itself,
// so role escalation isn't a concern). Filename includes city + ISO date
// so reviewers can keep multiple snapshots side-by-side without name
// collisions.
router.get(
  '/intelligence/tear-sheet',
  authenticate,
  async (req, res, next) => {
    try {
      const city = (req.query.city || 'Bengaluru').toString().trim() || 'Bengaluru';
      const generatedBy = req.user?.name || req.user?.email || 'Unknown user';
      const { bytes, filename, sectionCounts } = await buildIntelligenceTearSheet({ city, generatedBy });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      // Section counts in a custom header so the FE can surface a toast
      // ("8 macro KPIs, 38 residential, 39 office, ..." — operators want
      // to know how thick the snapshot was without opening the PDF).
      res.setHeader('X-Tearsheet-Sections', JSON.stringify(sectionCounts));
      res.send(Buffer.from(bytes));
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
