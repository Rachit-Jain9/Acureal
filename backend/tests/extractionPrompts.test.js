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
});
