import seedySpriteUrl from '../../assets/seedy-spritesheet-v4.webp';
import type { CompanionSettings } from '../../types';
import { normalizeCompanionSettings } from '../../utils/companions';
import './SeedyCompanion.css';

type SeedyCompanionState = 'waiting' | 'working' | 'magic';

interface SeedyCompanionProps {
  state: SeedyCompanionState;
  settings?: CompanionSettings;
}

export function SeedyCompanion({ state, settings }: SeedyCompanionProps) {
  const normalizedSettings = normalizeCompanionSettings(settings);
  if (!normalizedSettings.enabled) return null;

  const activeCompanion = normalizedSettings.companions.find(companion => companion.id === normalizedSettings.activeId);
  const spriteUrl = activeCompanion?.source === 'custom' && activeCompanion.spriteDataUrl
    ? activeCompanion.spriteDataUrl
    : seedySpriteUrl;

  return (
    <span
      className={`seedy-companion seedy-companion-${state}`}
      style={{ backgroundImage: `url(${spriteUrl})` }}
      title={activeCompanion?.name}
      aria-hidden="true"
    />
  );
}
