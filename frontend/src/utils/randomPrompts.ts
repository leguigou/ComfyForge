import type { RandomPromptList, RandomPromptSelection } from '../types';

export const RANDOM_PROMPT_LISTS_VERSION = 3;

export const DEFAULT_RANDOM_PROMPT_LISTS: RandomPromptList[] = [
  {
    id: 'hair-color',
    name: 'Couleur de cheveux',
    slug: 'R-Color',
    values: ['blonde', 'brunette', 'redhead', 'black-haired', 'platinum blonde', 'auburn-haired'],
    enabled: true
  },
  {
    id: 'outfit',
    name: 'Tenue',
    slug: 'R-Outfit',
    values: ['elegant black dress', 'casual denim outfit', 'silk evening gown', 'tailored pantsuit', 'summer dress', 'sporty outfit'],
    enabled: true
  },
  {
    id: 'body-type',
    name: 'Morphologie',
    slug: 'R-Body',
    values: ['slender build', 'athletic build', 'curvy figure', 'petite build', 'tall statuesque figure'],
    enabled: true
  },
  {
    id: 'eye-color',
    name: 'Couleur des yeux',
    slug: 'R-Eyes',
    values: ['blue eyes', 'green eyes', 'brown eyes', 'hazel eyes', 'gray eyes'],
    enabled: true
  },
  {
    id: 'hairstyle',
    name: 'Coiffures',
    slug: 'R-Hairstyle',
    values: ['long wavy hair', 'sleek bob haircut', 'high ponytail', 'messy bun', 'braided hairstyle', 'pixie cut', 'shoulder-length curly hair', 'twin braids'],
    enabled: true
  },
  {
    id: 'country-origin',
    name: 'Origine',
    slug: 'R-Origin',
    values: ['french', 'american', 'italian', 'spanish', 'british', 'german', 'brazilian', 'mexican', 'japanese', 'south korean', 'chinese', 'indian', 'moroccan', 'swedish', 'australian'],
    enabled: true
  }
];

export const migrateRandomPromptLists = (lists: RandomPromptList[], version = 1) => {
  if (version >= RANDOM_PROMPT_LISTS_VERSION) return lists;

  const additions = [
    { version: 2, id: 'hairstyle' },
    { version: 3, id: 'country-origin' }
  ];

  return additions.reduce((migrated, addition) => {
    if (version >= addition.version) return migrated;
    const defaultList = DEFAULT_RANDOM_PROMPT_LISTS.find(list => list.id === addition.id)!;
    const alreadyExists = migrated.some(list =>
      list.id === defaultList.id || list.slug.toLowerCase() === defaultList.slug.toLowerCase()
    );
    return alreadyExists ? migrated : [...migrated, { ...defaultList, values: [...defaultList.values] }];
  }, lists);
};

export const normalizeRandomSlug = (value: string) => value
  .trim()
  .replace(/^\[|\]$/g, '')
  .replace(/\s+/g, '-')
  .replace(/[^a-zA-Z0-9_-]/g, '')
  .slice(0, 40);

export const resolveRandomPromptsWithSelections = (prompt: string, lists: RandomPromptList[] = []) => {
  const available = new Map(
    lists
      .filter(list => list.enabled && list.slug && list.values.some(value => value.trim()))
      .map(list => [list.slug.toLowerCase(), { list, values: list.values.map(value => value.trim()).filter(Boolean) }])
  );
  const selections = new Map<string, RandomPromptSelection>();

  const resolvedPrompt = prompt.replace(/\[([a-zA-Z0-9_-]+)\]/g, (token, slug: string) => {
    const key = slug.toLowerCase();
    const entry = available.get(key);
    if (!entry?.values.length) return token;
    if (!selections.has(key)) {
      selections.set(key, {
        listId: entry.list.id,
        name: entry.list.name,
        slug: entry.list.slug,
        value: entry.values[Math.floor(Math.random() * entry.values.length)]
      });
    }
    return selections.get(key)!.value;
  });

  return { prompt: resolvedPrompt, selections: [...selections.values()] };
};

export const resolveRandomPrompts = (prompt: string, lists: RandomPromptList[] = []) =>
  resolveRandomPromptsWithSelections(prompt, lists).prompt;
