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

export const getPreciseGenerationElapsedSeconds = (
  serverDuration: number | undefined,
  generationStartedAt: number | undefined,
  now: number
) => {
  const liveDuration = generationStartedAt === undefined
    ? 0
    : Math.max(0, (now - generationStartedAt) / 1000);

  return Math.max(1, serverDuration ?? 0, liveDuration);
};

export const getTrackedGenerationElapsedSeconds = (
  serverDuration: number | undefined,
  generationStartedAt: number | undefined,
  trackingStartedAt: number,
  elapsedAtTrackingStart: number,
  now: number
) => {
  if (generationStartedAt !== undefined) {
    return getPreciseGenerationElapsedSeconds(serverDuration, generationStartedAt, now);
  }

  const locallyTrackedDuration = elapsedAtTrackingStart
    + Math.max(0, (now - trackingStartedAt) / 1000);

  return Math.max(1, serverDuration ?? 0, locallyTrackedDuration);
};

export const resolveGenerationStartedAt = (
  status: 'pending' | 'preparing' | 'processing' | 'completed' | 'failed' | undefined,
  loadedStartedAt: number | undefined,
  existingStartedAt: number | undefined,
  now: number,
  duration = 0
) => status === 'processing'
  ? (existingStartedAt ?? (now - Math.max(0, duration) * 1000))
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
