import { describe, expect, it } from 'vitest';
import { defaultPaidTotalCents, resolveReferenceUnitCents } from './price.js';

describe('resolveReferenceUnitCents', () => {
  it('T13: style without own price inherits series default', () => {
    expect(resolveReferenceUnitCents({}, { defaultUnitCents: 6900 })).toBe(6900);
  });

  it('style-level price overrides series default', () => {
    expect(
      resolveReferenceUnitCents({ referenceUnitCents: 9900 }, { defaultUnitCents: 6900 }),
    ).toBe(9900);
  });

  it('returns null when neither side has a price', () => {
    expect(resolveReferenceUnitCents({}, {})).toBeNull();
    expect(resolveReferenceUnitCents({ referenceUnitCents: null }, { defaultUnitCents: null })).toBeNull();
  });

  it('explicit null on style falls back to series', () => {
    expect(
      resolveReferenceUnitCents({ referenceUnitCents: null }, { defaultUnitCents: 7900 }),
    ).toBe(7900);
  });

  it('ignores invalid stored values', () => {
    expect(
      resolveReferenceUnitCents({ referenceUnitCents: -1 }, { defaultUnitCents: 6900 }),
    ).toBe(6900);
  });
});

describe('defaultPaidTotalCents', () => {
  it('multiplies unit price by quantity', () => {
    expect(defaultPaidTotalCents(6900, 1)).toBe(6900);
    expect(defaultPaidTotalCents(6900, 2)).toBe(13800);
  });

  it('does not invent a default when price is missing', () => {
    expect(defaultPaidTotalCents(null, 2)).toBeNull();
  });

  it('rejects non-positive quantity', () => {
    expect(() => defaultPaidTotalCents(6900, 0)).toThrow();
    expect(() => defaultPaidTotalCents(6900, -1)).toThrow();
    expect(() => defaultPaidTotalCents(6900, 1.5)).toThrow();
  });
});
