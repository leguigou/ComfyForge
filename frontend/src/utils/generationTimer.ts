export const getGenerationElapsedSeconds = (
  serverDuration: number | undefined,
  generationStartedAt: number | undefined,
  now: number
) => {
  const liveDuration = generationStartedAt === undefined
    ? 0
    : Math.max(0, Math.floor((now - generationStartedAt) / 1000));

  return Math.max(serverDuration ?? 0, liveDuration);
};

export const resolveGenerationStartedAt = (
  status: 'pending' | 'processing' | 'completed' | 'failed' | undefined,
  loadedStartedAt: number | undefined,
  existingStartedAt: number | undefined,
  now: number
) => status === 'processing'
  ? (loadedStartedAt ?? existingStartedAt ?? now)
  : loadedStartedAt;
