import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language, LuckyReference, PromptTag } from '../../types';
import { getFullImageUrl } from '../../services/api';
import { RefreshIcon, XIcon } from '../ui/Icons';
import './LuckyReferencesModal.css';

interface LuckyReferencesModalProps {
  keywords: string;
  references: LuckyReference[];
  totalCandidates: number;
  lang: Language;
  t: Record<string, string>;
  busy: boolean;
  rerollingId: string | null;
  guidance: string;
  activeTagSlug: string;
  onGuidanceChange: (value: string) => void;
  onTagSelect: (tagSlug: string) => void;
  onClose: () => void;
  onRerollAll: () => void;
  onRerollOne: (messageId: string) => void;
  onCreate: () => void;
}

interface ScrollableLuckyTagsProps {
  tags: PromptTag[];
  lang: Language;
  activeTagSlug: string;
  busy: boolean;
  filterLabel: string;
  onTagSelect: (tagSlug: string) => void;
}

const ScrollableLuckyTags = ({
  tags,
  lang,
  activeTagSlug,
  busy,
  filterLabel,
  onTagSelect,
}: ScrollableLuckyTagsProps) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; scrollLeft: number; pointerId: number } | null>(null);
  const didDragRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  const updateScrollEdges = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setScrollEdges({
      left: row.scrollLeft > 2,
      right: row.scrollLeft + row.clientWidth < row.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    updateScrollEdges();
    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(row);
    return () => observer.disconnect();
  }, [tags, updateScrollEdges]);

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    updateScrollEdges();
  };

  return (
    <div className={`lucky-reference-tags-shell ${scrollEdges.left ? 'can-scroll-left' : ''} ${scrollEdges.right ? 'can-scroll-right' : ''}`}>
      <div
        ref={rowRef}
        className={`lucky-reference-tags ${dragging ? 'is-dragging' : ''}`}
        onScroll={updateScrollEdges}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          dragRef.current = { x: event.clientX, scrollLeft: event.currentTarget.scrollLeft, pointerId: event.pointerId };
          didDragRef.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const distance = event.clientX - drag.x;
          if (Math.abs(distance) > 4) didDragRef.current = true;
          event.currentTarget.scrollLeft = drag.scrollLeft - distance;
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onWheel={(event) => {
          const row = event.currentTarget;
          const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
          const canMove = (delta > 0 && row.scrollLeft + row.clientWidth < row.scrollWidth - 1)
            || (delta < 0 && row.scrollLeft > 1);
          if (!canMove) return;
          event.preventDefault();
          row.scrollLeft += delta;
          updateScrollEdges();
        }}
      >
        {tags.map((tag) => (
          <button
            type="button"
            key={tag.slug}
            className={activeTagSlug === tag.slug ? 'active' : ''}
            onClick={() => {
              if (didDragRef.current) {
                didDragRef.current = false;
                return;
              }
              onTagSelect(tag.slug);
            }}
            disabled={busy}
            title={filterLabel}
            aria-label={`${filterLabel}: ${lang === 'fr' ? tag.labelFr : tag.labelEn}`}
          >
            {lang === 'fr' ? tag.labelFr : tag.labelEn}
          </button>
        ))}
      </div>
    </div>
  );
};

export const LuckyReferencesModal = ({
  keywords,
  references,
  totalCandidates,
  lang,
  t,
  busy,
  rerollingId,
  guidance,
  activeTagSlug,
  onGuidanceChange,
  onTagSelect,
  onClose,
  onRerollAll,
  onRerollOne,
  onCreate,
}: LuckyReferencesModalProps) => {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  return (
  <div className="lucky-reference-overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section className="lucky-reference-modal" role="dialog" aria-modal="true" aria-labelledby="lucky-reference-title">
      <header className="lucky-reference-header">
        <div>
          <span className="lucky-reference-eyebrow">{t.luckyPrompt}</span>
          <h2 id="lucky-reference-title">{t.luckyReferencesTitle}</h2>
        </div>
        <button className="lucky-reference-close" type="button" onClick={onClose} disabled={busy} aria-label={t.close}>
          <XIcon size={19} />
        </button>
      </header>

      <div className="lucky-reference-summary">
        <strong>{references.length} {references.length === 1 ? t.reference : t.references}</strong>
        <span>{totalCandidates} {totalCandidates === 1 ? t.matchingPrompt : t.matchingPrompts}</span>
        {keywords.trim() && <span className="lucky-reference-query">/luck {keywords.trim()}</span>}
      </div>
      <p className="lucky-reference-help">{t.luckyReferencesHelp}</p>
      <label className="lucky-reference-guidance">
        <span>{t.luckyGuidanceLabel}</span>
        <input
          type="text"
          value={guidance}
          onChange={(event) => onGuidanceChange(event.target.value)}
          placeholder={t.luckyGuidancePlaceholder}
          maxLength={400}
          disabled={busy}
        />
        <small>{t.luckyGuidanceHelp}</small>
      </label>

      <div className="lucky-reference-grid">
        {references.map((reference, index) => (
          <article className="lucky-reference-card" key={reference.messageId}>
            <div className="lucky-reference-image-wrap">
              <img
                src={getFullImageUrl(reference.thumbnailUrl || reference.imageUrl)}
                alt={`${t.reference} ${index + 1}`}
                className="lucky-reference-image"
              />
              <span className="lucky-reference-index">{index + 1}</span>
              {reference.isFavorite === 1 && <span className="lucky-reference-favorite">♥</span>}
              <button
                type="button"
                className="lucky-reference-reroll-one"
                onClick={() => onRerollOne(reference.messageId)}
                disabled={busy}
                aria-label={t.luckyRerollOne}
                title={t.luckyRerollOne}
              >
                <RefreshIcon size={16} className={rerollingId === reference.messageId ? 'spinning' : undefined} />
              </button>
            </div>
            <div className="lucky-reference-card-body">
              <ScrollableLuckyTags
                tags={reference.tags.filter((tag) => (
                  tag.category !== 'subject'
                  && tag.category !== 'count'
                  && tag.slug !== 'photorealistic'
                ))}
                lang={lang}
                activeTagSlug={activeTagSlug}
                busy={busy}
                filterLabel={t.luckyFilterByTag}
                onTagSelect={onTagSelect}
              />
              <p title={reference.prompt}>{reference.prompt}</p>
            </div>
          </article>
        ))}
      </div>

      <footer className="lucky-reference-actions">
        <button type="button" className="lucky-reference-secondary" onClick={onRerollAll} disabled={busy}>
          <RefreshIcon size={17} className={rerollingId === 'all' ? 'spinning' : undefined} />
          {t.luckyRerollAll}
        </button>
        <button type="button" className="lucky-reference-primary" onClick={onCreate} disabled={busy || references.length === 0}>
          {busy && rerollingId === null ? <span className="lucky-reference-spinner" /> : null}
          {busy && rerollingId === null ? t.luckyPromptCreating : t.luckyCreate}
        </button>
      </footer>
    </section>
  </div>
  );
};
