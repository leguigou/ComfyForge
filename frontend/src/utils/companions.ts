import type { CompanionProfile, CompanionSettings } from '../types';

export const DEFAULT_COMPANION_ID = 'seedy-default';

export const DEFAULT_COMPANION: CompanionProfile = {
  id: DEFAULT_COMPANION_ID,
  name: 'Seedy',
  source: 'builtin',
};

export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  enabled: true,
  activeId: DEFAULT_COMPANION_ID,
  companions: [DEFAULT_COMPANION],
};

export const normalizeCompanionSettings = (value?: Partial<CompanionSettings>): CompanionSettings => {
  const storedBuiltin = Array.isArray(value?.companions)
    ? value.companions.find(companion => companion?.id === DEFAULT_COMPANION_ID)
    : undefined;
  const builtinCompanion = {
    ...DEFAULT_COMPANION,
    name: typeof storedBuiltin?.name === 'string' && storedBuiltin.name.trim()
      ? storedBuiltin.name
      : DEFAULT_COMPANION.name,
  };
  const customCompanions = Array.isArray(value?.companions)
    ? value.companions.filter((companion): companion is CompanionProfile => (
        companion?.source === 'custom'
        && typeof companion.id === 'string'
        && companion.id.trim().length > 0
        && typeof companion.name === 'string'
        && (
          (typeof companion.spriteUrl === 'string' && companion.spriteUrl.startsWith('/api/companions/'))
          || (typeof companion.spriteDataUrl === 'string' && companion.spriteDataUrl.startsWith('data:image/'))
        )
      ))
    : [];
  const seenCompanionIds = new Set<string>([DEFAULT_COMPANION_ID]);
  const uniqueCustomCompanions = customCompanions.filter(companion => {
    if (seenCompanionIds.has(companion.id)) return false;
    seenCompanionIds.add(companion.id);
    return true;
  });
  const companions = [builtinCompanion, ...uniqueCustomCompanions];
  const activeId = companions.some(companion => companion.id === value?.activeId)
    ? value!.activeId!
    : DEFAULT_COMPANION_ID;

  return {
    enabled: value?.enabled !== false,
    activeId,
    companions,
  };
};
