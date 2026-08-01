import type Database from 'better-sqlite3';

export type PromptTagDefinition = {
  slug: string;
  category: string;
  labelFr: string;
  labelEn: string;
  phrases: string[];
  patterns?: RegExp[];
};

export type PromptTag = Omit<PromptTagDefinition, 'phrases'>;

export const PROMPT_TAG_DEFINITIONS: PromptTagDefinition[] = [
  {
    slug: 'explicit',
    category: 'content',
    labelFr: 'Explicite',
    labelEn: 'Explicit',
    phrases: ['vulva', 'vulve', 'vagina', 'pussy', 'clitoris', 'clit', 'penis', 'cock', 'dick', 'genitals', 'genitaux', 'testicles', 'scrotum', 'anus', 'anal', 'pubic hair', 'poils pubiens', 'nipples', 'mamelons'],
  },
  {
    slug: 'nudity',
    category: 'content',
    labelFr: 'Nudité',
    labelEn: 'Nudity',
    phrases: ['completely nude', 'entirely nude', 'fully nude', 'partial nudity', 'nude', 'naked', 'nudity', 'topless', 'bottomless', 'bare chested', 'braless', 'no bra', 'see through clothing', 'transparent blouse', 'completement nue', 'entierement nue', 'femme nue', 'corps nu', 'nue', 'sans vetements'],
    // Genital exposure or stimulation implies nudity in terse generation prompts.
    patterns: [
      /\b(?:exposed|visible|show(?:ing)?)\s+(?:her\s+|his\s+)?(?:vulva|vagina|pussy|clitoris|clit|penis|cock|genitals?)\b/,
      /\b(?:vulva|vagina|pussy|clitoris|clit|penis|cock)\s+(?:focus|exposed|visible|stimulation)\b/,
      /\b(?:against|touching|rubbing|stimulating)\s+(?:her\s+|his\s+)?(?:vulva|vagina|pussy|clitoris|clit|penis|cock)\b/,
      /\b(?:having sex|sexual intercourse|faire du sexe|faire l amour|rapport sexuel)\b/,
    ],
  },
  { slug: 'sexual-activity', category: 'activity', labelFr: 'Activité sexuelle', labelEn: 'Sexual activity', phrases: ['sexual activity', 'having sex', 'intercourse', 'masturbation', 'masturbating', 'orgasm', 'oral sex', 'blowjob', 'fellatio', 'cunnilingus', 'rides cock', 'riding cock', 'sex from behind', 'girl on top', 'vibrator', 'dildo', 'moaning in pleasure', 'faire du sexe', 'faire l amour', 'rapport sexuel'], patterns: [/\b(?:touch(?:es|ing)?|rub(?:s|bing)?|stimulat(?:es|ing))\s+(?:her\s+|his\s+)?(?:clitoris|clit|vulva|vagina|pussy|penis|cock)\b/, /\b(?:toothbrush|electric toothbrush|sex toy)\b(?:\s+\w+){0,5}\s+(?:clitoris|clit|vulva|vagina|pussy|penis|cock)\b/] },
  { slug: 'swimwear', category: 'content', labelFr: 'Bikini / maillot', labelEn: 'Bikini / swimwear', phrases: ['bikini', 'swimsuit', 'swimwear', 'maillot de bain'] },
  { slug: 'lingerie', category: 'content', labelFr: 'Lingerie', labelEn: 'Lingerie', phrases: ['lingerie', 'bralette', 'underwear', 'panties', 'bra', 'lace bra', 'soutien gorge', 'culotte'] },
  { slug: 'dress', category: 'content', labelFr: 'Robe', labelEn: 'Dress', phrases: ['evening gown', 'evening dress', 'mini dress', 'summer dress', 'dress', 'gown', 'robe'] },
  { slug: 'sportswear', category: 'content', labelFr: 'Tenue sportive', labelEn: 'Sportswear', phrases: ['sportswear', 'athletic wear', 'sports bra', 'yoga pants', 'gym outfit', 'tennis outfit', 'running shorts'] },

  { slug: 'breasts', category: 'anatomy', labelFr: 'Seins', labelEn: 'Breasts', phrases: ['breasts', 'breast', 'boobs', 'boob', 'busty', 'cleavage', 'tits', 'tit', 'poitrine', 'seins', 'sein', 'decollete'] },
  { slug: 'genitals', category: 'anatomy', labelFr: 'Parties génitales', labelEn: 'Genitals', phrases: ['vulva', 'vulve', 'vagina', 'pussy', 'clitoris', 'clit', 'penis', 'cock', 'dick', 'genitals', 'genitaux', 'testicles', 'scrotum', 'anus'] },
  { slug: 'buttocks', category: 'anatomy', labelFr: 'Fesses', labelEn: 'Buttocks', phrases: ['buttocks', 'butt', 'ass', 'booty', 'glutes', 'fesses'] },

  { slug: 'large-breasts', category: 'breast-size', labelFr: 'Gros seins', labelEn: 'Large breasts', phrases: ['large breasts', 'large breast', 'big breasts', 'big breast', 'huge breasts', 'huge boobs', 'giant breasts', 'massive breasts', 'enormous breasts', 'voluptuous breasts', 'big boobs', 'big tits', 'gros seins', 'forte poitrine', 'busty'] },
  { slug: 'medium-breasts', category: 'breast-size', labelFr: 'Seins moyens', labelEn: 'Medium breasts', phrases: ['medium breasts', 'medium breast', 'medium sized breasts', 'medium bust', 'seins moyens', 'poitrine moyenne'] },
  { slug: 'small-breasts', category: 'breast-size', labelFr: 'Petits seins', labelEn: 'Small breasts', phrases: ['small breasts', 'small breast', 'tiny breasts', 'tiny boobs', 'flat chested', 'flat chest', 'modest bust', 'petits seins', 'petite poitrine'] },

  { slug: 'women', category: 'subject', labelFr: 'Femme(s)', labelEn: 'Woman / women', phrases: ['young women', 'young woman', 'women', 'woman', 'young girls', 'young girl', 'girls', 'girl', 'female', 'femmes', 'femme', 'filles', 'fille', 'japonaise', 'nonne', 'nun'], patterns: [/\b\d+\s*(?:girls?|women|femmes?|filles?)\b/] },
  { slug: 'men', category: 'subject', labelFr: 'Homme(s)', labelEn: 'Man / men', phrases: ['young men', 'young man', 'men', 'man', 'young boys', 'young boy', 'boys', 'boy', 'male', 'hommes', 'homme', 'garcons', 'garcon'], patterns: [/\b\d+\s*(?:boys?|men|hommes?|garcons?)\b/] },
  { slug: 'dog', category: 'animal', labelFr: 'Chien', labelEn: 'Dog', phrases: ['dogs', 'dog', 'chiens', 'chien'] },
  { slug: 'cat', category: 'animal', labelFr: 'Chat', labelEn: 'Cat', phrases: ['cats', 'cat', 'chats', 'chat'] },

  {
    slug: 'three-people',
    category: 'count',
    labelFr: '3 personnes',
    labelEn: '3 people',
    phrases: [],
    patterns: [/\b(?:three|3|trois)\b(?:\s+[a-z0-9]+){0,5}\s+(?:women|woman|girls|girl|men|man|boys|boy|people|persons|femmes|femme|filles|fille|hommes|homme|garcons|garcon|personnes|personne)\b/],
  },
  {
    slug: 'two-people',
    category: 'count',
    labelFr: '2 personnes',
    labelEn: '2 people',
    phrases: ['couple portrait', 'couple photo', 'young couple', 'jeune couple', 'couple'],
    patterns: [/\b(?:two|2|deux)\b(?:\s+[a-z0-9]+){0,5}\s+(?:women|woman|girls|girl|men|man|boys|boy|people|persons|femmes|femme|filles|fille|hommes|homme|garcons|garcon|personnes|personne)\b/],
  },
  { slug: 'group', category: 'count', labelFr: 'Groupe', labelEn: 'Group', phrases: ['group portrait', 'group photo', 'group shot', 'group of', 'groupe de', 'photo de groupe'] },
  {
    slug: 'solo',
    category: 'count',
    labelFr: '1 personne',
    labelEn: '1 person',
    phrases: ['solo portrait', 'single woman', 'single man', 'portrait solo'],
    patterns: [/\b(?:one|1|une|un)\b(?:\s+[a-z0-9]+){0,3}\s+(?:woman|girl|man|boy|person|femme|fille|homme|garcon|personne)\b/],
  },

  { slug: 'bedroom', category: 'setting', labelFr: 'Chambre', labelEn: 'Bedroom', phrases: ['bedroom', 'on a bed', 'lying on bed', 'mattress', 'bedsheet', 'duvet', 'chambre', 'sur un lit', 'dans un lit', 'au lit'] },
  { slug: 'bathroom', category: 'setting', labelFr: 'Salle de bain', labelEn: 'Bathroom', phrases: ['bathroom', 'shower', 'bathtub', 'salle de bain', 'douche', 'baignoire'] },
  { slug: 'beach', category: 'setting', labelFr: 'Plage / océan', labelEn: 'Beach / ocean', phrases: ['white sand beach', 'sandy beach', 'ocean waves', 'beach', 'ocean', 'seaside', 'shoreline', 'coast', 'plage'] },
  { slug: 'street', category: 'setting', labelFr: 'Rue / urbain', labelEn: 'Street / urban', phrases: ['city street', 'urban street', 'street', 'sidewalk', 'alley', 'rue', 'trottoir'] },
  { slug: 'nature', category: 'setting', labelFr: 'Nature / forêt', labelEn: 'Nature / forest', phrases: ['dense forest', 'wooded setting', 'forest', 'woods', 'meadow', 'field', 'garden', 'park', 'foret', 'bois', 'prairie', 'jardin'] },
  { slug: 'pool', category: 'setting', labelFr: 'Piscine', labelEn: 'Pool', phrases: ['swimming pool', 'poolside', 'pool', 'piscine'] },
  { slug: 'studio', category: 'setting', labelFr: 'Studio', labelEn: 'Studio', phrases: ['photo studio', 'studio portrait', 'seamless backdrop', 'solid backdrop', 'plain backdrop'] },
  { slug: 'indoor', category: 'setting', labelFr: 'Intérieur', labelEn: 'Indoor', phrases: ['indoor', 'interior room', 'inside an apartment', 'inside a house', 'interieur'] },
  { slug: 'kitchen', category: 'setting', labelFr: 'Cuisine', labelEn: 'Kitchen', phrases: ['kitchen', 'cuisine'] },
  { slug: 'classroom', category: 'setting', labelFr: 'Salle de classe', labelEn: 'Classroom', phrases: ['classroom', 'school room', 'salle de classe'] },
  { slug: 'hotel', category: 'setting', labelFr: 'Hôtel', labelEn: 'Hotel', phrases: ['hotel room', 'motel room', 'hotel', 'motel'] },
  { slug: 'vehicle', category: 'setting', labelFr: 'Véhicule', labelEn: 'Vehicle', phrases: ['inside a car', 'in a car', 'inside a taxi', 'in a taxi', 'car interior', 'train carriage', 'subway car', 'vehicle interior'] },
  { slug: 'mountain', category: 'setting', labelFr: 'Montagne', labelEn: 'Mountain', phrases: ['snowy mountain', 'mountain landscape', 'mountain', 'mount fuji', 'mont fuji', 'montagne'] },
  { slug: 'church', category: 'setting', labelFr: 'Église', labelEn: 'Church', phrases: ['inside a church', 'church interior', 'church', 'chapel', 'eglise', 'chapelle'] },
  { slug: 'public-transit', category: 'setting', labelFr: 'Transport public', labelEn: 'Public transit', phrases: ['subway station', 'subway car', 'subway', 'metro parisien', 'metro', 'train carriage'] },

  { slug: 'blonde', category: 'appearance', labelFr: 'Blonde', labelEn: 'Blonde', phrases: ['platinum blonde', 'blonde hair', 'blond hair', 'cheveux blonds', 'blonde'] },
  { slug: 'brunette', category: 'appearance', labelFr: 'Brune', labelEn: 'Brunette', phrases: ['dark brown hair', 'brown hair', 'brunette', 'cheveux bruns', 'cheveux chatains'] },
  { slug: 'black-hair', category: 'appearance', labelFr: 'Cheveux noirs', labelEn: 'Black hair', phrases: ['jet black hair', 'black hair', 'cheveux noirs'] },
  { slug: 'red-hair', category: 'appearance', labelFr: 'Cheveux roux', labelEn: 'Red hair', phrases: ['red hair', 'redhead', 'ginger hair', 'auburn hair', 'copper hair', 'cheveux roux', 'rousse'] },
  { slug: 'white-hair', category: 'appearance', labelFr: 'Cheveux blancs / argentés', labelEn: 'White / silver hair', phrases: ['white hair', 'silver hair', 'platinum hair', 'cheveux blancs', 'cheveux argentes'] },

  { slug: 'slim', category: 'body', labelFr: 'Mince', labelEn: 'Slim', phrases: ['slim body', 'slim build', 'slim', 'slender', 'skinny', 'petite build', 'thin build', 'mince'] },
  { slug: 'curvy', category: 'body', labelFr: 'Pulpeuse', labelEn: 'Curvy', phrases: ['curvy body', 'curvy', 'voluptuous', 'hourglass figure', 'wide hips', 'thick thighs', 'pulpeuse'] },
  { slug: 'athletic-body', category: 'body', labelFr: 'Corps athlétique', labelEn: 'Athletic body', phrases: ['athletic body', 'athletic build', 'muscular body', 'muscular', 'toned body', 'fit body', 'corps athletique'] },

  { slug: 'freckles', category: 'detail', labelFr: 'Taches de rousseur', labelEn: 'Freckles', phrases: ['freckles', 'freckled', 'taches de rousseur'] },
  { slug: 'tattoos', category: 'detail', labelFr: 'Tatouages', labelEn: 'Tattoos', phrases: ['tattooed', 'tattoos', 'tattoo', 'tatouages', 'tatouage'] },
  { slug: 'glasses', category: 'detail', labelFr: 'Lunettes', labelEn: 'Glasses', phrases: ['eyeglasses', 'wearing glasses', 'glasses', 'spectacles', 'lunettes'] },

  { slug: 'selfie', category: 'shot', labelFr: 'Selfie / smartphone', labelEn: 'Selfie / smartphone', phrases: ['mirror selfie', 'candid smartphone photograph', 'smartphone photograph', 'phone camera', 'selfie'] },
  { slug: 'close-up', category: 'shot', labelFr: 'Portrait rapproché', labelEn: 'Close-up portrait', phrases: ['extreme close up', 'tight crop', 'close up', 'closeup', 'headshot', 'gros plan'] },
  { slug: 'waist-up', category: 'shot', labelFr: 'Plan taille / buste', labelEn: 'Waist-up shot', phrases: ['mid thigh up', 'waist up', 'upper body', 'torso up', 'chest up', 'plan taille'] },
  { slug: 'full-body', category: 'shot', labelFr: 'Plein pied', labelEn: 'Full body', phrases: ['head to toe', 'full body', 'full figure', 'plein pied'] },
  { slug: 'eye-level', category: 'shot', labelFr: 'Hauteur des yeux', labelEn: 'Eye level', phrases: ['eye level', 'straight on', 'hauteur des yeux'] },
  { slug: 'high-angle', category: 'shot', labelFr: 'Angle haut', labelEn: 'High angle', phrases: ['slightly elevated angle', 'elevated angle', 'high angle', 'from above', 'plongee'] },
  { slug: 'low-angle', category: 'shot', labelFr: 'Angle bas', labelEn: 'Low angle', phrases: ['slightly low angle', 'low angle', 'contre plongee'] },
  { slug: 'shallow-focus', category: 'shot', labelFr: 'Faible profondeur de champ', labelEn: 'Shallow depth of field', phrases: ['shallow depth of field', 'background blur', 'blurred background'] },
  { slug: 'bokeh', category: 'shot', labelFr: 'Bokeh', labelEn: 'Bokeh', phrases: ['bokeh'] },
  { slug: 'pov', category: 'shot', labelFr: 'Point de vue subjectif', labelEn: 'POV', phrases: ['point of view shot', 'point of view', 'first person view', 'pov'] },
  { slug: 'voyeur', category: 'shot', labelFr: 'Voyeur', labelEn: 'Voyeur', phrases: ['voyeur photo', 'voyeur photograph', 'voyeur', 'peeping tom', 'pepping tom', 'hidden camera', 'secretly photographed'] },
  { slug: 'rear-view', category: 'shot', labelFr: 'Vue de dos', labelEn: 'Rear view', phrases: ['seen from behind', 'viewed from behind', 'from behind', 'rear view', 'back view', 'vue de dos'] },
  { slug: 'portrait', category: 'shot', labelFr: 'Portrait', labelEn: 'Portrait', phrases: ['portrait photograph', 'portrait photo', 'photo portrait', 'portrait'] },
  { slug: 'landscape', category: 'shot', labelFr: 'Paysage', labelEn: 'Landscape', phrases: ['landscape photograph', 'landscape photo', 'landscape', 'paysage'] },

  { slug: 'candid', category: 'style', labelFr: 'Pris sur le vif', labelEn: 'Candid', phrases: ['candid photograph', 'candid photo', 'candid', 'sur le vif', 'spontaneous'] },
  { slug: 'photorealistic', category: 'style', labelFr: 'Photoréaliste', labelEn: 'Photorealistic', phrases: ['hyperrealistic', 'photorealistic', 'photo realistic', 'realistic photograph', 'realisme'] },
  { slug: 'cinematic', category: 'style', labelFr: 'Cinématique', labelEn: 'Cinematic', phrases: ['cinematic', 'cinematique', 'film still'] },
  { slug: 'analog-photo', category: 'style', labelFr: 'Photo argentique', labelEn: 'Analog photo', phrases: ['analog photography', 'analog photo', 'film grain', 'kodak film', '35mm film', 'polaroid'] },
  { slug: 'illustration', category: 'style', labelFr: 'Illustration / anime', labelEn: 'Illustration / anime', phrases: ['anime style', 'anime', 'manga', 'digital artwork', 'digital art', 'illustration'] },

  { slug: 'standing', category: 'pose', labelFr: 'Debout', labelEn: 'Standing', phrases: ['stands confidently', 'standing', 'stands', 'debout'] },
  { slug: 'seated', category: 'pose', labelFr: 'Assise', labelEn: 'Seated', phrases: ['cross legged', 'seated', 'sitting', 'sits', 'assise'] },
  { slug: 'reclining', category: 'pose', labelFr: 'Allongée', labelEn: 'Reclining', phrases: ['reclining', 'reclines', 'lying down', 'lies on', 'allongee'] },
  { slug: 'walking', category: 'pose', labelFr: 'En marche', labelEn: 'Walking', phrases: ['walking', 'walks', 'elle marche'] },
  { slug: 'kneeling', category: 'pose', labelFr: 'À genoux', labelEn: 'Kneeling', phrases: ['kneeling', 'on her knees', 'on his knees', 'a genoux'] },
  { slug: 'legs-spread', category: 'pose', labelFr: 'Jambes écartées', labelEn: 'Legs spread', phrases: ['legs spread', 'spread legs', 'spreading her legs', 'spreading his legs', 'open legs', 'jambes ecartees'] },

  { slug: 'natural-light', category: 'lighting', labelFr: 'Lumière naturelle', labelEn: 'Natural light', phrases: ['natural daylight', 'natural light', 'daylight', 'lumiere naturelle'] },
  { slug: 'soft-light', category: 'lighting', labelFr: 'Lumière douce', labelEn: 'Soft light', phrases: ['soft diffused lighting', 'soft directional lighting', 'soft lighting', 'diffused lighting', 'soft shadows', 'gentle shadows', 'lumiere douce'] },
  { slug: 'hard-light', category: 'lighting', labelFr: 'Lumière dure', labelEn: 'Hard light', phrases: ['harsh direct sunlight', 'harsh sunlight', 'direct sunlight', 'harsh lighting', 'sharp shadows'] },
  { slug: 'golden-hour', category: 'lighting', labelFr: 'Golden hour', labelEn: 'Golden hour', phrases: ['golden hour', 'magic hour', 'sunset', 'sunrise', 'coucher de soleil', 'lever de soleil'] },
  { slug: 'neon', category: 'lighting', labelFr: 'Néon / nocturne', labelEn: 'Neon / night', phrases: ['neon lighting', 'neon lights', 'nightclub', 'night scene', 'city lights'] },
];

const CATEGORY_LIMITS: Record<string, number> = {
  content: 3,
  activity: 2,
  animal: 2,
  anatomy: 3,
  'breast-size': 1,
  subject: 1,
  count: 1,
  setting: 2,
  appearance: 2,
  body: 2,
  detail: 2,
  shot: 3,
  style: 2,
  pose: 2,
  lighting: 1,
};

const CATEGORY_PRIORITY: Record<string, number> = {
  count: 2,
  subject: 1,
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
  for (const pattern of definition.patterns || []) {
    const match = pattern.exec(text);
    if (match?.index !== undefined && !isNegated(text, match.index)) {
      score += 20;
    }
  }
  return score;
};

export const classifyPrompt = (prompt: string, maxTags = 12): PromptTagDefinition[] => {
  if (!prompt.trim()) return [];
  const text = normalizePrompt(prompt);
  const candidates = PROMPT_TAG_DEFINITIONS
    .map(definition => ({ definition, score: scoreDefinition(text, definition) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || (CATEGORY_PRIORITY[b.definition.category] || 0) - (CATEGORY_PRIORITY[a.definition.category] || 0)
    ));

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
