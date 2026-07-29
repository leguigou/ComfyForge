export const getGenerationElapsedSeconds = (
  serverDuration: number | undefined,
  generationStartedAt: number | undefined,
  now: number
) => {
  const liveDuration = generationStartedAt === undefined
    ? 0
    : Math.max(0, Math.floor((now - generationStartedAt) / 1000));

  return Math.max(1, serverDuration ?? 0, liveDuration);
};

export const resolveGenerationStartedAt = (
  status: 'pending' | 'processing' | 'completed' | 'failed' | undefined,
  loadedStartedAt: number | undefined,
  existingStartedAt: number | undefined,
  now: number
) => status === 'processing'
  ? (loadedStartedAt ?? existingStartedAt ?? now)
  : loadedStartedAt;

export const getEstimatedGenerationProgress = (
  elapsedSeconds: number,
  estimatedDurationSeconds: number | undefined
) => {
  if (
    estimatedDurationSeconds === undefined
    || !Number.isFinite(estimatedDurationSeconds)
    || estimatedDurationSeconds <= 0
  ) return undefined;

  const rawProgress = (Math.max(0, elapsedSeconds) / estimatedDurationSeconds) * 100;
  return Math.min(96, Math.max(2, rawProgress));
};
