'use strict';

const { detectLanguage } = require('../src/services/ai/languageDetect');

describe('detectLanguage — basic scripts', () => {
  test('English (Latin-majority) → "en"', () => {
    const text = 'This sale deed is executed by the seller in favor of the buyer at Whitefield, Bengaluru.';
    expect(detectLanguage(text)).toBe('en');
  });

  test('Hindi (Devanagari-majority) → "hi"', () => {
    const text = 'यह विक्रय विलेख विक्रेता द्वारा क्रेता के पक्ष में निष्पादित किया जाता है।';
    expect(detectLanguage(text)).toBe('hi');
  });

  test('Kannada-majority → "kn"', () => {
    const text = 'ಈ ಮಾರಾಟ ಪತ್ರವನ್ನು ಮಾರಾಟಗಾರನು ಖರೀದಿದಾರನ ಪರವಾಗಿ ನಿಷ್ಪಾದಿಸುತ್ತಾನೆ ಬೆಂಗಳೂರು ಕರ್ನಾಟಕ ಭಾರತ.';
    expect(detectLanguage(text)).toBe('kn');
  });

  test('Tamil-majority → "ta"', () => {
    const text = 'இந்த விற்பனை ஆவணம் விற்பவரால் வாங்குபவருக்கு செயல்படுத்தப்படுகிறது சென்னை தமிழ்நாடு.';
    expect(detectLanguage(text)).toBe('ta');
  });
});

describe('detectLanguage — mixed and edge cases', () => {
  test('Mixed Kannada + English (typical Bengaluru deed) → "mul"', () => {
    // Roughly half Kannada, half Latin. Common in Karnataka land documents.
    const text = 'ಮಾರಾಟ ಪತ್ರ Sale Deed ಬೆಂಗಳೂರು Bengaluru ಸರ್ವೆ ಸಂಖ್ಯೆ Survey No 42/3 ಎಕರೆ acres ಕರ್ನಾಟಕ Karnataka';
    expect(detectLanguage(text)).toBe('mul');
  });

  test('Empty / whitespace-only → "und"', () => {
    expect(detectLanguage('')).toBe('und');
    expect(detectLanguage('   \n\n  ')).toBe('und');
  });

  test('Below sample threshold (<12 chars) → "und"', () => {
    expect(detectLanguage('hi')).toBe('und');
    expect(detectLanguage('abc')).toBe('und');
  });

  test('Pure punctuation/numbers → "und"', () => {
    expect(detectLanguage('123 456 789 ; , . / 100% ₹')).toBe('und');
  });

  test('Non-string input → "und"', () => {
    expect(detectLanguage(null)).toBe('und');
    expect(detectLanguage(undefined)).toBe('und');
    expect(detectLanguage(42)).toBe('und');
  });

  test('Long input is sampled, not fully scanned (perf safety)', () => {
    // Build a 100k-char string of English. Detect should still return 'en'
    // and complete fast (sample cap is 4000 chars).
    const text = 'The buyer pays the seller. '.repeat(5000);
    const start = Date.now();
    expect(detectLanguage(text)).toBe('en');
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe('detectLanguage — robustness', () => {
  test('English with occasional Indic word still resolves to "en"', () => {
    // Small smattering of Kannada in mostly-English text shouldn't flip the
    // verdict. Below the 25% mixed threshold.
    const text = 'The property at Survey ಸಂಖ್ಯೆ 42/3 in Whitefield is bounded on the east by the Old Madras Road extending to Bengaluru International Airport beyond Hebbal flyover and the western boundary follows the Outer Ring Road southward toward Marathahalli';
    expect(detectLanguage(text)).toBe('en');
  });
});
