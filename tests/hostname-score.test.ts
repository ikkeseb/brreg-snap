import { describe, expect, it } from 'vitest';

import {
  foldNordic,
  generateNordicVariants,
  hostnameLabel,
} from '../src/lib/hostname-score.js';

describe('foldNordic', () => {
  it('folds ø/Ø to o/O', () => {
    expect(foldNordic('ELKJØP NORGE AS')).toBe('ELKJOP NORGE AS');
    expect(foldNordic('Bjørn')).toBe('Bjorn');
  });

  it('folds å/Å to a/A', () => {
    expect(foldNordic('Ås')).toBe('As');
    expect(foldNordic('FÅ')).toBe('FA');
  });

  it('folds æ/Æ to ae/AE', () => {
    expect(foldNordic('Sæther')).toBe('Saether');
    expect(foldNordic('TÆR')).toBe('TAER');
  });

  it('leaves ASCII strings untouched', () => {
    expect(foldNordic('ORKLA ASA')).toBe('ORKLA ASA');
  });
});

describe('generateNordicVariants', () => {
  it('returns the bare label as the first variant', () => {
    const out = generateNordicVariants('elkjop');
    expect(out[0]).toBe('elkjop');
  });

  it('adds one variant per "o" position substituted with "ø"', () => {
    const out = generateNordicVariants('boot');
    expect(out).toContain('bøot');
    expect(out).toContain('boøt');
  });

  it('adds one variant per "a" position substituted with "å"', () => {
    const out = generateNordicVariants('ban');
    expect(out).toContain('bån');
  });

  it('adds an "ae"→"æ" variant when present', () => {
    const out = generateNordicVariants('saether');
    expect(out).toContain('sæther');
  });

  it('adds an "aa"→"å" variant when present', () => {
    const out = generateNordicVariants('baard');
    expect(out).toContain('bård');
  });

  it('deduplicates — same input twice does not double the set', () => {
    const out = generateNordicVariants('shell');
    const set = new Set(out);
    expect(set.size).toBe(out.length);
  });
});

describe('hostnameLabel', () => {
  it('strips www and TLD, returns the rightmost remaining label', () => {
    expect(hostnameLabel('www.yara.com')).toBe('yara');
    expect(hostnameLabel('yara.com')).toBe('yara');
  });

  it('uses the registrable label for deeper hosts', () => {
    expect(hostnameLabel('shop.mestergruppen.no')).toBe('mestergruppen');
  });

  it('lowercases the result', () => {
    expect(hostnameLabel('NRK.no')).toBe('nrk');
  });

  it('returns undefined for single-label hostnames', () => {
    expect(hostnameLabel('localhost')).toBeUndefined();
  });

  it('returns undefined when the brand label is shorter than 2 chars', () => {
    expect(hostnameLabel('a.no')).toBeUndefined();
  });
});
