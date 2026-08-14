import type { Language } from '../types';

const FRENCH_WORDS = new Set([
  'au', 'aux', 'avec', 'beau', 'belle', 'bonjour', 'ce', 'ces', 'cette', 'comme', 'dans', 'de', 'des', 'du',
  'elle', 'elles', 'en', 'est', 'et', 'femme', 'homme', 'il', 'ils', 'je', 'jeune', 'la', 'le',
  'les', 'lumière', 'mais', 'nous', 'ou', 'par', 'pas', 'plus', 'pour', 'que', 'qui', 'sans',
  'salut', 'son', 'sont', 'sur', 'très', 'tu', 'un', 'une', 'vous',
]);

const ENGLISH_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'background', 'beautiful', 'but', 'by', 'for', 'from',
  'he', 'hello', 'in', 'is', 'it', 'light', 'man', 'more', 'not', 'of', 'on', 'or', 'she', 'standing',
  'that', 'the', 'their', 'these', 'they', 'this', 'those', 'to', 'very', 'wearing', 'with',
  'without', 'woman', 'young', 'you',
]);

export const detectTextLanguage = (text: string): Language | 'unknown' => {
  const normalized = text.toLocaleLowerCase().replace(/[’]/g, "'");
  const words = normalized.match(/[a-zà-öø-ÿ]+(?:'[a-zà-öø-ÿ]+)?/g) || [];
  let frenchScore = /[àâçéèêëîïôùûüÿœ]/.test(normalized) ? 3 : 0;
  let englishScore = 0;

  words.forEach(word => {
    if (FRENCH_WORDS.has(word)) frenchScore += 1;
    if (ENGLISH_WORDS.has(word)) englishScore += 1;
    if (/^(?:l|d|qu|j|n|c|s|t|m)'/.test(word)) frenchScore += 2;
    if (/^(?:don't|doesn't|isn't|aren't|it's|that's|there's)$/.test(word)) englishScore += 2;
  });

  if (frenchScore === englishScore) return 'unknown';
  return frenchScore > englishScore ? 'fr' : 'en';
};

export const canTranslateText = (text: string, interfaceLanguage: Language) => {
  const detectedLanguage = detectTextLanguage(text);
  return Boolean(text.trim()) && detectedLanguage !== interfaceLanguage;
};
