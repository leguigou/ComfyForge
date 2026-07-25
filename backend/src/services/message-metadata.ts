export const withParsedRandomSelections = <T extends Record<string, unknown>>(message: T) => {
  const rawSelections = message.randomSelections;
  if (typeof rawSelections !== 'string' || !rawSelections) {
    return { ...message, randomSelections: [] };
  }

  try {
    const parsed = JSON.parse(rawSelections);
    return { ...message, randomSelections: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { ...message, randomSelections: [] };
  }
};
