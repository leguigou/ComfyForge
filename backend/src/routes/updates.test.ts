import { describe, expect, it } from 'vitest';
import { compareVersions } from './updates';

describe('update version comparison', () => {
  it('orders published, current, and locally newer versions', () => {
    expect(compareVersions('v2.7.1', '2.7.0')).toBe(1);
    expect(compareVersions('2.7.0', 'v2.7.0')).toBe(0);
    expect(compareVersions('2.3.0', '2.7.0')).toBe(-1);
  });
});
