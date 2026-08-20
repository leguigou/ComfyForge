export interface PromptComparisonMetrics {
  wordCount: number;
  uniqueWordCount: number;
  characterCount: number;
  commonWordCount: number;
  addedWordCount: number;
  removedWordCount: number;
  similarityPercent: number;
  differencePercent: number;
  jaccardPercent: number;
  lengthRatio: number;
  lexicalRichnessPercent: number;
}

const tokenizePrompt = (prompt: string) => prompt
  .normalize('NFKC')
  .toLocaleLowerCase()
  .match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) || [];

const longestCommonSubsequenceLength = (left: string[], right: string[]) => {
  if (left.length > right.length) return longestCommonSubsequenceLength(right, left);

  let previous = new Uint32Array(left.length + 1);
  let current = new Uint32Array(left.length + 1);

  for (const rightWord of right) {
    for (let index = 1; index <= left.length; index += 1) {
      current[index] = left[index - 1] === rightWord
        ? previous[index - 1] + 1
        : Math.max(previous[index], current[index - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }

  return previous[left.length];
};
const roundPercent = (value: number) => Math.round(value * 10) / 10;

export const comparePrompts = (referencePrompt: string, comparedPrompt: string): PromptComparisonMetrics => {
  const referenceWords = tokenizePrompt(referencePrompt);
  const comparedWords = tokenizePrompt(comparedPrompt);
  const commonWordCount = longestCommonSubsequenceLength(referenceWords, comparedWords);
  const totalSequenceWords = referenceWords.length + comparedWords.length;
  const similarityPercent = totalSequenceWords === 0
    ? 100
    : roundPercent((2 * commonWordCount / totalSequenceWords) * 100);
  const referenceSet = new Set(referenceWords);
  const comparedSet = new Set(comparedWords);
  const vocabularyUnion = new Set([...referenceSet, ...comparedSet]);
  const vocabularyIntersection = [...referenceSet].filter(word => comparedSet.has(word)).length;

  return {
    wordCount: comparedWords.length,
    uniqueWordCount: comparedSet.size,
    characterCount: comparedPrompt.length,
    commonWordCount,
    addedWordCount: comparedWords.length - commonWordCount,
    removedWordCount: referenceWords.length - commonWordCount,
    similarityPercent,
    differencePercent: roundPercent(100 - similarityPercent),
    jaccardPercent: vocabularyUnion.size === 0
      ? 100
      : roundPercent((vocabularyIntersection / vocabularyUnion.size) * 100),
    lengthRatio: referenceWords.length === 0
      ? (comparedWords.length === 0 ? 1 : comparedWords.length)
      : Math.round((comparedWords.length / referenceWords.length) * 100) / 100,
    lexicalRichnessPercent: comparedWords.length === 0
      ? 0
      : roundPercent((comparedSet.size / comparedWords.length) * 100),
  };
};
