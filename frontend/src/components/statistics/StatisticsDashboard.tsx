import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../../services/api';
import type { Language } from '../../types';
import './StatisticsDashboard.css';
import { CheckIcon, EyeIcon, SparklesIcon } from '../ui/Icons';

type Period = 'week' | 'month' | 'year';
type ChartMode = 'activity' | 'models' | 'llm' | 'favorites';
type TagScope = 'all' | 'favorites' | 'liked';

interface StatisticsData {
  range: { start: number; end: number; granularity: 'day' | 'month'; llmCoverageStart: number };
  overview: {
    images: number; attempts: number; failed: number; successRate: number; averageDuration: number;
    conversations: number; previousImages: number; previousAverageDuration: number;
  };
  totals: { images: number; conversations: number; favorites: number; likedPrompts: number; firstGenerationAt: number | null };
  series: Array<{ key: string; images: number; attempts: number; averageDuration: number }>;
  comparisonSeries: {
    models: Array<{ name: string; points: Array<{ key: string; value: number }> }>;
    llm: Array<{ key: string; prompt: number; vision: number }>;
    favorites: Array<{ key: string; favorites: number; likedPrompts: number }>;
  };
  models: Array<{ name: string; uses: number; averageDuration: number | null; favorites: number; lastUsedAt: number }>;
  workflows: Array<{ name: string; uses: number; averageDuration: number | null }>;
  tags: Array<{ slug: string; category: string; labelFr: string; labelEn: string; uses: number; prompts: number; favorites: number; likedPrompts: number; lastUsedAt: number }>;
  llm: Array<{ kind: 'prompt' | 'vision'; model: string; calls: number; failures: number; averageDurationMs: number | null }>;
}

const copy = {
  fr: {
    eyebrow: 'VUE D’ENSEMBLE', title: 'Statistiques', subtitle: 'Comprenez vos habitudes de création et les performances de votre installation.',
    week: 'Semaine', month: 'Mois', year: 'Année', generated: 'Images générées', avgTime: 'Temps moyen',
    success: 'Taux de réussite', conversations: 'Conversations', vsPrevious: 'vs période précédente',
    activity: 'Activité de génération', activityHelp: 'Images terminées sur la période', images: 'images', attempts: 'tentatives', chartActivity: 'Générations', chartModels: 'Modèles', chartLlm: 'LLM', chartFavorites: 'Favoris',
    allTime: 'Depuis le début', totalImages: 'Images', favorites: 'Favorites', liked: 'Prompts aimés',
    models: 'Modèles utilisés', model: 'Modèle', uses: 'Utilisations', duration: 'Temps moyen', noData: 'Aucune donnée sur cette période',
    tags: 'Analyse des tags', tag: 'Tag', category: 'Catégorie', prompts: 'Prompts associés', lastUse: 'Dernière utilisation', allTags: 'Tous les tags', favoriteTags: 'Tags des images favorites', likedTags: 'Tags des prompts aimés',
    llm: 'Appels LLM', llmHelp: 'Amélioration de prompts et identification d’images', prompt: 'Prompt / créatif', vision: 'Identification image',
    calls: 'Appels', failures: 'Échecs', coverage: 'Données LLM disponibles depuis le', workflows: 'Workflows',
    loading: 'Calcul des statistiques…', error: 'Impossible de charger les statistiques.', retry: 'Réessayer', today: 'Aujourd’hui',
  },
  en: {
    eyebrow: 'OVERVIEW', title: 'Statistics', subtitle: 'Understand your creative habits and your setup performance.',
    week: 'Week', month: 'Month', year: 'Year', generated: 'Images generated', avgTime: 'Average time',
    success: 'Success rate', conversations: 'Conversations', vsPrevious: 'vs previous period',
    activity: 'Generation activity', activityHelp: 'Completed images over the period', images: 'images', attempts: 'attempts', chartActivity: 'Generations', chartModels: 'Models', chartLlm: 'LLM', chartFavorites: 'Favorites',
    allTime: 'All time', totalImages: 'Images', favorites: 'Favorites', liked: 'Liked prompts',
    models: 'Models used', model: 'Model', uses: 'Uses', duration: 'Average time', noData: 'No data for this period',
    tags: 'Tag analysis', tag: 'Tag', category: 'Category', prompts: 'Associated prompts', lastUse: 'Last used', allTags: 'All tags', favoriteTags: 'Favorite image tags', likedTags: 'Liked prompt tags',
    llm: 'LLM calls', llmHelp: 'Prompt enhancement and image identification', prompt: 'Prompt / creative', vision: 'Image identification',
    calls: 'Calls', failures: 'Failures', coverage: 'LLM data available since', workflows: 'Workflows',
    loading: 'Computing statistics…', error: 'Unable to load statistics.', retry: 'Retry', today: 'Today',
  },
};

const startOfWeek = (date: Date) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
};

const getRange = (period: Period, offset: number) => {
  const now = new Date();
  if (period === 'week') {
    const start = startOfWeek(now);
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return { start, end, granularity: 'day' as const };
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { start, end, granularity: 'day' as const };
  }
  const start = new Date(now.getFullYear() + offset, 0, 1);
  const end = new Date(start.getFullYear() + 1, 0, 1);
  return { start, end, granularity: 'month' as const };
};

const formatSeconds = (value: number | null | undefined) => {
  const seconds = Math.round(value || 0);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
};

const delta = (current: number, previous: number, inverse = false) => {
  if (!previous) return null;
  const value = ((current - previous) / previous) * 100;
  return { value: Math.abs(value), good: inverse ? value <= 0 : value >= 0, up: value >= 0 };
};

const Trend = ({ current, previous, inverse, label }: { current: number; previous: number; inverse?: boolean; label: string }) => {
  const change = delta(current, previous, inverse);
  if (!change) return <span className="stat-trend neutral">— {label}</span>;
  return <span className={`stat-trend ${change.good ? 'positive' : 'negative'}`}>{change.up ? '↗' : '↘'} {change.value.toFixed(0)}% {label}</span>;
};

const ActivityChart = ({ data, lang }: { data: StatisticsData['series']; lang: Language }) => {
  const width = 760; const height = 220; const padding = 24;
  const max = Math.max(1, ...data.map(point => point.images));
  const points = data.map((point, index) => {
    const x = data.length <= 1 ? width / 2 : padding + index * ((width - padding * 2) / (data.length - 1));
    const y = height - padding - (point.images / max) * (height - padding * 2);
    return { ...point, x, y };
  });
  const path = points.map(point => `${point.x},${point.y}`).join(' ');
  const area = points.length ? `${padding},${height - padding} ${path} ${points.at(-1)!.x},${height - padding}` : '';
  const formatter = new Intl.DateTimeFormat(lang, data.length > 40 ? { month: 'short' } : { day: 'numeric', month: 'short' });

  return (
    <div className="activity-chart-wrap">
      {data.length === 0 ? <div className="stats-empty">—</div> : (
        <svg className="activity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Generation activity chart" preserveAspectRatio="none">
          {[0, .25, .5, .75, 1].map(ratio => <line key={ratio} x1={padding} x2={width - padding} y1={padding + ratio * (height - padding * 2)} y2={padding + ratio * (height - padding * 2)} />)}
          <polygon className="chart-area" points={area} />
          <polyline className="chart-line" points={path} />
          {points.map(point => <g key={point.key}><circle cx={point.x} cy={point.y} r="4"><title>{point.key}: {point.images}</title></circle></g>)}
        </svg>
      )}
      {data.length > 0 && <div className="chart-labels">
        {data.filter((_, index) => index === 0 || index === data.length - 1 || (data.length <= 12 && index % Math.ceil(data.length / 6) === 0)).map(point => (
          <span key={point.key}>{formatter.format(new Date(`${point.key}${point.key.length === 7 ? '-01' : ''}T12:00:00`))}</span>
        ))}
      </div>}
    </div>
  );
};

// Okabe-Ito-inspired palette: high contrast and distinguishable for the most
// common forms of colour-vision deficiency. Line patterns and marker shapes
// provide a second, non-colour cue.
const CHART_COLORS = ['#56B4E9', '#E69F00', '#009E73', '#F0E442', '#CC79A7', '#D55E00', '#7F8CFF', '#6B7280'];
const CHART_DASHES = ['', '9 6', '3 5', '12 5 3 5'];

const ComparisonChart = ({ keys, series, lang }: {
  keys: string[];
  series: Array<{ name: string; color?: string; values: number[] }>;
  lang: Language;
}) => {
  const width = 760; const height = 220; const padding = 24;
  const max = Math.max(1, ...series.flatMap(item => item.values));
  const pointFor = (value: number, index: number) => ({
    x: keys.length <= 1 ? width / 2 : padding + index * ((width - padding * 2) / (keys.length - 1)),
    y: height - padding - (value / max) * (height - padding * 2),
  });
  const formatter = new Intl.DateTimeFormat(lang, keys.length > 40 ? { month: 'short' } : { day: 'numeric', month: 'short' });
  return <div className="activity-chart-wrap comparison-chart-wrap">
    <div className="chart-legend">{series.map((item, index) => {
      const color = item.color || CHART_COLORS[index % CHART_COLORS.length];
      return <span key={item.name}><i className={`legend-line pattern-${index % 4}`} style={{ borderTopColor: color }} /><b className={`legend-marker marker-${index % 4}`} style={{ borderColor: color, color }} />{item.name}</span>;
    })}</div>
    {series.length === 0 ? <div className="stats-empty">—</div> : <svg className="activity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Comparison chart" preserveAspectRatio="none">
      {[0, .25, .5, .75, 1].map(ratio => <line key={ratio} x1={padding} x2={width - padding} y1={padding + ratio * (height - padding * 2)} y2={padding + ratio * (height - padding * 2)} />)}
      {series.map((item, seriesIndex) => {
        const color = item.color || CHART_COLORS[seriesIndex % CHART_COLORS.length];
        const points = item.values.map((value, index) => ({ ...pointFor(value, index), value, key: keys[index] }));
        return <g key={item.name} style={{ color }}>
          <polyline className="comparison-line" strokeDasharray={CHART_DASHES[seriesIndex % CHART_DASHES.length]} points={points.map(point => `${point.x},${point.y}`).join(' ')} />
          {points.map(point => {
            const marker = seriesIndex % 4;
            const title = <title>{item.name} · {point.key}: {point.value}</title>;
            if (marker === 1) return <rect key={point.key} className="comparison-point" x={point.x - 3.2} y={point.y - 3.2} width="6.4" height="6.4">{title}</rect>;
            if (marker === 2) return <polygon key={point.key} className="comparison-point" points={`${point.x},${point.y - 4} ${point.x + 4},${point.y} ${point.x},${point.y + 4} ${point.x - 4},${point.y}`}>{title}</polygon>;
            if (marker === 3) return <polygon key={point.key} className="comparison-point" points={`${point.x},${point.y - 4.3} ${point.x + 4.2},${point.y + 3.4} ${point.x - 4.2},${point.y + 3.4}`}>{title}</polygon>;
            return <circle key={point.key} className="comparison-point" cx={point.x} cy={point.y} r="3.3">{title}</circle>;
          })}
        </g>;
      })}
    </svg>}
    {keys.length > 0 && <div className="chart-labels">{keys.filter((_, index) => index === 0 || index === keys.length - 1 || (keys.length <= 12 && index % Math.ceil(keys.length / 6) === 0)).map(key => <span key={key}>{formatter.format(new Date(`${key}${key.length === 7 ? '-01' : ''}T12:00:00`))}</span>)}</div>}
  </div>;
};

export const StatisticsDashboard = ({ lang }: { lang: Language }) => {
  const t = copy[lang];
  const [period, setPeriod] = useState<Period>('week');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [tagCategory, setTagCategory] = useState('all');
  const [chartMode, setChartMode] = useState<ChartMode>('activity');
  const [tagScope, setTagScope] = useState<TagScope>('all');
  const range = useMemo(() => getRange(period, offset), [period, offset]);
  const rangeStart = range.start.getTime();
  const rangeEnd = range.end.getTime();
  const granularity = range.granularity;

  const load = useCallback(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    const params = new URLSearchParams({
      start: String(rangeStart), end: String(rangeEnd), granularity,
      timezoneOffset: String(new Date().getTimezoneOffset()),
    });
    fetch(`${API_BASE}/api/statistics?${params}`, { credentials: 'include', signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Statistics request failed'); return response.json(); })
      .then(setData).catch(err => { if (err.name !== 'AbortError') setError(true); }).finally(() => setLoading(false));
    return controller;
  }, [granularity, rangeEnd, rangeStart]);

  useEffect(() => { const controller = load(); return () => controller.abort(); }, [load]);

  const periodLabel = new Intl.DateTimeFormat(lang, period === 'year'
    ? { year: 'numeric' }
    : period === 'month' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }
  ).formatRange(range.start, new Date(range.end.getTime() - 1));
  const categories = data ? [...new Set(data.tags.map(tag => tag.category))].sort() : [];
  const visibleTags = (data?.tags.filter(tag => (tagCategory === 'all' || tag.category === tagCategory)
    && `${tag.labelFr} ${tag.labelEn} ${tag.slug}`.toLowerCase().includes(tagSearch.toLowerCase())
    && (tagScope === 'all' || (tagScope === 'favorites' ? tag.favorites > 0 : tag.likedPrompts > 0))) || [])
    .sort((a, b) => tagScope === 'favorites' ? b.favorites - a.favorites : tagScope === 'liked' ? b.likedPrompts - a.likedPrompts : b.uses - a.uses);
  const maxModelUses = Math.max(1, ...(data?.models.map(model => model.uses) || []));
  const llmCalls = data?.llm.reduce((sum, item) => sum + item.calls, 0) || 0;
  const chartData = useMemo(() => {
    if (!data) return [];
    const values = new Map(data.series.map(item => [item.key, item]));
    const result: StatisticsData['series'] = [];
    const cursor = new Date(rangeStart);
    while (cursor.getTime() < rangeEnd) {
      const key = granularity === 'month'
        ? `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
        : `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      result.push(values.get(key) || { key, images: 0, attempts: 0, averageDuration: 0 });
      if (granularity === 'month') cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }, [data, granularity, rangeEnd, rangeStart]);
  const comparisonChart = useMemo(() => {
    if (!data) return [];
    const keys = chartData.map(point => point.key);
    if (chartMode === 'models') return data.comparisonSeries.models.map(model => {
      const values = new Map(model.points.map(point => [point.key, point.value]));
      return { name: model.name, values: keys.map(key => values.get(key) || 0) };
    });
    if (chartMode === 'llm') {
      const values = new Map(data.comparisonSeries.llm.map(point => [point.key, point]));
      return [{ name: t.prompt, color: '#E69F00', values: keys.map(key => values.get(key)?.prompt || 0) }, { name: t.vision, color: '#56B4E9', values: keys.map(key => values.get(key)?.vision || 0) }];
    }
    if (chartMode === 'favorites') {
      const values = new Map(data.comparisonSeries.favorites.map(point => [point.key, point]));
      return [{ name: t.favorites, color: '#CC79A7', values: keys.map(key => values.get(key)?.favorites || 0) }, { name: t.liked, color: '#009E73', values: keys.map(key => values.get(key)?.likedPrompts || 0) }];
    }
    return [];
  }, [chartData, chartMode, data, t.favorites, t.liked, t.prompt, t.vision]);

  return (
    <section className="statistics-dashboard">
      <div className="statistics-inner">
        <div className="statistics-heading">
          <div><span className="statistics-eyebrow">{t.eyebrow}</span><h1>{t.title}</h1><p>{t.subtitle}</p></div>
          <div className="period-controls">
            <div className="period-tabs" role="tablist">{(['week', 'month', 'year'] as Period[]).map(item => <button key={item} className={period === item ? 'active' : ''} onClick={() => { setPeriod(item); setOffset(0); }}>{t[item]}</button>)}</div>
            <div className="date-navigation"><button onClick={() => setOffset(value => value - 1)} aria-label="Previous period">‹</button><strong>{periodLabel}</strong><button disabled={offset === 0} onClick={() => setOffset(value => value + 1)} aria-label="Next period">›</button></div>
          </div>
        </div>

        {loading && !data ? <div className="stats-state"><span className="stats-loader" />{t.loading}</div> : error && !data ? <div className="stats-state error">{t.error}<button onClick={load}>{t.retry}</button></div> : data && <>
          <div className="metric-grid">
            <article className="metric-card accent"><div className="metric-icon">▧</div><span>{t.generated}</span><strong>{data.overview.images.toLocaleString(lang)}</strong><Trend current={data.overview.images} previous={data.overview.previousImages} label={t.vsPrevious} /></article>
            <article className="metric-card"><div className="metric-icon violet">◷</div><span>{t.avgTime}</span><strong>{formatSeconds(data.overview.averageDuration)}</strong><Trend current={data.overview.averageDuration} previous={data.overview.previousAverageDuration} inverse label={t.vsPrevious} /></article>
            <article className="metric-card"><div className="metric-icon blue"><CheckIcon size={17} /></div><span>{t.success}</span><strong>{(data.overview.successRate * 100).toFixed(1)}%</strong><small>{data.overview.failed} {t.failures.toLowerCase()} · {data.overview.attempts} {t.attempts}</small></article>
            <article className="metric-card"><div className="metric-icon amber">⌁</div><span>{t.conversations}</span><strong>{data.overview.conversations.toLocaleString(lang)}</strong><small>{data.overview.attempts} {t.attempts}</small></article>
          </div>

          <div className="dashboard-grid main-row">
            <article className="dashboard-card activity-card">
              <div className="card-heading chart-card-heading"><div><h2>{t.activity}</h2><p>{t.activityHelp}</p></div><div className="chart-mode-tabs">{(['activity', 'models', 'llm', 'favorites'] as ChartMode[]).map(mode => <button key={mode} className={chartMode === mode ? 'active' : ''} onClick={() => setChartMode(mode)}>{mode === 'activity' ? t.chartActivity : mode === 'models' ? t.chartModels : mode === 'llm' ? t.chartLlm : t.chartFavorites}</button>)}</div></div>
              <div className="activity-total"><strong>{data.overview.images}</strong><span>{t.images}</span></div>
              {chartMode === 'activity' ? <ActivityChart data={chartData} lang={lang} /> : <ComparisonChart keys={chartData.map(point => point.key)} series={comparisonChart} lang={lang} />}
            </article>
            <article className="dashboard-card lifetime-card">
              <div className="card-heading"><div><h2>{t.allTime}</h2><p>{data.totals.firstGenerationAt ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(data.totals.firstGenerationAt) : '—'}</p></div><span className="pulse-dot" /></div>
              <div className="lifetime-number">{data.totals.images.toLocaleString(lang)}<span>{t.totalImages}</span></div>
              <div className="lifetime-stats"><div><strong>{data.totals.conversations}</strong><span>{t.conversations}</span></div><div><strong>{data.totals.favorites}</strong><span>{t.favorites}</span></div><div><strong>{data.totals.likedPrompts}</strong><span>{t.liked}</span></div></div>
            </article>
          </div>

          <div className="dashboard-grid detail-row">
            <article className="dashboard-card models-card">
              <div className="card-heading"><div><h2>{t.models}</h2><p>{data.models.length} {t.models.toLowerCase()}</p></div></div>
              {data.models.length ? <div className="model-list">{data.models.slice(0, 8).map((model, index) => <div className="model-row" key={model.name}>
                <span className="model-rank">{String(index + 1).padStart(2, '0')}</span><div className="model-info"><strong title={model.name}>{model.name}</strong><div className="usage-track"><i style={{ width: `${model.uses / maxModelUses * 100}%` }} /></div></div><div className="model-numbers"><strong>{model.uses}</strong><span>{formatSeconds(model.averageDuration)}</span></div>
              </div>)}</div> : <div className="stats-empty">{t.noData}</div>}
            </article>
            <article className="dashboard-card llm-card">
              <div className="card-heading"><div><h2>{t.llm}</h2><p>{t.llmHelp}</p></div><span className="llm-total">{llmCalls}</span></div>
              {data.llm.length ? <div className="llm-list">{data.llm.map(item => <div className="llm-row" key={`${item.kind}-${item.model}`}><div className={`llm-kind ${item.kind}`}>{item.kind === 'vision' ? <EyeIcon size={17} /> : <SparklesIcon size={17} />}</div><div><strong>{item.kind === 'vision' ? t.vision : t.prompt}</strong><span>{item.model}</span></div><div><strong>{item.calls}</strong><span>{formatSeconds((item.averageDurationMs || 0) / 1000)}</span></div></div>)}</div> : <div className="stats-empty">{t.noData}</div>}
              <p className="coverage-note">ⓘ {t.coverage} {new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(data.range.llmCoverageStart)}</p>
              {data.workflows.length > 0 && <div className="workflow-strip"><span>{t.workflows}</span>{data.workflows.slice(0, 3).map(workflow => <span className="workflow-chip" key={workflow.name} title={workflow.name}>{workflow.name} · {workflow.uses}</span>)}</div>}
            </article>
          </div>

          <article className="dashboard-card tags-card">
            <div className="card-heading tags-heading"><div><h2>{t.tags}</h2><p>{data.tags.length} tags · {data.tags.reduce((sum, tag) => sum + tag.uses, 0)} {t.uses.toLowerCase()}</p></div><div className="tag-filters"><div className="tag-scope-tabs">{(['all', 'favorites', 'liked'] as TagScope[]).map(scope => <button key={scope} className={tagScope === scope ? 'active' : ''} onClick={() => setTagScope(scope)}>{scope === 'all' ? t.allTags : scope === 'favorites' ? t.favoriteTags : t.likedTags}</button>)}</div><div className="tag-filter-fields"><input value={tagSearch} onChange={event => setTagSearch(event.target.value)} placeholder={lang === 'fr' ? 'Rechercher un tag…' : 'Search tags…'} /><select value={tagCategory} onChange={event => setTagCategory(event.target.value)}><option value="all">{lang === 'fr' ? 'Toutes les catégories' : 'All categories'}</option>{categories.map(category => <option key={category}>{category}</option>)}</select></div></div></div>
            {visibleTags.length ? <div className="tags-table-wrap"><table><thead><tr><th>{t.tag}</th><th>{t.category}</th><th>{t.uses}</th><th>{t.prompts}</th><th>{t.favorites}</th><th>{t.liked}</th><th>{t.lastUse}</th></tr></thead><tbody>{visibleTags.map((tag, index) => <tr key={tag.slug}><td><span className="tag-rank">#{index + 1}</span><strong>{lang === 'fr' ? tag.labelFr : tag.labelEn}</strong></td><td><span className="category-pill">{tag.category}</span></td><td><strong>{tagScope === 'favorites' ? tag.favorites : tagScope === 'liked' ? tag.likedPrompts : tag.uses}</strong></td><td>{tag.prompts}</td><td>{tag.favorites}</td><td>{tag.likedPrompts}</td><td>{new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(tag.lastUsedAt)}</td></tr>)}</tbody></table></div> : <div className="stats-empty">{t.noData}</div>}
          </article>
        </>}
      </div>
    </section>
  );
};
