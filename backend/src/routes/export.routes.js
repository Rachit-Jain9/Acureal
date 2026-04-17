const express = require('express');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const XLSX = require('xlsx');
const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');
const pptxgen = require('pptxgenjs');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { getDealExportContext } = require('../services/dealExport.service');
const { buildDealDeckPptx } = require('../services/dealPptx.service');
const { buildDealWorkbookXlsx } = require('../services/dealXlsx.service');

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
      {
      const exportContext = await getDealExportContext(req.params.dealId);
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
        report_type: 'Investor-Grade Report',
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

      const wb = XLSX.utils.book_new();

      // Deals sheet
      const dealsWs = XLSX.utils.json_to_sheet(dealsResult.rows);
      XLSX.utils.book_append_sheet(wb, dealsWs, 'Deals Pipeline');

      // Comps sheet
      const compsWs = XLSX.utils.json_to_sheet(compsResult.rows);
      XLSX.utils.book_append_sheet(wb, compsWs, 'Comps');

      // Summary sheet
      const summaryData = [
        { Metric: 'Total Visible Deals', Value: dealsResult.rows.length },
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

      const exportContext = await getDealExportContext(dealId);

      if (!exportContext) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      const xlsxBuffer = await buildDealWorkbookXlsx(exportContext, {
        brandName: 'REDIP',
        userName: req.user?.name || 'REDIP',
        generatedAt: new Date().toISOString(),
      });
      const xlsxSafeName = ((exportContext.deal && exportContext.deal.name) || 'deal')
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="redip-${xlsxSafeName}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      return res.send(xlsxBuffer);
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
      {
      const exportContext = await getDealExportContext(req.params.dealId);
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

      const deal = exportContext.deal;
      const ddSummary = exportContext.dd.summary;
      const riskSummary = exportContext.risks.summary;
      const recommendation = exportContext.risks.recommendation;
      const benchmarks = exportContext.market.benchmarks;
      const compRows = exportContext.market.exportComps.slice(0, 6);
      const pendingDdRows = exportContext.dd.items
        .filter((item) => !['completed', 'not_applicable'].includes(item.status))
        .slice(0, 3);
      const cashFlowRows = exportContext.cashFlows.yearly.length
        ? exportContext.cashFlows.yearly.slice(0, 8)
        : exportContext.cashFlows.quarterly.slice(0, 8);
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
            }));

      const prs = new pptxgen();
      prs.layout = 'LAYOUT_WIDE';

      const NAVY = '0F2044';
      const ACCENT = '2563EB';
      const SKY = '93C5FD';
      const WHITE = 'FFFFFF';
      const SLATE = '475569';
      const LIGHT = 'F1F5F9';
      const CARD = 'E2E8F0';
      const GREEN = '16A34A';
      const AMBER = 'D97706';
      const RED = 'DC2626';

      const humanize = (value) =>
        String(value || '')
          .replace(/_/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\b\w/g, (match) => match.toUpperCase());
      const fmtNumber = (value, decimals = 2) =>
        value === null || value === undefined || value === ''
          ? 'N/A'
          : Number(value).toLocaleString('en-IN', {
              minimumFractionDigits: 0,
              maximumFractionDigits: decimals,
            });
      const fmtCr = (value) => (value == null || value === '' ? 'N/A' : `INR ${fmtNumber(value)} Cr`);
      const fmtPct = (value) => (value == null || value === '' ? 'N/A' : `${fmtNumber(value)}%`);
      const fmtRate = (value) => (value == null || value === '' ? 'N/A' : `INR ${fmtNumber(value, 0)} / sqft`);
      const fmtArea = (value) => (value == null || value === '' ? 'N/A' : `${fmtNumber(value, 0)} sqft`);
      const toneColor = recommendation.tone === 'positive' ? GREEN : recommendation.tone === 'negative' ? RED : AMBER;

      const addHeader = (slide, title, subtitle = '') => {
        slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.82, fill: { color: NAVY } });
        slide.addText(title, {
          x: 0.38, y: 0.14, w: 7.2, h: 0.42,
          fontSize: 20, bold: true, color: WHITE, fontFace: 'Helvetica',
        });
        if (subtitle) {
          slide.addText(subtitle, {
            x: 8.0, y: 0.18, w: 4.9, h: 0.24,
            fontSize: 8, color: SKY, fontFace: 'Helvetica', align: 'right',
          });
        }
      };

      const addMetricCard = (slide, { x, y, label, value, color = ACCENT }) => {
        slide.addShape(prs.ShapeType.rect, {
          x, y, w: 2.35, h: 1.02,
          radius: 6,
          fill: { color: WHITE },
          line: { color: CARD, width: 1 },
        });
        slide.addShape(prs.ShapeType.rect, {
          x, y, w: 2.35, h: 0.08, fill: { color },
          line: { color },
        });
        slide.addText(value, {
          x: x + 0.12, y: y + 0.22, w: 2.05, h: 0.34,
          fontSize: 16, bold: true, color: NAVY, fontFace: 'Helvetica', align: 'center',
        });
        slide.addText(label, {
          x: x + 0.12, y: y + 0.68, w: 2.05, h: 0.18,
          fontSize: 8, color: SLATE, fontFace: 'Helvetica', align: 'center',
        });
      };

      const cover = prs.addSlide();
      cover.background = { color: NAVY };
      cover.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: '100%', fill: { color: ACCENT } });
      cover.addText('REDIP', {
        x: 0.62, y: 0.44, w: 2, h: 0.3,
        fontSize: 13, bold: true, color: SKY, fontFace: 'Helvetica',
      });
      cover.addText(deal.name || 'Deal Investor Package', {
        x: 0.62, y: 1.18, w: 10.6, h: 1.05,
        fontSize: 30, bold: true, color: WHITE, fontFace: 'Helvetica', wrap: true,
      });
      cover.addText(
        [humanize(deal.asset_class), humanize(deal.deal_structure), deal.city, deal.state].filter(Boolean).join(' | '),
        {
          x: 0.62, y: 2.5, w: 10.8, h: 0.3,
          fontSize: 13, color: SKY, fontFace: 'Helvetica',
        }
      );
      addMetricCard(cover, { x: 0.62, y: 4.55, label: 'IRR', value: fmtPct(deal.irr_pct), color: toneColor });
      addMetricCard(cover, { x: 3.12, y: 4.55, label: 'NPV', value: fmtCr(deal.npv_cr), color: toneColor });
      addMetricCard(cover, { x: 5.62, y: 4.55, label: 'Revenue', value: fmtCr(deal.total_revenue_cr) });
      addMetricCard(cover, { x: 8.12, y: 4.55, label: 'Total Cost', value: fmtCr(deal.total_cost_cr) });
      addMetricCard(cover, { x: 10.62, y: 4.55, label: 'Gross Margin', value: fmtPct(deal.gross_margin_pct), color: toneColor });
      cover.addText(`Generated ${new Date().toLocaleDateString('en-IN')} | Internal use only`, {
        x: 0.62, y: 6.85, w: 6.0, h: 0.22,
        fontSize: 8, italic: true, color: '94A3B8', fontFace: 'Helvetica',
      });

      const icSlide = prs.addSlide();
      addHeader(icSlide, 'Investment View', `${deal.name || 'Deal'} | ${recommendation.label}`);
      icSlide.addShape(prs.ShapeType.rect, {
        x: 0.35, y: 1.0, w: 4.0, h: 1.05,
        radius: 8,
        fill: { color: LIGHT },
        line: { color: toneColor, width: 2 },
      });
      icSlide.addText(recommendation.label.toUpperCase(), {
        x: 0.55, y: 1.3, w: 3.6, h: 0.25,
        fontSize: 22, bold: true, color: toneColor, fontFace: 'Helvetica', align: 'center',
      });
      icSlide.addText(recommendation.reason, {
        x: 0.55, y: 1.66, w: 3.6, h: 0.24,
        fontSize: 8.5, color: SLATE, fontFace: 'Helvetica', align: 'center', wrap: true,
      });
      icSlide.addShape(prs.ShapeType.rect, {
        x: 4.65, y: 1.0, w: 8.25, h: 2.2,
        radius: 6,
        fill: { color: WHITE },
        line: { color: CARD, width: 1 },
      });
      icSlide.addText('AI Investor-Grade Opinion', {
        x: 4.85, y: 1.18, w: 2.2, h: 0.2,
        fontSize: 11, bold: true, color: NAVY, fontFace: 'Helvetica',
      });
      icSlide.addText(aiOpinion, {
        x: 4.85, y: 1.52, w: 7.8, h: 1.45,
        fontSize: 10, color: SLATE, fontFace: 'Helvetica', wrap: true, valign: 'top',
      });
      addMetricCard(icSlide, { x: 0.35, y: 2.38, label: 'DD Completion', value: `${fmtNumber(ddSummary.completion_pct, 0)}%`, color: ACCENT });
      addMetricCard(icSlide, { x: 2.85, y: 2.38, label: 'Open DD Breakers', value: String(ddSummary.open_deal_breakers || 0), color: RED });
      addMetricCard(icSlide, { x: 5.35, y: 2.38, label: 'Critical Risks', value: String(riskSummary.critical || 0), color: RED });
      addMetricCard(icSlide, { x: 7.85, y: 2.38, label: 'High Risks', value: String(riskSummary.high || 0), color: AMBER });
      addMetricCard(icSlide, { x: 10.35, y: 2.38, label: 'Benchmark Median', value: fmtRate(benchmarks.median_rate_per_sqft), color: ACCENT });

      const insightTable = [
        [
          { text: 'Theme', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
          { text: 'Observation', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
        ],
        ['Property', deal.property_name || 'N/A'],
        ['Location', [deal.city, deal.state].filter(Boolean).join(', ') || 'N/A'],
        ['Duration', exportContext.durationYears ? `${fmtNumber(exportContext.durationYears)} years` : 'N/A'],
        ['Effective Date', exportContext.effectiveDate || 'N/A'],
        ['Selling Rate Gap', exportContext.market.pricingGapPct == null ? 'N/A' : `${fmtNumber(exportContext.market.pricingGapPct, 1)}% vs benchmark`],
      ].map((row, index) => index === 0 ? row : [
        { text: row[0], options: { fontSize: 9, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } } },
        { text: row[1], options: { fontSize: 9, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } } },
      ]);
      icSlide.addTable(insightTable, {
        x: 0.35, y: 4.0, w: 4.65,
        colW: [1.45, 3.2],
        rowH: 0.38,
        border: { type: 'solid', color: CARD, pt: 0.5 },
      });

      const riskActionTable = [
        [
          { text: 'Top Risks', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
          { text: 'Next Steps', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
        ],
        ...[0, 1, 2].map((index) => [
          {
            text: aiTopRisks[index] ? `${aiTopRisks[index].title}: ${aiTopRisks[index].detail}` : 'N/A',
            options: { fontSize: 8.5, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } },
          },
          {
            text: aiNextSteps[index] || 'N/A',
            options: { fontSize: 8.5, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } },
          },
        ]),
      ];
      icSlide.addTable(riskActionTable, {
        x: 5.25, y: 4.0, w: 7.65,
        colW: [4.9, 2.75],
        rowH: 0.52,
        border: { type: 'solid', color: CARD, pt: 0.5 },
      });

      const uwSlide = prs.addSlide();
      addHeader(uwSlide, 'Underwriting Dashboard', `${deal.name || 'Deal'} | Areas, inputs, and cost stack`);
      uwSlide.addChart(prs.ChartType.bar, [{
        name: 'Area (sqft)',
        labels: ['Plot', 'Gross FAR', 'Saleable', 'Carpet'],
        values: [
          Number(deal.plot_area_sqft || deal.land_area_sqft) || 0,
          Number(deal.gross_area_sqft) || 0,
          Number(deal.saleable_area_sqft) || 0,
          Number(deal.carpet_area_sqft) || 0,
        ],
      }], {
        x: 0.35, y: 1.05, w: 5.7, h: 2.95,
        barDir: 'bar',
        chartColors: ['0F766E', '0284C7', '2563EB', '7C3AED'],
        showValue: true,
        dataLabelFontSize: 8,
        catAxisLabelFontSize: 9,
        valAxisLabelFontSize: 8,
        legendPos: 'none',
        title: 'Area Build-up (sqft)',
        titleFontSize: 10,
      });
      uwSlide.addChart(prs.ChartType.bar, [{
        name: 'Cost (INR Cr)',
        labels: ['Land', 'Construction', 'Approvals', 'Marketing', 'Finance'],
        values: [
          Number(deal.land_cost_cr) || 0,
          Number(deal.construction_cost_cr) || 0,
          Number(deal.approval_cost_cr) || 0,
          Number(deal.marketing_cost_cr) || 0,
          Number(deal.finance_cost_cr) || 0,
        ],
      }], {
        x: 6.35, y: 1.05, w: 6.6, h: 2.95,
        barDir: 'col',
        chartColors: ['2563EB', '3B82F6', '93C5FD', '16A34A', 'F59E0B'],
        showValue: true,
        dataLabelFontSize: 8,
        catAxisLabelFontSize: 8,
        valAxisLabelFontSize: 8,
        legendPos: 'none',
        title: 'Cost Stack (INR Cr)',
        titleFontSize: 10,
      });
      const assumptionTableRows = [
        [
          { text: 'Input', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
          { text: 'Value', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
        ],
        ...exportContext.assumptions.slice(0, 9).map((assumption, index) => [
          {
            text: assumption.label,
            options: { fontSize: 8.5, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } },
          },
          {
            text:
              typeof assumption.value === 'number'
                ? fmtNumber(assumption.value, 2)
                : assumption.value === true
                  ? 'Yes'
                  : assumption.value === false
                    ? 'No'
                    : String(assumption.value),
            options: { fontSize: 8.5, align: 'right', fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } },
          },
        ]),
      ];
      uwSlide.addTable(assumptionTableRows, {
        x: 0.35, y: 4.28, w: 6.1,
        colW: [3.8, 2.3],
        rowH: 0.36,
        border: { type: 'solid', color: CARD, pt: 0.5 },
      });
      uwSlide.addText(
        `Plot area ${fmtArea(deal.plot_area_sqft || deal.land_area_sqft)} | FSI ${fmtNumber(deal.fsi, 2)} | Loading ${deal.loading_factor == null ? 'N/A' : `${fmtNumber(Number(deal.loading_factor) * 100, 1)}%`} | Selling rate ${fmtRate(deal.selling_rate_per_sqft)}`,
        {
          x: 6.65, y: 4.35, w: 6.0, h: 0.6,
          fontSize: 9.5, color: SLATE, fontFace: 'Helvetica', wrap: true,
        }
      );
      uwSlide.addShape(prs.ShapeType.rect, {
        x: 6.65, y: 5.1, w: 6.0, h: 1.45,
        radius: 6,
        fill: { color: LIGHT },
        line: { color: CARD, width: 1 },
      });
      uwSlide.addText('Underwriting note', {
        x: 6.85, y: 5.26, w: 2.5, h: 0.22,
        fontSize: 11, bold: true, color: NAVY, fontFace: 'Helvetica',
      });
      uwSlide.addText(
        `Benchmark median is ${fmtRate(benchmarks.median_rate_per_sqft)} across ${fmtNumber(benchmarks.count, 0)} comps. Current modeled sell rate is ${exportContext.market.pricingGapPct == null ? 'not comparable yet' : `${fmtNumber(exportContext.market.pricingGapPct, 1)}% versus that benchmark`}.`,
        {
          x: 6.85, y: 5.58, w: 5.6, h: 0.72,
          fontSize: 9, color: SLATE, fontFace: 'Helvetica', wrap: true,
        }
      );

      const analyticsSlide = prs.addSlide();
      addHeader(analyticsSlide, 'Cash Flow and Sensitivity', `${deal.name || 'Deal'} | Modeled phasing and downside grid`);
      analyticsSlide.addChart(prs.ChartType.bar, [{
        name: 'Net cash flow (INR Cr)',
        labels: cashFlowRows.map((row, index) => row.label || `P${index + 1}`),
        values: cashFlowRows.map((row) => Number(row.net || 0)),
      }], {
        x: 0.35, y: 1.0, w: 7.0, h: 4.1,
        barDir: 'col',
        chartColors: ['2563EB'],
        showValue: true,
        dataLabelFontSize: 8,
        catAxisLabelFontSize: 8,
        valAxisLabelFontSize: 8,
        legendPos: 'none',
        title: 'Net Cash Flow Profile (INR Cr)',
        titleFontSize: 10,
      });
      analyticsSlide.addText(
        `Total inflow ${fmtCr(exportContext.cashFlows.summary.totalInflow)} | Total outflow ${fmtCr(exportContext.cashFlows.summary.totalOutflow)} | Peak deployment ${fmtCr(exportContext.cashFlows.summary.peakDeployment)}`,
        {
          x: 0.55, y: 5.18, w: 6.55, h: 0.24,
          fontSize: 8.5, color: SLATE, fontFace: 'Helvetica', align: 'center',
        }
      );
      const sensitivityHeader = [
        { text: 'Build Cost \\ Sell Rate', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
        ...exportContext.sensitivity.sellingRates.slice(0, 9).map((value) => ({
          text: fmtNumber(value, 0),
          options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'center' },
        })),
      ];
      const sensitivityRows = exportContext.sensitivity.irrGrid.length
        ? exportContext.sensitivity.irrGrid.slice(0, 9).map((row, rowIndex) => [
            {
              text: fmtNumber(exportContext.sensitivity.constructionCosts[rowIndex], 0),
              options: { bold: true, fill: { color: LIGHT } },
            },
            ...row.slice(0, 9).map((value) => {
              const numeric = Number(value);
              const fillColor = !Number.isFinite(numeric)
                ? WHITE
                : numeric >= 20
                  ? 'DCFCE7'
                  : numeric >= 15
                    ? 'FEF3C7'
                    : 'FEE2E2';
              return {
                text: Number.isFinite(numeric) ? `${fmtNumber(numeric, 1)}%` : 'N/A',
                options: { align: 'center', fill: { color: fillColor }, fontSize: 7.5 },
              };
            }),
          ])
        : [[{ text: 'Sensitivity not available', options: { fill: { color: LIGHT } } }, ...Array.from({ length: 9 }, () => ({ text: '-', options: {} }))]];
      analyticsSlide.addTable([sensitivityHeader, ...sensitivityRows], {
        x: 7.55, y: 1.0, w: 5.35,
        colW: [1.55, 0.42, 0.42, 0.42, 0.42, 0.42, 0.42, 0.42, 0.42, 0.42],
        rowH: 0.34,
        border: { type: 'solid', color: CARD, pt: 0.5 },
        fontFace: 'Helvetica',
      });
      analyticsSlide.addText('Sensitivity matrix shows IRR under sell-rate and build-cost stress.', {
        x: 7.75, y: 5.18, w: 4.95, h: 0.3,
        fontSize: 8.5, color: SLATE, fontFace: 'Helvetica', align: 'center',
      });

      const marketSlide = prs.addSlide();
      addHeader(marketSlide, 'Market, Risks, and Action Plan', `${deal.name || 'Deal'} | External positioning and execution priorities`);
      if (compRows.length >= 2) {
        marketSlide.addChart(prs.ChartType.bar, [{
          name: 'Rate (INR/sqft)',
          labels: compRows.map((comp) => (comp.project_name || 'Comp').slice(0, 20)),
          values: compRows.map((comp) => Number(comp.rate_per_sqft || 0)),
        }], {
          x: 0.35, y: 1.0, w: 6.2, h: 2.9,
          barDir: 'bar',
          chartColors: [ACCENT],
          showValue: true,
          dataLabelFontSize: 8,
          catAxisLabelFontSize: 8,
          valAxisLabelFontSize: 8,
          legendPos: 'none',
          title: 'Comparable Rate Stack (INR/sqft)',
          titleFontSize: 10,
        });
      } else {
        marketSlide.addShape(prs.ShapeType.rect, {
          x: 0.35, y: 1.0, w: 6.2, h: 2.9,
          radius: 6,
          fill: { color: LIGHT },
          line: { color: CARD, width: 1 },
        });
        marketSlide.addText('Not enough verified comps are available for a chart yet.', {
          x: 0.75, y: 2.15, w: 5.4, h: 0.4,
          fontSize: 11, italic: true, color: SLATE, fontFace: 'Helvetica', align: 'center',
        });
      }
      const compTableRows = [
        [
          { text: 'Project', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
          { text: 'Locality', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
          { text: 'Rate', options: { bold: true, color: WHITE, fill: { color: NAVY }, align: 'right' } },
        ],
        ...compRows.map((comp, index) => [
          { text: comp.project_name || 'N/A', options: { fontSize: 8.5, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } } },
          { text: comp.locality || comp.city || 'N/A', options: { fontSize: 8.5, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } } },
          { text: fmtRate(comp.rate_per_sqft), options: { fontSize: 8.5, align: 'right', fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } } },
        ]),
      ];
      marketSlide.addTable(compTableRows, {
        x: 0.35, y: 4.2, w: 6.2,
        colW: [3.0, 1.6, 1.6],
        rowH: 0.36,
        border: { type: 'solid', color: CARD, pt: 0.5 },
      });

      const riskTableRows = [
        [
          { text: 'Top risks', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
          { text: 'Action plan', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
        ],
        ...[0, 1, 2].map((index) => [
          {
            text: aiTopRisks[index] ? `${aiTopRisks[index].title}: ${aiTopRisks[index].detail}` : 'N/A',
            options: { fontSize: 8.5, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } },
          },
          {
            text: aiNextSteps[index] || 'N/A',
            options: { fontSize: 8.5, fill: { color: index % 2 === 0 ? 'F8FAFC' : WHITE } },
          },
        ]),
      ];
      marketSlide.addTable(riskTableRows, {
        x: 6.8, y: 1.0, w: 6.1,
        colW: [3.65, 2.45],
        rowH: 0.55,
        border: { type: 'solid', color: CARD, pt: 0.5 },
      });
      const pendingDdText = pendingDdRows.length
        ? pendingDdRows.map((item) => `- ${item.item_name} (${humanize(item.severity)})`).join('\n')
        : 'No open diligence blockers are currently outstanding.';
      marketSlide.addShape(prs.ShapeType.rect, {
        x: 6.8, y: 4.25, w: 6.1, h: 1.95,
        radius: 6,
        fill: { color: LIGHT },
        line: { color: CARD, width: 1 },
      });
      marketSlide.addText('Pending diligence focus', {
        x: 7.0, y: 4.42, w: 2.6, h: 0.22,
        fontSize: 11, bold: true, color: NAVY, fontFace: 'Helvetica',
      });
      marketSlide.addText(pendingDdText, {
        x: 7.0, y: 4.75, w: 5.7, h: 1.15,
        fontSize: 9, color: SLATE, fontFace: 'Helvetica', wrap: true, valign: 'top',
      });

      const disclaimer = prs.addSlide();
      disclaimer.background = { color: LIGHT };
      disclaimer.addText('Disclaimer', {
        x: 1.0, y: 1.35, w: 3.0, h: 0.4,
        fontSize: 22, bold: true, color: NAVY, fontFace: 'Helvetica',
      });
      disclaimer.addText(
        'This presentation is generated from stored REDIP deal data for internal investment-review use only. Financial outputs and AI-generated commentary are informational and must be independently verified before any investment decision, investor note, or circulation outside the deal team.',
        {
          x: 1.0, y: 2.05, w: 11.2, h: 1.45,
          fontSize: 11, color: SLATE, fontFace: 'Helvetica', wrap: true,
        }
      );
      disclaimer.addText(
        `Generated by ${req.user.name} on ${new Date().toLocaleDateString('en-IN')} | REDIP`,
        {
          x: 1.0, y: 6.42, w: 11.2, h: 0.22,
          fontSize: 8.5, italic: true, color: SLATE, fontFace: 'Helvetica', align: 'center',
        }
      );

      const pptxBuffer = await prs.write({ outputType: 'nodebuffer' });
      const safeName = (deal.name || 'deal').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="redip-${safeName}-${new Date().toISOString().slice(0, 10)}.pptx"`);
      res.send(pptxBuffer);
      return;
      }

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
          ['Effective Date',         d.model_params?.inputs?.effectiveDate || 'Today'],
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
      slide5.addText('Investor-Grade Recommendation', {
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
        'This presentation has been prepared by REDIP for internal investor review only. All financial projections are based on current deal assumptions and have not been independently verified. Values are in Indian Rupees (Crore) unless otherwise stated. Past performance is not indicative of future results. This document does not constitute investment advice. All recipients are bound by applicable confidentiality obligations. Do not distribute without prior written consent.',
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
