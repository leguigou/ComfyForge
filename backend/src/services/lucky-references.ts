export interface LuckyReferenceTag {
  slug: string;
  category: string;
  labelFr: string;
  labelEn: string;
}

export interface LuckyReferenceCandidate {
  messageId: string;
  prompt: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  timestamp: number;
  isFavorite?: number;
  usageCount?: number;
  tags: LuckyReferenceTag[];
}

const GENERIC_TAG_CATEGORIES = new Set(['subject', 'count']);
const GENERIC_TAG_SLUGS = new Set(['photorealistic']);
const GENERIC_PROMPT_WORDS = new Set([
  'a', 'an', 'and', 'avec', 'de', 'des', 'du', 'et', 'femme', 'femmes', 'for', 'girl',
  'girls', 'in', 'la', 'le', 'les', 'of', 'on', 'photo', 'photograph', 'portrait', 'the',
  'une', 'un', 'woman', 'women', 'young'
]);

export const meaningfulTagSlugs = (candidate: LuckyReferenceCandidate) => new Set(
  candidate.tags
    .filter(tag => !GENERIC_TAG_CATEGORIES.has(tag.category) && !GENERIC_TAG_SLUGS.has(tag.slug))
    .map(tag => tag.slug)
);

const promptTokens = (prompt: string) => new Set(
  prompt
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]+/g)
    ?.filter(token => token.length > 2 && !GENERIC_PROMPT_WORDS.has(token)) || []
);

export const promptSimilarity = (left: string, right: string) => {
  const leftTokens = promptTokens(left);
  const rightTokens = promptTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
};

export const shareMeaningfulTag = (
  left: LuckyReferenceCandidate,
  right: LuckyReferenceCandidate
) => {
  const leftTags = meaningfulTagSlugs(left);
  return [...meaningfulTagSlugs(right)].some(tag => leftTags.has(tag));
};

const candidateWeight = (candidate: LuckyReferenceCandidate, now: number) => {
  const favoriteBoost = candidate.isFavorite === 1 ? 2 : 1;
  const reuseBoost = 1 + Math.min(1.5, Math.max(0, (candidate.usageCount || 1) - 1) * 0.25);
  const ageDays = Math.max(0, now - candidate.timestamp) / 86_400_000;
  const recencyFactor = ageDays < 7 ? 0.68 : ageDays < 30 ? 0.84 : 1;
  return favoriteBoost * reuseBoost * recencyFactor;
};

const weightedShuffle = (
  candidates: LuckyReferenceCandidate[],
  random: () => number,
  now: number
) => [...candidates]
  .map(candidate => ({
    candidate,
    order: Math.pow(Math.max(Number.EPSILON, random()), 1 / candidateWeight(candidate, now))
  }))
  .sort((left, right) => right.order - left.order)
  .map(item => item.candidate);

const canJoinSelection = (
  candidate: LuckyReferenceCandidate,
  selected: LuckyReferenceCandidate[]
) => selected.some(reference => shareMeaningfulTag(candidate, reference))
  && selected.every(reference => promptSimilarity(candidate.prompt, reference.prompt) < 0.72);

export const selectLuckyReferences = (
  candidates: LuckyReferenceCandidate[],
  count: number,
  options: {
    anchors?: LuckyReferenceCandidate[];
    excludeIds?: string[];
    random?: () => number;
    now?: number;
  } = {}
) => {
  const anchors = options.anchors || [];
  const excluded = new Set(options.excludeIds || []);
  const random = options.random || Math.random;
  const now = options.now || Date.now();
  const pool = candidates.filter(candidate => (
    !excluded.has(candidate.messageId)
    && !anchors.some(anchor => anchor.messageId === candidate.messageId)
  ));
  const ordered = weightedShuffle(pool, random, now);

  if (anchors.length > 0) {
    return ordered
      .filter(candidate => canJoinSelection(candidate, anchors))
      .slice(0, Math.max(1, count));
  }

  let best: LuckyReferenceCandidate[] = [];
  for (const seed of ordered) {
    const selection = [seed];
    for (const candidate of ordered) {
      if (selection.length >= count) break;
      if (candidate.messageId === seed.messageId) continue;
      if (canJoinSelection(candidate, selection)) selection.push(candidate);
    }
    if (selection.length > best.length) best = selection;
    if (best.length >= count) break;
  }

  return best.length >= 2 ? best : [];
};

export const matchingReferenceTags = (
  candidate: LuckyReferenceCandidate,
  references: LuckyReferenceCandidate[]
) => {
  const others = references.filter(reference => reference.messageId !== candidate.messageId);
  const commonSlugs = new Set<string>();
  const candidateTags = meaningfulTagSlugs(candidate);
  others.forEach(reference => {
    meaningfulTagSlugs(reference).forEach(slug => {
      if (candidateTags.has(slug)) commonSlugs.add(slug);
    });
  });
  return candidate.tags.filter(tag => commonSlugs.has(tag.slug));
};
