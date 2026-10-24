import { describe, expect, it } from 'vitest';
import { reclaimedBytes, storageSize } from './storage';
describe('disk reclaim results', () => {
  it('measures physical allocation, never claims file length as reclaimed disk space', () => {
    expect(reclaimedBytes({ allocatedBytes: 10_000 }, { allocatedBytes: 4_000 })).toBe(6_000);
    expect(reclaimedBytes({ allocatedBytes: 10_000 }, { allocatedBytes: 11_000 })).toBe(0);
  });
  it('formats zero and binary units', () => {
    expect(storageSize(0)).toBe('0 B');
    expect(storageSize(1024 ** 3)).toBe('1.00 GiB');
  });
});
