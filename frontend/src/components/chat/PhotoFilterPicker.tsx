import { useEffect, useState } from 'react';
import { FilterIcon, XIcon } from '../ui/Icons';
import {
  PHOTO_FILTER_FAMILIES,
  type PhotoFilterPreset,
} from '../../utils/photoFilters';
import type { Language } from '../../types';
import './PhotoFilterPicker.css';

interface PhotoFilterPickerProps {
  lang: Language;
  selected: PhotoFilterPreset | null;
  onSelect: (filter: PhotoFilterPreset | null) => void;
  onClose: () => void;
}

export const PhotoFilterPicker = ({ lang, selected, onSelect, onClose }: PhotoFilterPickerProps) => {
  const [familyId, setFamilyId] = useState(
    selected?.familyId || PHOTO_FILTER_FAMILIES[0].id,
  );
  const activeFamily = PHOTO_FILTER_FAMILIES.find(family => family.id === familyId)
    || PHOTO_FILTER_FAMILIES[0];
  const isFrench = lang === 'fr';

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="photo-filter-overlay" onPointerDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="photo-filter-picker" role="dialog" aria-modal="true" aria-labelledby="photo-filter-title">
        <header className="photo-filter-header">
          <div className="photo-filter-title-wrap">
            <span className="photo-filter-title-icon"><FilterIcon size={20} /></span>
            <div>
              <h2 id="photo-filter-title">{isFrench ? 'Filtres photo' : 'Photo filters'}</h2>
              <p>{isFrench ? 'Le filtre est ajouté uniquement à la prochaine génération.' : 'The filter is added only to the next generation.'}</p>
            </div>
          </div>
          <button type="button" className="photo-filter-close" onClick={onClose} aria-label={isFrench ? 'Fermer' : 'Close'}>
            <XIcon size={20} />
          </button>
        </header>

        <div className="photo-filter-body">
          <nav className="photo-filter-families" aria-label={isFrench ? 'Familles de filtres' : 'Filter families'}>
            {PHOTO_FILTER_FAMILIES.map(group => (
              <button
                key={group.id}
                type="button"
                className={group.id === activeFamily.id ? 'active' : ''}
                onClick={() => setFamilyId(group.id)}
              >
                {isFrench ? group.labelFr : group.labelEn}
              </button>
            ))}
          </nav>

          <div className="photo-filter-presets" role="radiogroup" aria-label={isFrench ? activeFamily.labelFr : activeFamily.labelEn}>
            <button
              type="button"
              role="radio"
              aria-checked={!selected}
              className={`photo-filter-card photo-filter-none ${!selected ? 'selected' : ''}`}
              onClick={() => {
                onSelect(null);
                onClose();
              }}
            >
              <strong>{isFrench ? 'Aucun filtre' : 'No filter'}</strong>
              <span>{isFrench ? 'Le prompt est envoyé sans suffixe photographique.' : 'The prompt is sent without a photographic suffix.'}</span>
            </button>
            {activeFamily.filters.map(filter => (
              <button
                key={filter.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === filter.id}
                className={`photo-filter-card ${selected?.id === filter.id ? 'selected' : ''}`}
                onClick={() => {
                  onSelect(filter);
                  onClose();
                }}
              >
                <strong>{isFrench ? filter.labelFr : filter.labelEn}</strong>
                <span>{isFrench ? filter.descriptionFr : filter.descriptionEn}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default PhotoFilterPicker;
