jest.mock('../src/services/parcelIntelligence.service', () => ({
  getLatestSnapshotId: jest.fn(),
  NEEDS_VERIFICATION_KEYS: new Set([
    'zoning_assignment',
    'far_assignment',
    'guidance_value',
    'landeed_api',
    'coordinates',
  ]),
}));

jest.mock('../src/services/evidenceLinks.service', () => ({
  attachLink: jest.fn(),
  listForOwner: jest.fn(),
  detachLink: jest.fn(),
}));

const parcelService = require('../src/services/parcelIntelligence.service');
const evidenceLinks = require('../src/services/evidenceLinks.service');
const verifyService = require('../src/services/parcelIntelligenceVerify.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('parcelIntelligenceVerify.verifyItem', () => {
  test('rejects unknown item keys', async () => {
    await expect(
      verifyService.verifyItem({ propertyId: 'p1', itemKey: 'totally_made_up' })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(evidenceLinks.attachLink).not.toHaveBeenCalled();
  });

  test('errors when no snapshot exists', async () => {
    parcelService.getLatestSnapshotId.mockResolvedValue(null);
    await expect(
      verifyService.verifyItem({
        propertyId: 'p1',
        itemKey: 'guidance_value',
        notes: 'Checked IGR portal',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('requires at least one of doc/url/note', async () => {
    parcelService.getLatestSnapshotId.mockResolvedValue('snap-1');
    await expect(
      verifyService.verifyItem({ propertyId: 'p1', itemKey: 'guidance_value' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('uses link_kind=document when documentId provided', async () => {
    parcelService.getLatestSnapshotId.mockResolvedValue('snap-1');
    evidenceLinks.attachLink.mockResolvedValue({ id: 'link-1' });
    await verifyService.verifyItem({
      propertyId: 'p1',
      itemKey: 'guidance_value',
      documentId: 'doc-1',
      userId: 'user-1',
    });
    expect(evidenceLinks.attachLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerKind: 'parcel_intelligence',
        ownerId: 'snap-1',
        linkKind: 'document',
        documentId: 'doc-1',
        sourceSection: 'item:guidance_value',
        confidenceScore: 0.9,
      })
    );
  });

  test('uses link_kind=manual_verification when only url+note', async () => {
    parcelService.getLatestSnapshotId.mockResolvedValue('snap-1');
    evidenceLinks.attachLink.mockResolvedValue({ id: 'link-2' });
    await verifyService.verifyItem({
      propertyId: 'p1',
      itemKey: 'far_assignment',
      externalUrl: 'https://kgis.ksrsac.in/...',
      notes: 'Confirmed via portal',
    });
    expect(evidenceLinks.attachLink).toHaveBeenCalledWith(
      expect.objectContaining({
        linkKind: 'manual_verification',
        externalUrl: 'https://kgis.ksrsac.in/...',
        notes: 'Confirmed via portal',
        sourceSection: 'item:far_assignment',
      })
    );
  });
});

describe('parcelIntelligenceVerify.listVerifications', () => {
  test('returns empty when no snapshot exists', async () => {
    parcelService.getLatestSnapshotId.mockResolvedValue(null);
    const result = await verifyService.listVerifications('p1');
    expect(result).toEqual({ snapshot_id: null, verifications: [] });
    expect(evidenceLinks.listForOwner).not.toHaveBeenCalled();
  });

  test('filters to item-keyed links and parses item_key', async () => {
    parcelService.getLatestSnapshotId.mockResolvedValue('snap-1');
    evidenceLinks.listForOwner.mockResolvedValue([
      { id: 'l1', source_section: 'item:guidance_value', notes: 'IGR ok' },
      { id: 'l2', source_section: null, notes: 'unrelated link' },
      { id: 'l3', source_section: 'item:zoning_assignment', notes: 'BBMP ok' },
    ]);
    const result = await verifyService.listVerifications('p1');
    expect(result.snapshot_id).toBe('snap-1');
    expect(result.verifications.map((v) => v.item_key)).toEqual([
      'guidance_value',
      'zoning_assignment',
    ]);
  });
});
