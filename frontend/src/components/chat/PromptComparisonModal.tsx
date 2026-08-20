import { useEffect, useMemo, useState } from 'react';
import type { GalleryItem, Language } from '../../types';
import { formatDuration, getFullImageUrl, getThumbnailSrcSet } from '../../services/api';
import { comparePrompts } from '../../utils/promptComparison';
import { TextSelectIcon, XIcon } from '../ui/Icons';

interface PromptComparisonModalProps {
  items: GalleryItem[];
  lang: Language;
  t: Record<string, string>;
  onClose: () => void;
}

const getPrompt = (item: GalleryItem) => (
  item.generationPrompt || item.prompt || item.text || ''
).trim();

const renderMetric = (value: number, lang: Language, suffix = '') => (
  `${value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 1 })}${suffix}`
);

export const PromptComparisonModal = ({ items, lang, t, onClose }: PromptComparisonModalProps) => {
  const [openPromptIds, setOpenPromptIds] = useState<Set<string>>(() => new Set());
  const referencePrompt = getPrompt(items[0]);
  const comparedItems = useMemo(() => items.map((item, index) => ({
    item,
    index,
    prompt: getPrompt(item),
    metrics: comparePrompts(referencePrompt, getPrompt(item)),
  })), [items, referencePrompt]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const togglePrompt = (messageId: string) => {
    setOpenPromptIds(current => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  return (
    <div className="prompt-comparison-backdrop" onPointerDown={onClose}>
      <section
        className="prompt-comparison-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-comparison-title"
        onPointerDown={event => event.stopPropagation()}
      >
        <header className="prompt-comparison-header">
          <div>
            <h2 id="prompt-comparison-title">{t.comparePromptsTitle}</h2>
            <p>{t.comparePromptsIntro}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.close} title={t.close}>
            <XIcon size={21} />
          </button>
        </header>

        <div className="prompt-comparison-scroll" tabIndex={0} aria-label={t.comparePromptsScrollLabel}>
          <div className="prompt-comparison-track">
            {comparedItems.map(({ item, index, prompt, metrics }) => {
              const isReference = index === 0;
              const isPromptOpen = openPromptIds.has(item.messageId);
              const metadata = [
                item.model && [t.model, item.model],
                item.workflow && [t.workflow, item.workflow],
                item.width && item.height && [t.dimensions, `${item.width} × ${item.height}`],
                item.steps !== undefined && [t.steps, String(item.steps)],
                item.cfg !== undefined && ['CFG', String(item.cfg)],
                item.seed !== undefined && [t.seed, String(item.seed)],
                item.duration !== undefined && [t.generationDuration, formatDuration(item.duration)],
              ].filter(Boolean) as string[][];

              return (
                <article className={`prompt-comparison-card ${isReference ? 'is-reference' : ''}`} key={item.messageId}>
                  <div className="prompt-comparison-image-wrap">
                    <img
                      src={getFullImageUrl(item.thumbnailUrl || item.imageUrl)}
                      srcSet={getThumbnailSrcSet(item.thumbnailUrl || item.imageUrl)}
                      sizes="(max-width: 600px) 82vw, 290px"
                      alt={isReference ? t.referenceImage : `${t.comparedImage} ${index}`}
                      loading={index < 3 ? 'eager' : 'lazy'}
                    />
                    <span className="prompt-comparison-position">{index + 1}</span>
                    {isReference && <span className="prompt-comparison-reference">{t.comparisonReference}</span>}
                  </div>

                  <div className="prompt-comparison-card-body">
                    <div className="prompt-comparison-card-title">
                      <strong>{isReference ? t.referenceImage : `${t.comparedImage} ${index}`}</strong>
                      <time dateTime={new Date(item.timestamp).toISOString()}>
                        {new Date(item.timestamp).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </time>
                    </div>

                    <dl className="prompt-comparison-metrics">
                      <div><dt>{t.promptWords}</dt><dd>{metrics.wordCount}</dd></div>
                      <div><dt>{t.promptUniqueWords}</dt><dd>{metrics.uniqueWordCount}</dd></div>
                      <div><dt>{t.promptCharacters}</dt><dd>{metrics.characterCount}</dd></div>
                      <div><dt>{t.promptCommonWords}</dt><dd>{metrics.commonWordCount}</dd></div>
                      <div className="is-positive"><dt>{t.promptSimilarity}</dt><dd>{renderMetric(metrics.similarityPercent, lang, '%')}</dd></div>
                      <div className="is-difference"><dt>{t.promptDifference}</dt><dd>{renderMetric(metrics.differencePercent, lang, '%')}</dd></div>
                      <div><dt>{t.promptAddedWords}</dt><dd>+{metrics.addedWordCount}</dd></div>
                      <div><dt>{t.promptRemovedWords}</dt><dd>−{metrics.removedWordCount}</dd></div>
                      <div><dt>{t.promptLengthRatio}</dt><dd>{renderMetric(metrics.lengthRatio, lang, '×')}</dd></div>
                      <div><dt>{t.promptJaccardIndex}</dt><dd>{renderMetric(metrics.jaccardPercent, lang, '%')}</dd></div>
                      <div><dt>{t.promptLexicalRichness}</dt><dd>{renderMetric(metrics.lexicalRichnessPercent, lang, '%')}</dd></div>
                    </dl>

                    {metadata.length > 0 && (
                      <dl className="prompt-comparison-metadata">
                        {metadata.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                      </dl>
                    )}

                    <button
                      type="button"
                      className="prompt-comparison-prompt-toggle"
                      onClick={() => togglePrompt(item.messageId)}
                      aria-expanded={isPromptOpen}
                      disabled={!prompt}
                    >
                      <TextSelectIcon size={16} />
                      {prompt ? (isPromptOpen ? t.hidePrompt : t.viewPrompt) : t.promptUnavailable}
                    </button>
                    {isPromptOpen && <p className="prompt-comparison-prompt">{prompt}</p>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};
