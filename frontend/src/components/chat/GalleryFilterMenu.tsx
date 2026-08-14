import { useEffect, useState } from 'react';
import { API_BASE } from '../../services/api';
import type { GalleryFilterOptions } from '../../types';
import { XIcon } from '../ui/Icons';

type GalleryAspect = 'square' | 'portrait' | 'landscape';

interface GalleryFilterMenuProps {
  t: Record<string, string>;
  sessionId: string | null;
  includeArchived: boolean;
  models: string[];
  setModels: (values: string[]) => void;
  workflows: string[];
  setWorkflows: (values: string[]) => void;
  aspects: GalleryAspect[];
  setAspects: (values: GalleryAspect[]) => void;
  activeCount: number;
  onClose: () => void;
}

const toggleValue = <T extends string>(value: T, selected: T[], update: (values: T[]) => void) => {
  update(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
};

export const GalleryFilterMenu = ({
  t,
  sessionId,
  includeArchived,
  models,
  setModels,
  workflows,
  setWorkflows,
  aspects,
  setAspects,
  activeCount,
  onClose,
}: GalleryFilterMenuProps) => {
  const [options, setOptions] = useState<GalleryFilterOptions>({
    models: [],
    workflows: [],
    aspects: { square: 0, portrait: 0, landscape: 0 },
  });

  useEffect(() => {
    const query = new URLSearchParams({ includeArchived: String(includeArchived) });
    if (sessionId) query.set('sessionId', sessionId);
    fetch(`${API_BASE}/api/gallery/filters?${query.toString()}`, { credentials: 'include' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then(data => setOptions({
        models: Array.isArray(data?.models) ? data.models : [],
        workflows: Array.isArray(data?.workflows) ? data.workflows : [],
        aspects: {
          square: Number(data?.aspects?.square) || 0,
          portrait: Number(data?.aspects?.portrait) || 0,
          landscape: Number(data?.aspects?.landscape) || 0,
        },
      }))
      .catch(error => console.error('Error fetching gallery filter options:', error));
  }, [includeArchived, sessionId]);

  return (
  <div id="gallery-filter-menu" className="gallery-filter-menu" role="dialog" aria-label={t.contentFilters}>
    <div className="gallery-filter-menu-header">
      <div>
        <strong>{t.contentFilters}</strong>
        <span>{t.combineFiltersHelp}</span>
      </div>
      <div className="gallery-filter-header-actions">
        <button
          type="button"
          className="gallery-filter-reset"
          onClick={() => { setModels([]); setWorkflows([]); setAspects([]); }}
          disabled={activeCount === 0}
        >
          {t.resetFilters}
        </button>
        <button type="button" className="gallery-filter-close" onClick={onClose} aria-label={t.close} title={t.close}>
          <XIcon size={18} />
        </button>
      </div>
    </div>

    <section className="gallery-filter-section">
      <div className="gallery-filter-section-title"><span>{t.imageFormat}</span></div>
      <div className="gallery-aspect-options">
        {(['square', 'portrait', 'landscape'] as const).map(aspect => (
          <button
            type="button"
            key={aspect}
            className={aspects.includes(aspect) ? 'active' : ''}
            onClick={() => toggleValue(aspect, aspects, setAspects)}
            aria-pressed={aspects.includes(aspect)}
            disabled={options.aspects[aspect] === 0}
          >
            <i className={`gallery-aspect-icon ${aspect}`} aria-hidden="true" />
            <span>{t[aspect]}</span>
            <small>{options.aspects[aspect]}</small>
          </button>
        ))}
      </div>
    </section>

    <details className="gallery-filter-section" open>
      <summary>
        <span>{t.model}</span>
        {models.length > 0 && <small>{models.length}</small>}
      </summary>
      <div className="gallery-filter-option-list">
        {options.models.length > 0 ? options.models.map(option => (
          <button
            type="button"
            key={option.value}
            className={models.includes(option.value) ? 'active' : ''}
            onClick={() => toggleValue(option.value, models, setModels)}
            aria-pressed={models.includes(option.value)}
          >
            <span title={option.value}>{option.value}</span>
            <small>{option.count}</small>
            <i aria-hidden="true" />
          </button>
        )) : <p>{t.noFilterOptions}</p>}
      </div>
    </details>

    <details className="gallery-filter-section">
      <summary>
        <span>{t.workflow}</span>
        {workflows.length > 0 && <small>{workflows.length}</small>}
      </summary>
      <div className="gallery-filter-option-list">
        {options.workflows.length > 0 ? options.workflows.map(option => (
          <button
            type="button"
            key={option.value}
            className={workflows.includes(option.value) ? 'active' : ''}
            onClick={() => toggleValue(option.value, workflows, setWorkflows)}
            aria-pressed={workflows.includes(option.value)}
          >
            <span title={option.value}>{option.value}</span>
            <small>{option.count}</small>
            <i aria-hidden="true" />
          </button>
        )) : <p>{t.noFilterOptions}</p>}
      </div>
    </details>
  </div>
  );
};

export default GalleryFilterMenu;
