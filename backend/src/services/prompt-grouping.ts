export const DEFAULT_PROMPT_GROUPING_MIN_WORDS = 20;
export const DEFAULT_PROMPT_GROUPING_SIMILARITY = 90;

export interface PromptGroupingSettings {
  minWords: number;
  similarity: number;
}

export interface PromptGroupingItem {
  messageId: string;
  prompt?: unknown;
  generationPrompt?: unknown;
  text?: unknown;
  randomSelections?: unknown;
  manualGroupId?: unknown;
  timestamp?: unknown;
  isGroupCover?: unknown;
  isFavorite?: unknown;
  isPromptFavorite?: unknown;
}

export interface PromptGroup<T extends PromptGroupingItem> {
  items: T[];
  representative: T;
  timestamp: number;
  hasFavorite: number;
  hasPromptFavorite: number;
}

const clampInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
};

export const normalizePromptGroupingSettings = (value?: Record<string, unknown> | null): PromptGroupingSettings => ({
  minWords: clampInteger(value?.galleryPromptSimilarityMinWords, DEFAULT_PROMPT_GROUPING_MIN_WORDS, 2, 200),
  similarity: clampInteger(value?.galleryPromptSimilarityThreshold, DEFAULT_PROMPT_GROUPING_SIMILARITY, 50, 100),
});

export const normalizePromptText = (value: unknown) => (typeof value === 'string' ? value : '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const parseRandomSelections = (value: unknown) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export interface PromptGroupingIdentity {
  kind: 'dynamic' | 'prompt' | 'message';
  normalized: string;
  wordCount: number;
}

const getPromptGroupingMatchKind = (kind: PromptGroupingIdentity['kind']) => (
  kind === 'message' ? 'message' : 'prompt'
);

export const getPromptGroupingIdentity = (item: PromptGroupingItem): PromptGroupingIdentity => {
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
  if (prompt && parseRandomSelections(item.randomSelections).length > 0) {
    const normalized = normalizePromptText(prompt);
    return { kind: 'dynamic', normalized, wordCount: normalized.split(' ').filter(Boolean).length };
  }

  const effective = [item.generationPrompt, item.prompt, item.text]
    .find(value => typeof value === 'string' && value.trim()) as string | undefined;
  const normalized = normalizePromptText(effective);
  if (normalized) return { kind: 'prompt', normalized, wordCount: normalized.split(' ').filter(Boolean).length };
  return { kind: 'message', normalized: String(item.messageId), wordCount: 0 };
};

const wordEditDistance = (left: string[], right: string[]) => {
  if (left.length > right.length) return wordEditDistance(right, left);
  let previous = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let row = 1; row <= right.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= left.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[column - 1] === right[row - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[left.length];
};

export const promptSimilarityPercent = (left: string, right: string) => {
  const leftWords = normalizePromptText(left).split(' ').filter(Boolean);
  const rightWords = normalizePromptText(right).split(' ').filter(Boolean);
  const longest = Math.max(leftWords.length, rightWords.length);
  if (longest === 0) return 100;
  return ((longest - wordEditDistance(leftWords, rightWords)) / longest) * 100;
};

const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

const compareRepresentatives = (left: PromptGroupingItem, right: PromptGroupingItem) => (
  numeric(right.isGroupCover) - numeric(left.isGroupCover)
  || numeric(right.timestamp) - numeric(left.timestamp)
  || String(right.messageId).localeCompare(String(left.messageId))
);

type WorkingGroup<T extends PromptGroupingItem> = { items: T[]; kind: string; prompts: string[] };

const createPromptGroupingProcessor = <T extends PromptGroupingItem>(
  items: T[],
  settings: PromptGroupingSettings,
) => {
  const groups: WorkingGroup<T>[] = [];
  const manualGroups = new Map<string, WorkingGroup<T>>();
  const exactPromptGroups = new Map<string, WorkingGroup<T>>();
  const tokenGroups = new Map<string, Set<WorkingGroup<T>>>();
  const automaticPrompts = new Map<T, ReturnType<typeof getPromptGroupingIdentity>>();
  const documentFrequency = new Map<string, number>();
  for (const item of items) {
    const manualGroupId = typeof item.manualGroupId === 'string' ? item.manualGroupId.trim() : '';
    if (manualGroupId) continue;
    const prompt = getPromptGroupingIdentity(item);
    automaticPrompts.set(item, prompt);
    const matchKind = getPromptGroupingMatchKind(prompt.kind);
    for (const word of new Set(prompt.normalized.split(' ').filter(Boolean))) {
      const key = `${matchKind}:${word}`;
      documentFrequency.set(key, (documentFrequency.get(key) || 0) + 1);
    }
  }
  const indexPrompt = (group: WorkingGroup<T>, prompt: string) => {
    for (const word of new Set(prompt.split(' ').filter(Boolean))) {
      const key = `${group.kind}:${word}`;
      const indexed = tokenGroups.get(key) || new Set<WorkingGroup<T>>();
      indexed.add(group);
      tokenGroups.set(key, indexed);
    }
  };
  const automaticItems = [...items].sort((left, right) => (
    numeric(left.timestamp) - numeric(right.timestamp)
    || String(left.messageId).localeCompare(String(right.messageId))
  ));

  let processed = 0;
  const processNext = () => {
    const item = automaticItems[processed];
    if (!item) return false;
    processed += 1;
    const manualGroupId = typeof item.manualGroupId === 'string' ? item.manualGroupId.trim() : '';
    if (manualGroupId) {
      let group = manualGroups.get(manualGroupId);
      if (!group) {
        group = { items: [], kind: 'manual', prompts: [] };
        manualGroups.set(manualGroupId, group);
        groups.push(group);
      }
      group.items.push(item);
      return true;
    }

    const prompt = automaticPrompts.get(item) || getPromptGroupingIdentity(item);
    const matchKind = getPromptGroupingMatchKind(prompt.kind);
    const promptWords = prompt.normalized.split(' ').filter(Boolean);
    const words = promptWords.length;
    const exactKey = `${matchKind}:${prompt.normalized}`;
    let matchingGroup = exactPromptGroups.get(exactKey);

    if (!matchingGroup && prompt.kind !== 'message' && words >= settings.minWords) {
      let bestScore = -1;
      const threshold = settings.similarity / 100;
      const longestPossibleMatch = Math.floor(words / threshold);
      const maximumAcceptedEdits = Math.floor((1 - threshold) * longestPossibleMatch + 1e-9);
      const distinctWords = [...new Set(promptWords)].sort((left, right) => (
        (documentFrequency.get(`${matchKind}:${left}`) || 0)
        - (documentFrequency.get(`${matchKind}:${right}`) || 0)
      ));
      const anchors = distinctWords.slice(0, maximumAcceptedEdits + 1);
      const candidates = new Set<WorkingGroup<T>>();
      for (const word of anchors) {
        tokenGroups.get(`${matchKind}:${word}`)?.forEach(group => candidates.add(group));
      }
      for (const group of candidates) {
        const comparisons = group.prompts.map(existing => ({
          words: existing.split(' ').filter(Boolean).length,
          score: promptSimilarityPercent(prompt.normalized, existing),
        }));
        if (!comparisons.length || comparisons.some(result => (
          result.words < settings.minWords || result.score < settings.similarity
        ))) continue;
        const score = Math.min(...comparisons.map(result => result.score));
        if (score > bestScore) {
          matchingGroup = group;
          bestScore = score;
        }
      }
    }

    if (matchingGroup) {
      matchingGroup.items.push(item);
      if (!matchingGroup.prompts.includes(prompt.normalized)) {
        matchingGroup.prompts.push(prompt.normalized);
        indexPrompt(matchingGroup, prompt.normalized);
      }
      exactPromptGroups.set(exactKey, matchingGroup);
    } else {
      const group = { items: [item], kind: matchKind, prompts: [prompt.normalized] };
      groups.push(group);
      exactPromptGroups.set(exactKey, group);
      if (prompt.kind !== 'message') indexPrompt(group, prompt.normalized);
    }
    return true;
  };

  const finish = () => groups.map(group => {
    const sortedItems = [...group.items].sort(compareRepresentatives);
    return {
      items: sortedItems,
      representative: sortedItems[0],
      timestamp: Math.max(...group.items.map(item => numeric(item.timestamp))),
      hasFavorite: group.items.some(item => numeric(item.isFavorite) === 1) ? 1 : 0,
      hasPromptFavorite: group.items.some(item => numeric(item.isPromptFavorite) === 1) ? 1 : 0,
    };
  }).sort((left, right) => (
    right.timestamp - left.timestamp
    || String(right.representative.messageId).localeCompare(String(left.representative.messageId))
  ));

  return {
    total: automaticItems.length,
    get processed() { return processed; },
    get groupCount() { return groups.length; },
    processNext,
    finish,
  };
};

export const groupItemsByPrompt = <T extends PromptGroupingItem>(
  items: T[],
  settings: PromptGroupingSettings,
): PromptGroup<T>[] => {
  const processor = createPromptGroupingProcessor(items, settings);
  while (processor.processNext()) { /* synchronous rebuild for startup and tests */ }
  return processor.finish();
};

export interface PromptGroupingProgress {
  processed: number;
  total: number;
  groups: number;
}

export const groupItemsByPromptAsync = async <T extends PromptGroupingItem>(
  items: T[],
  settings: PromptGroupingSettings,
  onProgress?: (progress: PromptGroupingProgress) => void,
  yieldEvery = 20,
): Promise<PromptGroup<T>[]> => {
  const processor = createPromptGroupingProcessor(items, settings);
  onProgress?.({ processed: 0, total: processor.total, groups: 0 });
  while (processor.processed < processor.total) {
    for (let index = 0; index < yieldEvery && processor.processNext(); index += 1) { /* bounded chunk */ }
    onProgress?.({
      processed: processor.processed,
      total: processor.total,
      groups: processor.groupCount,
    });
    if (processor.processed < processor.total) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
  return processor.finish();
};
