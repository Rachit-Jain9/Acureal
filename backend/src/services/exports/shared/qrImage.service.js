'use strict';

/**
 * QR code generator for export cover slides / report headers.
 *
 * Wraps the already-installed `qrcode` package. Returns a PNG buffer suitable
 * for embedding in pptxgenjs (`pptx.addImage({ data: 'data:image/png;base64,...' })`)
 * or docx images.
 *
 * Edge-case behaviour: `null` URL or any generation failure returns `null` —
 * cover-slide renderers must handle the no-QR case (they always do, since
 * QR is decorative-only).
 */

const QRCode = require('qrcode');

const DEFAULT_SIZE = 256; // px (rendered at 2× for retina)

/**
 * Generate a QR code PNG buffer.
 *
 * @param {string} url             Target URL the QR encodes
 * @param {Object} [options]
 * @param {number} [options.size]  Square size in px (default 256)
 * @param {string} [options.dark]  Foreground hex with #     (default '#0E1B2C')
 * @param {string} [options.light] Background hex with #     (default '#FFFFFF')
 * @returns {Promise<Buffer|null>}
 */
const renderQrPng = async (url, { size = DEFAULT_SIZE, dark = '#0E1B2C', light = '#FFFFFF' } = {}) => {
  if (!url || typeof url !== 'string') return null;
  try {
    return await QRCode.toBuffer(url, {
      type: 'png',
      width: Math.max(64, Math.min(1024, Math.round(size))),
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark, light },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[qrImage.renderQrPng] failed:', err.message);
    return null;
  }
};

/**
 * Generate a QR code as a data URI (`data:image/png;base64,...`). Convenience
 * for pptxgenjs `addImage({ data })` and docx Picture(`Buffer.from(base64,'base64')`).
 */
const renderQrDataUri = async (url, options) => {
  const buffer = await renderQrPng(url, options);
  if (!buffer) return null;
  return `data:image/png;base64,${buffer.toString('base64')}`;
};

module.exports = {
  renderQrPng,
  renderQrDataUri,
};
