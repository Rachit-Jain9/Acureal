'use strict';

const qrImage = require('../src/services/exports/shared/qrImage.service');

describe('services/exports/shared/qrImage', () => {
  test('renderQrPng returns a Buffer for a valid URL', async () => {
    const buffer = await qrImage.renderQrPng('https://acureal.in/deals/1');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(buffer.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  test('renderQrPng returns null for null / empty URL', async () => {
    expect(await qrImage.renderQrPng(null)).toBeNull();
    expect(await qrImage.renderQrPng('')).toBeNull();
    expect(await qrImage.renderQrPng(undefined)).toBeNull();
  });

  test('renderQrPng respects size option (rendered larger image)', async () => {
    const small = await qrImage.renderQrPng('https://acureal.in/', { size: 128 });
    const large = await qrImage.renderQrPng('https://acureal.in/', { size: 512 });
    expect(small.length).toBeGreaterThan(0);
    expect(large.length).toBeGreaterThan(small.length);
  }, 15000);

  test('renderQrDataUri returns a base64 data URI', async () => {
    const uri = await qrImage.renderQrDataUri('https://acureal.in/');
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(uri.length).toBeGreaterThan(200);
  });

  test('renderQrDataUri returns null for invalid URL input', async () => {
    expect(await qrImage.renderQrDataUri(null)).toBeNull();
  });
});
