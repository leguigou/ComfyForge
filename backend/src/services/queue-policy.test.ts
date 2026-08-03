import { describe, expect, it } from 'vitest';
import { getQueueLimits, selectNextFairTask } from './queue-policy';

describe('queue policy', () => {
  it('uses safe defaults and clamps environment limits', () => {
    expect(getQueueLimits({} as NodeJS.ProcessEnv)).toEqual({ perUser: 25, batch: 50 });
    expect(getQueueLimits({
      MAX_QUEUE_PER_USER: '12',
      MAX_QUEUE_BATCH: '8'
    } as NodeJS.ProcessEnv)).toEqual({ perUser: 12, batch: 8 });
    expect(getQueueLimits({
      MAX_QUEUE_PER_USER: '9999',
      MAX_QUEUE_BATCH: '-1'
    } as NodeJS.ProcessEnv)).toEqual({ perUser: 500, batch: 50 });
  });

  it('preserves FIFO order inside one user queue', () => {
    const selected = selectNextFairTask([
      { id: 2, userId: 'a', createdAt: 20 },
      { id: 1, userId: 'a', createdAt: 10 }
    ], new Map());
    expect(selected?.id).toBe(1);
  });

  it('selects the least recently served user without starving a third user', () => {
    const pending = [
      { id: 1, userId: 'a', createdAt: 10 },
      { id: 2, userId: 'b', createdAt: 20 },
      { id: 3, userId: 'c', createdAt: 30 },
      { id: 4, userId: 'a', createdAt: 40 }
    ];
    const served = new Map([['a', 100], ['b', 200]]);
    expect(selectNextFairTask(pending, served)?.userId).toBe('c');
  });
});
