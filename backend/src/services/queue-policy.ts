export type FairQueueCandidate = {
  id: number;
  userId: string;
  createdAt: number;
};

const readPositiveInteger = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export const getQueueLimits = (environment: NodeJS.ProcessEnv = process.env) => ({
  perUser: readPositiveInteger(environment.MAX_QUEUE_PER_USER, 25, 500),
  batch: readPositiveInteger(environment.MAX_QUEUE_BATCH, 50, 500)
});

export const selectNextFairTask = <T extends FairQueueCandidate>(
  pending: T[],
  lastServedByUser: ReadonlyMap<string, number>
): T | null => {
  const headByUser = new Map<string, T>();
  pending.forEach(candidate => {
    const current = headByUser.get(candidate.userId);
    if (candidate.userId && (!current
      || candidate.createdAt < current.createdAt
      || (candidate.createdAt === current.createdAt && candidate.id < current.id))) {
      headByUser.set(candidate.userId, candidate);
    }
  });

  return [...headByUser.values()].sort((left, right) => {
    const servedDifference = (lastServedByUser.get(left.userId) || 0) - (lastServedByUser.get(right.userId) || 0);
    return servedDifference || left.createdAt - right.createdAt || left.id - right.id;
  })[0] || null;
};
