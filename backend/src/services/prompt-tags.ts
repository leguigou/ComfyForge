import type Database from 'better-sqlite3';

export type PromptTagDefinition = {
  slug: string;
  category: string;
  labelFr: string;
  labelEn: string;
  phrases: string[];
};

export type PromptTag = Omit<PromptTagDefinition, 'phrases'>;

export const PROMPT_TAG_DEFINITIONS: PromptTagDefinition[] = [
  { slug: 'explicit', category: 'content', labelFr: 'Explicite', labelEn: 'Explicit', phrases: ['vulva', 'vulve', 'pubic hair', 'poils pubiens', 'genitals', 'genitaux', 'nipples', 'mamelons'] },
  { slug: 'nudity', category: 'content', labelFr: 'Nudité', labelEn: 'Nudity', phrases: ['completely nude', 'entirely nude', 'nude', 'naked', 'topless', 'bare chested', 'completement nue', 'entierement nue', 'femme nue', 'corps nu'] },
  { slug: 'swimwear', category: 'content', labelFr: 'Bikini / maillot', labelEn: 'Bikini / swimwear', phrases: ['bikini', 'swimsuit', 'swimwear', 'maillot de bain'] },
  { slug: 'lingerie', category: 'content', labelFr: 'Lingerie', labelEn: 'Lingerie', phrases: ['lingerie', 'bralette', 'underwear', 'lace bra', 'soutien gorge'] },
  { slug: 'dress', category: 'content', labelFr: 'Robe', labelEn: 'Dress', phrases: ['evening gown', 'evening dress', 'mini dress', 'summer dress', 'dress', 'gown', 'robe'] },
  { slug: 'sportswear', category: 'content', labelFr: 'Tenue sportive', labelEn: 'Sportswear', phrases: ['sportswear', 'athletic wear', 'sports bra', 'yoga pants', 'gym outfit', 'tennis outfit', 'running shorts'] },

  { slug: 'bedroom', category: 'setting', labelFr: 'Chambre', labelEn: 'Bedroom', phrases: ['bedroom', 'on a bed', 'lying on bed', 'mattress', 'bedsheet', 'duvet', 'chambre', 'sur un lit'] },
  { slug: 'bathroom', category: 'setting', labelFr: 'Salle de bain', labelEn: 'Bathroom', phrases: ['bathroom', 'shower', 'bathtub', 'salle de bain', 'douche', 'baignoire'] },
  { slug: 'beach', category: 'setting', labelFr: 'Plage / océan', labelEn: 'Beach / ocean', phrases: ['white sand beach', 'sandy beach', 'ocean waves', 'beach', 'ocean', 'seaside', 'shoreline', 'coast', 'plage'] },
  { slug: 'street', category: 'setting', labelFr: 'Rue / urbain', labelEn: 'Street / urban', phrases: ['city street', 'urban street', 'street', 'sidewalk', 'alley', 'rue', 'trottoir'] },
  { slug: 'nature', category: 'setting', labelFr: 'Nature / forêt', labelEn: 'Nature / forest', phrases: ['dense forest', 'wooded setting', 'forest', 'woods', 'meadow', 'field', 'garden', 'park', 'foret', 'bois', 'prairie'] },
  { slug: 'pool', category: 'setting', labelFr: 'Piscine', labelEn: 'Pool', phrases: ['swimming pool', 'poolside', 'pool', 'piscine'] },
  { slug: 'studio', category: 'setting', labelFr: 'Studio', labelEn: 'Studio', phrases: ['photo studio', 'studio portrait', 'seamless backdrop', 'solid backdrop', 'plain backdrop'] },
  { slug: 'indoor', category: 'setting', labelFr: 'Intérieur', labelEn: 'Indoor', phrases: ['indoor', 'interior room', 'inside an apartment', 'inside a house', 'interieur'] },

  { slug: 'blonde', category: 'appearance', labelFr: 'Blonde', labelEn: 'Blonde', phrases: ['platinum blonde', 'blonde hair', 'blond hair', 'cheveux blonds', 'blonde'] },
  { slug: 'brunette', category: 'appearance', labelFr: 'Brune', labelEn: 'Brunette', phrases: ['dark brown hair', 'brown hair', 'brunette', 'cheveux bruns', 'cheveux chatains'] },
  { slug: 'black-hair', category: 'appearance', labelFr: 'Cheveux noirs', labelEn: 'Black hair', phrases: ['jet black hair', 'black hair', 'cheveux noirs'] },

  { slug: 'selfie', category: 'shot', labelFr: 'Selfie / smartphone', labelEn: 'Selfie / smartphone', phrases: ['mirror selfie', 'candid smartphone photograph', 'smartphone photograph', 'phone camera', 'selfie'] },
  { slug: 'close-up', category: 'shot', labelFr: 'Portrait rapproché', labelEn: 'Close-up portrait', phrases: ['extreme close up', 'tight crop', 'close up', 'closeup', 'headshot', 'gros plan'] },
  { slug: 'waist-up', category: 'shot', labelFr: 'Plan taille / buste', labelEn: 'Waist-up shot', phrases: ['mid thigh up', 'waist up', 'upper body', 'torso up', 'chest up', 'plan taille'] },
  { slug: 'full-body', category: 'shot', labelFr: 'Plein pied', labelEn: 'Full body', phrases: ['head to toe', 'full body', 'full figure', 'plein pied'] },
  { slug: 'eye-level', category: 'shot', labelFr: 'Hauteur des yeux', labelEn: 'Eye level', phrases: ['eye level', 'straight on', 'hauteur des yeux'] },
  { slug: 'high-angle', category: 'shot', labelFr: 'Angle haut', labelEn: 'High angle', phrases: ['slightly elevated angle', 'elevated angle', 'high angle', 'from above', 'plongee'] },
  { slug: 'low-angle', category: 'shot', labelFr: 'Angle bas', labelEn: 'Low angle', phrases: ['slightly low angle', 'low angle', 'contre plongee'] },
  { slug: 'shallow-focus', category: 'shot', labelFr: 'Faible profondeur de champ', labelEn: 'Shallow depth of field', phrases: ['shallow depth of field', 'background blur', 'blurred background'] },
  { slug: 'bokeh', category: 'shot', labelFr: 'Bokeh', labelEn: 'Bokeh', phrases: ['bokeh'] },

  { slug: 'candid', category: 'style', labelFr: 'Pris sur le vif', labelEn: 'Candid', phrases: ['candid photograph', 'candid photo', 'candid', 'sur le vif', 'spontaneous'] },
  { slug: 'photorealistic', category: 'style', labelFr: 'Photoréaliste', labelEn: 'Photorealistic', phrases: ['hyperrealistic', 'photorealistic', 'photo realistic', 'realistic photograph', 'realisme'] },
  { slug: 'cinematic', category: 'style', labelFr: 'Cinématique', labelEn: 'Cinematic', phrases: ['cinematic', 'cinematique', 'film still'] },

  { slug: 'standing', category: 'pose', labelFr: 'Debout', labelEn: 'Standing', phrases: ['stands confidently', 'standing', 'stands', 'debout'] },
  { slug: 'seated', category: 'pose', labelFr: 'Assise', labelEn: 'Seated', phrases: ['cross legged', 'seated', 'sitting', 'sits', 'assise'] },
  { slug: 'reclining', category: 'pose', labelFr: 'Allongée', labelEn: 'Reclining', phrases: ['reclining', 'reclines', 'lying down', 'lies on', 'allongee'] },
  { slug: 'walking', category: 'pose', labelFr: 'En marche', labelEn: 'Walking', phrases: ['walking', 'walks', 'elle marche'] },

  { slug: 'natural-light', category: 'lighting', labelFr: 'Lumière naturelle', labelEn: 'Natural light', phrases: ['natural daylight', 'natural light', 'daylight', 'lumiere naturelle'] },
  { slug: 'soft-light', category: 'lighting', labelFr: 'Lumière douce', labelEn: 'Soft light', phrases: ['soft diffused lighting', 'soft directional lighting', 'soft lighting', 'diffused lighting', 'soft shadows', 'gentle shadows', 'lumiere douce'] },
  { slug: 'hard-light', category: 'lighting', labelFr: 'Lumière dure', labelEn: 'Hard light', phrases: ['harsh direct sunlight', 'harsh sunlight', 'direct sunlight', 'harsh lighting', 'sharp shadows'] },
  { slug: 'golden-hour', category: 'lighting', labelFr: 'Golden hour', labelEn: 'Golden hour', phrases: ['golden hour', 'magic hour', 'sunset', 'sunrise', 'coucher de soleil', 'lever de soleil'] },
  { slug: 'neon', category: 'lighting', labelFr: 'Néon / nocturne', labelEn: 'Neon / night', phrases: ['neon lighting', 'neon lights', 'nightclub', 'night scene', 'city lights'] },
];

const CATEGORY_LIMITS: Record<string, number> = {
  content: 2,
  setting: 1,
  appearance: 1,
  shot: 2,
  style: 1,
  pose: 1,
  lighting: 1,
};

const normalizePrompt = (value: string) => ` ${value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()} `;

const isNegated = (text: string, matchIndex: number) => {
  const prefix = text.slice(Math.max(0, matchIndex - 40), matchIndex);
  return /(?:\bno\b|\bwithout\b|\bsans\b|\bpas de\b|\baucun(?:e)?\b)(?:\s+\w+){0,1}\s*$/.test(prefix);
};

const scoreDefinition = (text: string, definition: PromptTagDefinition) => {
  let score = 0;
  for (const rawPhrase of definition.phrases) {
    const phrase = normalizePrompt(rawPhrase).trim();
    const needle = ` ${phrase} `;
    const index = text.indexOf(needle);
    if (index >= 0 && !isNegated(text, index)) {
      score += 10 + phrase.split(' ').length;
    }
  }
  return score;
};

export const classifyPrompt = (prompt: string, maxTags = 6): PromptTagDefinition[] => {
  if (!prompt.trim()) return [];
  const text = normalizePrompt(prompt);
  const candidates = PROMPT_TAG_DEFINITIONS
    .map(definition => ({ definition, score: scoreDefinition(text, definition) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const categoryCounts = new Map<string, number>();
  const selected: PromptTagDefinition[] = [];
  for (const candidate of candidates) {
    const category = candidate.definition.category;
    const count = categoryCounts.get(category) || 0;
    if (count >= (CATEGORY_LIMITS[category] || 1)) continue;
    selected.push(candidate.definition);
    categoryCounts.set(category, count + 1);
    if (selected.length >= maxTags) break;
  }
  return selected;
};

export const replaceAutoPromptTags = (
  database: Database.Database,
  messageId: string,
  prompt: string,
) => {
  const remove = database.prepare("DELETE FROM message_tags WHERE messageId = ? AND source = 'auto'");
  const insert = database.prepare(`
    INSERT OR IGNORE INTO message_tags (messageId, tagId, source, confidence)
    VALUES (?, ?, 'auto', 1)
  `);
  const tags = classifyPrompt(prompt);
  const transaction = database.transaction(() => {
    remove.run(messageId);
    tags.forEach(tag => insert.run(messageId, tag.slug));
  });
  transaction();
  return tags;
};

export const syncPromptTags = (database: Database.Database) => {
  const upsertTag = database.prepare(`
    INSERT INTO tags (id, category, labelFr, labelEn)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      labelFr = excluded.labelFr,
      labelEn = excluded.labelEn
  `);
  const messages = database.prepare(`
    SELECT id, COALESCE(NULLIF(TRIM(generationPrompt), ''), prompt, '') AS prompt
    FROM messages
    WHERE role = 'bot' AND imageUrl IS NOT NULL
  `).all() as Array<{ id: string; prompt: string }>;

  const transaction = database.transaction(() => {
    PROMPT_TAG_DEFINITIONS.forEach(tag => upsertTag.run(tag.slug, tag.category, tag.labelFr, tag.labelEn));
    messages.forEach(message => replaceAutoPromptTags(database, message.id, message.prompt));
  });
  transaction();
  console.log(`[Tags] Indexed ${messages.length} generated images`);
};

export const attachPromptTags = <T extends Record<string, unknown>>(
  database: Database.Database,
  rows: T[],
  idKey: keyof T,
) => {
  const ids = rows.map(row => String(row[idKey] || '')).filter(Boolean);
  if (ids.length === 0) return rows.map(row => ({ ...row, tags: [] }));

  const tagsByMessage = new Map<string, PromptTag[]>();
  for (let offset = 0; offset < ids.length; offset += 400) {
    const chunk = ids.slice(offset, offset + 400);
    const placeholders = chunk.map(() => '?').join(',');
    const tagRows = database.prepare(`
      SELECT mt.messageId, t.id AS slug, t.category, t.labelFr, t.labelEn
      FROM message_tags mt
      JOIN tags t ON t.id = mt.tagId
      WHERE mt.messageId IN (${placeholders})
      ORDER BY t.category, t.labelFr
    `).all(...chunk) as Array<PromptTag & { messageId: string }>;
    tagRows.forEach(({ messageId, ...tag }) => {
      const existing = tagsByMessage.get(messageId) || [];
      existing.push(tag);
      tagsByMessage.set(messageId, existing);
    });
  }

  return rows.map(row => ({
    ...row,
    tags: tagsByMessage.get(String(row[idKey])) || [],
  }));
};
