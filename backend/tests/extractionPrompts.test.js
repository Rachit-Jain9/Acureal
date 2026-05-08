const {
  GEMINI_EXTRACTION_PROMPTS,
  CLASSIFY_PROMPT,
} = require('../src/services/ai/extractionPrompts');

describe('extraction prompts', () => {
  test('classifies BBMP UAV property-tax PDFs separately from IGR guidance values', () => {
    expect(GEMINI_EXTRACTION_PROMPTS).toHaveProperty('bbmp_uav_pdf');
    expect(GEMINI_EXTRACTION_PROMPTS.bbmp_uav_pdf).toContain('NOT Karnataka IGR');
    expect(CLASSIFY_PROMPT).toContain('bbmp_uav_pdf');
    expect(CLASSIFY_PROMPT).toContain('Unit Area Value');
    expect(CLASSIFY_PROMPT).toContain('Do not classify BBMP UAV/property-tax PDFs as IGR guidance');
  });

  test('registers comps_rate_sheet doctype for broker multi-property rate sheets', () => {
    expect(GEMINI_EXTRACTION_PROMPTS).toHaveProperty('comps_rate_sheet');
    expect(GEMINI_EXTRACTION_PROMPTS.comps_rate_sheet).toContain('"comps":');
    expect(GEMINI_EXTRACTION_PROMPTS.comps_rate_sheet).toContain('raw_row_text');
    expect(CLASSIFY_PROMPT).toContain('comps_rate_sheet');
    expect(CLASSIFY_PROMPT).toContain('multi-property rate sheet');
  });

  test('registers ipc_report doctype for IPC quarterly market reports', () => {
    expect(GEMINI_EXTRACTION_PROMPTS).toHaveProperty('ipc_report');
    expect(GEMINI_EXTRACTION_PROMPTS.ipc_report).toContain('JLL, Cushman');
    expect(GEMINI_EXTRACTION_PROMPTS.ipc_report).toContain('headline_kpis');
    expect(CLASSIFY_PROMPT).toContain('ipc_report');
    expect(CLASSIFY_PROMPT).toContain('International Property Consultant');
  });
});
