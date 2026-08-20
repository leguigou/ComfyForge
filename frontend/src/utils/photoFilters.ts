export interface PhotoFilterPreset {
  id: string;
  familyId: string;
  labelFr: string;
  labelEn: string;
  descriptionFr: string;
  descriptionEn: string;
  prompt: string;
}

export interface PhotoFilterFamily {
  id: string;
  labelFr: string;
  labelEn: string;
  filters: PhotoFilterPreset[];
}

type FilterDefinition = Omit<PhotoFilterPreset, 'familyId'>;

const family = (
  id: string,
  labelFr: string,
  labelEn: string,
  filters: FilterDefinition[],
): PhotoFilterFamily => ({
  id,
  labelFr,
  labelEn,
  filters: filters.map(filter => ({ ...filter, familyId: id })),
});

export const PHOTO_FILTER_FAMILIES: PhotoFilterFamily[] = [
  family('realism', 'Réalisme', 'Realism', [
    { id: 'natural-clean', labelFr: 'Naturel propre', labelEn: 'Clean natural', descriptionFr: 'Réaliste, fidèle et peu retouché.', descriptionEn: 'Realistic, faithful and lightly processed.', prompt: 'natural photorealistic photograph, true-to-life colors, realistic skin texture, subtle pores and imperfections, balanced exposure, restrained processing' },
    { id: 'raw-candid', labelFr: 'Brut et spontané', labelEn: 'Raw candid', descriptionFr: 'Un instant authentique sans pose.', descriptionEn: 'An authentic unposed moment.', prompt: 'raw candid photograph, spontaneous unposed moment, authentic imperfections, natural available light, subtle camera noise, no artificial polish' },
    { id: 'everyday-amateur', labelFr: 'Photo amateur', labelEn: 'Everyday amateur', descriptionFr: 'Cadrage ordinaire et appareil grand public.', descriptionEn: 'Casual framing and a consumer camera.', prompt: 'ordinary amateur snapshot, casual composition, consumer-grade camera, imperfect framing, realistic exposure, no professional studio setup' },
    { id: 'caught-in-the-moment', labelFr: 'Pris sur le vif', labelEn: 'Caught in the moment', descriptionFr: 'Scène spontanée et naturelle.', descriptionEn: 'Spontaneous, natural real-life scene.', prompt: 'candid real-life photograph, unstaged moment, observational framing, natural body language, authentic environmental detail' },
    { id: 'detailed-photorealism', labelFr: 'Photoréalisme détaillé', labelEn: 'Detailed photorealism', descriptionFr: 'Détails fins sans rendu plastique.', descriptionEn: 'Fine detail without a plastic look.', prompt: 'high-detail photorealistic photography, lifelike materials and skin, natural micro-texture, accurate lighting, realistic depth and color' },
  ]),
  family('mobile', 'Smartphone et web', 'Smartphone and web', [
    { id: 'modern-smartphone', labelFr: 'Smartphone moderne', labelEn: 'Modern smartphone', descriptionFr: 'Photo mobile nette avec HDR discret.', descriptionEn: 'Clean mobile capture with restrained HDR.', prompt: 'modern smartphone photograph, natural computational photography, restrained HDR, realistic sharpening, accurate auto exposure' },
    { id: 'smartphone-2020', labelFr: 'Smartphone amateur 2020', labelEn: '2020 amateur smartphone', descriptionFr: 'Rendu social et imperfections mobiles.', descriptionEn: 'Social-media rendering with mobile imperfections.', prompt: 'amateur smartphone photo, casual framing, natural grain in dark areas, mild JPEG artifacts, imperfect auto white balance, 2020 social-media aesthetic' },
    { id: 'early-mobile-2000s', labelFr: 'Téléphone années 2000', labelEn: '2000s camera phone', descriptionFr: 'Petit capteur, bruit et compression visibles.', descriptionEn: 'Small sensor with visible noise and compression.', prompt: 'early-2000s mobile phone photograph, low-resolution sensor, chunky digital noise, limited dynamic range, slight color cast, visible JPEG compression' },
    { id: 'mirror-selfie', labelFr: 'Selfie miroir', labelEn: 'Mirror selfie', descriptionFr: 'Reflet et perspective mobile naturels.', descriptionEn: 'Natural reflection and phone perspective.', prompt: 'casual mirror selfie, smartphone camera, available room light, imperfect reflection, natural perspective distortion, authentic social-media look' },
    { id: 'social-ugc', labelFr: 'UGC réseaux sociaux', labelEn: 'Social UGC', descriptionFr: 'Contenu utilisateur spontané et compressé.', descriptionEn: 'Spontaneous compressed user-generated content.', prompt: 'raw user-generated content photograph, spontaneous social-media snapshot, handheld framing, realistic compression, minimally edited' },
  ]),
  family('film', 'Argentique', 'Film', [
    { id: 'natural-35mm', labelFr: '35 mm naturel', labelEn: 'Natural 35mm', descriptionFr: 'Grain fin et couleurs argentiques neutres.', descriptionEn: 'Fine grain and neutral film color.', prompt: 'natural 35mm film photograph, fine organic film grain, gentle highlight roll-off, subtle color variation, realistic analog texture' },
    { id: 'portra-400', labelFr: 'Kodak Portra 400', labelEn: 'Kodak Portra 400', descriptionFr: 'Peaux chaudes, contraste doux et tons pastel.', descriptionEn: 'Warm skin, soft contrast and pastel color.', prompt: 'Kodak Portra 400 film aesthetic, warm natural skin tones, soft contrast, pastel color palette, fine grain, smooth highlight roll-off' },
    { id: 'fuji-pro400h', labelFr: 'Fujifilm Pro 400H', labelEn: 'Fujifilm Pro 400H', descriptionFr: 'Pastels aérés et verts doux.', descriptionEn: 'Airy pastels and soft greens.', prompt: 'Fujifilm Pro 400H aesthetic, airy pastel colors, soft greens, delicate contrast, fine organic grain, luminous skin tones' },
    { id: 'kodachrome-64', labelFr: 'Kodachrome 64', labelEn: 'Kodachrome 64', descriptionFr: 'Rouges riches et ambres chaleureux.', descriptionEn: 'Rich reds and warm amber tones.', prompt: 'Kodachrome 64 aesthetic, rich reds and warm ambers, deep color separation, fine grain, restrained highlights, classic slide-film rendering' },
    { id: 'disposable-camera', labelFr: 'Appareil jetable', labelEn: 'Disposable camera', descriptionFr: 'Flash intégré, grain fort et cadrage imparfait.', descriptionEn: 'Built-in flash, coarse grain and imperfect framing.', prompt: 'disposable camera snapshot, fixed-focus lens, direct built-in flash, coarse film grain, slight underexposure, imperfect framing' },
    { id: 'polaroid', labelFr: 'Polaroid', labelEn: 'Polaroid', descriptionFr: 'Couleurs crémeuses et douceur instantanée.', descriptionEn: 'Creamy color and instant-film softness.', prompt: 'instant Polaroid photograph, creamy colors, soft contrast, mild chemical color shifts, gentle blur, authentic instant-film texture' },
    { id: 'bw-film', labelFr: 'Noir et blanc argentique', labelEn: 'Black-and-white film', descriptionFr: 'Grain argentique et gamme tonale profonde.', descriptionEn: 'Silver grain and deep tonal range.', prompt: 'black-and-white 35mm film photograph, silver-rich grain, natural tonal range, deep blacks, soft highlight bloom, traditional darkroom print' },
  ]),
  family('eras', 'Époques', 'Eras', [
    { id: 'era-1930s', labelFr: 'Années 1930', labelEn: '1930s', descriptionFr: 'Objectif doux et tirage ancien.', descriptionEn: 'Soft lens and aged print rendering.', prompt: '1930s vernacular photography aesthetic, soft vintage lens, visible silver grain, low contrast, subtle print wear, period photographic rendering' },
    { id: 'era-1950s', labelFr: 'Années 1950', labelEn: '1950s', descriptionFr: 'Couleurs chaudes façon Kodachrome.', descriptionEn: 'Warm Kodachrome-like print color.', prompt: '1950s color-print aesthetic, warm Kodachrome-like palette, restrained saturation, gentle film grain, slight vignette' },
    { id: 'era-1960s', labelFr: 'Années 1960', labelEn: '1960s', descriptionFr: 'Pastels plats et contraste doux.', descriptionEn: 'Flat pastels and soft contrast.', prompt: '1960s color photography aesthetic, flat pastel palette, soft contrast, subtle analog grain, period print rendering' },
    { id: 'era-1970s', labelFr: 'Années 1970', labelEn: '1970s', descriptionFr: 'Ambres chauds et rouges profonds.', descriptionEn: 'Warm amber and deep reds.', prompt: '1970s Kodachrome aesthetic, warm amber cast, deep reds, gentle highlight roll-off, fine visible grain' },
    { id: 'era-1980s', labelFr: 'Années 1980', labelEn: '1980s', descriptionFr: 'Pellicule grand public saturée avec flash.', descriptionEn: 'Saturated consumer film with flash.', prompt: '1980s consumer film snapshot, saturated color print, direct flash, visible grain, slight red color cast' },
    { id: 'era-1990s', labelFr: 'Années 1990', labelEn: '1990s', descriptionFr: 'Tirage une heure et flash compact.', descriptionEn: 'One-hour print color and compact flash.', prompt: '1990s consumer 35mm snapshot, one-hour photo print colors, on-camera flash, mild grain, slight underexposure' },
    { id: 'era-y2k', labelFr: 'Y2K / années 2000', labelEn: 'Y2K / 2000s', descriptionFr: 'Compact numérique, flash dur et JPEG.', descriptionEn: 'Digital compact, harsh flash and JPEG texture.', prompt: 'early-2000s point-and-shoot snapshot, harsh direct flash, chunky digital noise, slight chromatic fringing, JPEG compression, Y2K color rendering' },
    { id: 'era-2010s', labelFr: 'Années 2010', labelEn: '2010s', descriptionFr: 'Premier smartphone et compression sociale.', descriptionEn: 'Early smartphone and social compression.', prompt: 'early-2010s smartphone photograph, modest dynamic range, cool auto white balance, mild sharpening, social-media compression' },
  ]),
  family('documentary', 'Documentaire', 'Documentary', [
    { id: 'natural-documentary', labelFr: 'Documentaire naturel', labelEn: 'Natural documentary', descriptionFr: 'Observation fidèle sans mise en scène.', descriptionEn: 'Truthful observation without staging.', prompt: 'documentary photography, observational and unstaged, natural available light, truthful colors, authentic real-world detail' },
    { id: 'photojournalism', labelFr: 'Photojournalisme', labelEn: 'Photojournalism', descriptionFr: 'Moment décisif et traitement factuel.', descriptionEn: 'Decisive moment and factual treatment.', prompt: 'photojournalistic photograph, decisive moment, factual visual treatment, environmental context, natural lighting, restrained processing' },
    { id: 'street-photo', labelFr: 'Photographie de rue', labelEn: 'Street photography', descriptionFr: 'Instant urbain spontané.', descriptionEn: 'Spontaneous layered urban moment.', prompt: 'candid street photography, spontaneous urban moment, layered environmental composition, available light, authentic motion' },
    { id: 'intimate-documentary', labelFr: 'Documentaire intime', labelEn: 'Intimate documentary', descriptionFr: 'Présence discrète et moment calme.', descriptionEn: 'Quiet moment with an unobtrusive camera.', prompt: 'intimate documentary photography, quiet observational framing, emotionally natural moment, soft available light, unobtrusive camera presence' },
    { id: 'paparazzi', labelFr: 'Paparazzi', labelEn: 'Paparazzi', descriptionFr: 'Longue focale et cadrage pressé.', descriptionEn: 'Long-lens compression and hurried framing.', prompt: 'paparazzi-style candid photograph, long-lens compression, hurried framing, incidental background detail, direct flash or available street light' },
  ]),
  family('cinema', 'Cinéma', 'Cinema', [
    { id: 'natural-cinema', labelFr: 'Cinéma naturel', labelEn: 'Natural cinema', descriptionFr: 'Étalonnage discret et lumière réaliste.', descriptionEn: 'Subtle grade and realistic production light.', prompt: 'cinematic still, realistic production lighting, controlled contrast, subtle filmic color grading, natural depth of field' },
    { id: 'indie-film', labelFr: 'Film indépendant', labelEn: 'Indie film', descriptionFr: 'Caméra proche, couleurs sourdes et grain fin.', descriptionEn: 'Intimate camera, muted color and fine grain.', prompt: 'independent film still, intimate handheld framing, muted natural colors, available light, subtle grain, understated cinematic mood' },
    { id: 'film-noir', labelFr: 'Film noir', labelEn: 'Film noir', descriptionFr: 'Ombres profondes et lumière dure.', descriptionEn: 'Deep shadows and hard directional light.', prompt: 'film noir cinematography, dramatic low-key lighting, deep shadows, hard directional light, monochrome tonal contrast' },
    { id: 'modern-blockbuster', labelFr: 'Blockbuster moderne', labelEn: 'Modern blockbuster', descriptionFr: 'Grande dynamique et finition spectaculaire.', descriptionEn: 'Wide dynamic range and polished spectacle.', prompt: 'modern cinematic production still, wide dynamic range, controlled teal-and-amber grading, dimensional lighting, polished lens rendering' },
    { id: 'vintage-cinema', labelFr: 'Cinéma vintage', labelEn: 'Vintage cinema', descriptionFr: 'Pellicule cinéma, grain et halation.', descriptionEn: 'Motion-picture film, grain and halation.', prompt: 'vintage motion-picture film still, soft lens rendering, organic grain, gentle halation, restrained period color grading' },
  ]),
  family('editorial', 'Éditorial et mode', 'Editorial and fashion', [
    { id: 'natural-editorial', labelFr: 'Éditorial naturel', labelEn: 'Natural editorial', descriptionFr: 'Mode raffinée avec retouche discrète.', descriptionEn: 'Refined fashion with restrained retouching.', prompt: 'contemporary fashion editorial photograph, refined composition, realistic skin texture, controlled natural light, restrained retouching' },
    { id: 'high-fashion', labelFr: 'Haute couture', labelEn: 'High fashion', descriptionFr: 'Direction artistique luxueuse et sculptée.', descriptionEn: 'Luxurious, sculpted art direction.', prompt: 'high-fashion magazine editorial, sophisticated art direction, sculpted lighting, luxurious color treatment, polished professional finish' },
    { id: 'beauty-campaign', labelFr: 'Campagne beauté', labelEn: 'Beauty campaign', descriptionFr: 'Peau détaillée et lumière douce précise.', descriptionEn: 'Detailed skin and precise soft lighting.', prompt: 'professional beauty campaign photograph, precise soft lighting, detailed natural skin, clean color rendering, subtle premium retouching' },
    { id: 'street-style', labelFr: 'Mode urbaine', labelEn: 'Street style', descriptionFr: 'Cadrage éditorial dans un environnement urbain.', descriptionEn: 'Editorial framing in an urban environment.', prompt: 'street-style fashion photography, candid editorial framing, natural urban lighting, contemporary magazine color treatment' },
    { id: 'classic-glamour', labelFr: 'Glamour classique', labelEn: 'Classic glamour', descriptionFr: 'Lumière élégante et finition photographique.', descriptionEn: 'Elegant light and a photographic finish.', prompt: 'classic glamour photography, elegant directional lighting, soft highlight bloom, refined posing, polished yet photographic finish' },
  ]),
  family('studio', 'Studio et portrait', 'Studio and portrait', [
    { id: 'soft-studio', labelFr: 'Studio doux', labelEn: 'Soft studio', descriptionFr: 'Grande boîte à lumière et ombres souples.', descriptionEn: 'Large softbox and gentle shadows.', prompt: 'professional studio portrait, large softbox lighting, soft shadows, neutral background, realistic skin detail, balanced exposure' },
    { id: 'high-key', labelFr: 'High-key lumineux', labelEn: 'Bright high-key', descriptionFr: 'Blancs propres et ombres légères.', descriptionEn: 'Clean whites and gentle shadows.', prompt: 'high-key studio photography, bright diffused lighting, clean whites, gentle shadows, airy tonal rendering' },
    { id: 'low-key', labelFr: 'Low-key dramatique', labelEn: 'Dramatic low-key', descriptionFr: 'Fond sombre et lumière directionnelle.', descriptionEn: 'Dark background and directional light.', prompt: 'low-key studio portrait, deep controlled shadows, narrow directional light, rich contrast, dark atmospheric background' },
    { id: 'rembrandt', labelFr: 'Rembrandt', labelEn: 'Rembrandt', descriptionFr: 'Modelé classique du visage.', descriptionEn: 'Classic dimensional facial modeling.', prompt: 'Rembrandt portrait lighting, soft triangular cheek light, dimensional facial modeling, painterly shadow transition, photographic realism' },
    { id: 'fine-art', labelFr: 'Fine art', labelEn: 'Fine art', descriptionFr: 'Palette retenue et finition de tirage galerie.', descriptionEn: 'Restrained palette and gallery-print finish.', prompt: 'fine-art photography, carefully controlled light, restrained color palette, elegant tonal transitions, gallery-print finish' },
  ]),
  family('flash-night', 'Flash et nuit', 'Flash and night', [
    { id: 'direct-flash', labelFr: 'Flash direct', labelEn: 'Direct flash', descriptionFr: 'Premier plan net et arrière-plan sombre.', descriptionEn: 'Crisp foreground and dark natural background.', prompt: 'direct on-camera flash photograph, crisp foreground exposure, rapid shadow falloff, dark natural background, authentic snapshot character' },
    { id: 'club-2000s', labelFr: 'Soirée années 2000', labelEn: '2000s nightclub', descriptionFr: 'Flash dur, couleurs de club et bruit compact.', descriptionEn: 'Harsh flash, club color and compact-camera noise.', prompt: 'early-2000s nightclub snapshot, harsh direct flash, colorful low ambient light, compact-camera noise, slight motion blur' },
    { id: 'party-point-shoot', labelFr: 'Compact de soirée', labelEn: 'Party point-and-shoot', descriptionFr: 'Mise au point imparfaite et instant spontané.', descriptionEn: 'Imperfect focus and spontaneous moment.', prompt: 'late-night point-and-shoot party photograph, built-in flash, imperfect focus, coarse grain, spontaneous framing' },
    { id: 'neon-night', labelFr: 'Néons nocturnes', labelEn: 'Neon night', descriptionFr: 'Reflets colorés et bruit haute sensibilité.', descriptionEn: 'Colored reflections and high-ISO noise.', prompt: 'night photography under mixed neon lighting, realistic colored reflections, deep ambient shadows, mild high-ISO noise' },
    { id: 'paparazzi-flash', labelFr: 'Paparazzi au flash', labelEn: 'Paparazzi flash', descriptionFr: 'Flash frontal puissant et cadrage vif.', descriptionEn: 'Powerful frontal flash and rushed framing.', prompt: 'paparazzi flash photography, powerful frontal flash, hard shadows, slightly rushed composition, candid celebrity-event aesthetic' },
  ]),
  family('experimental', 'Dégradé et expérimental', 'Degraded and experimental', [
    { id: 'lofi-jpeg', labelFr: 'Lo-fi JPEG', labelEn: 'Lo-fi JPEG', descriptionFr: 'Compression, bruit et résolution modeste.', descriptionEn: 'Compression, noise and modest resolution.', prompt: 'lo-fi digital photograph, visible JPEG compression, modest resolution, digital noise, imperfect color processing, authentic consumer-camera look' },
    { id: 'motion-blur', labelFr: 'Flou de mouvement', labelEn: 'Motion blur', descriptionFr: 'Mouvement de l’appareil et traces lumineuses.', descriptionEn: 'Camera movement and directional light trails.', prompt: 'intentional motion blur, handheld camera movement, directional light trails, partially sharp subject detail, energetic photographic imperfection' },
    { id: 'overexposed', labelFr: 'Surexposé', labelEn: 'Overexposed', descriptionFr: 'Hautes lumières brûlées et couleurs lavées.', descriptionEn: 'Clipped highlights and washed-out color.', prompt: 'deliberately overexposed photograph, clipped highlights, washed-out colors, soft contrast, accidental snapshot aesthetic' },
    { id: 'underexposed', labelFr: 'Sous-exposé', labelEn: 'Underexposed', descriptionFr: 'Ombres bruitées et dynamique limitée.', descriptionEn: 'Noisy shadows and limited dynamic range.', prompt: 'underexposed photograph, deep shadow noise, limited dynamic range, muted color detail, realistic low-light imperfection' },
    { id: 'lomography', labelFr: 'Lomographie', labelEn: 'Lomography', descriptionFr: 'Couleurs imprévisibles, vignette et fuites de lumière.', descriptionEn: 'Color shifts, vignette and light leaks.', prompt: 'lomography aesthetic, saturated color shifts, strong vignette, unpredictable exposure, light leaks, playful analog imperfections' },
    { id: 'cross-process', labelFr: 'Cross-processing', labelEn: 'Cross-processing', descriptionFr: 'Contraste fort et couleurs chimiques décalées.', descriptionEn: 'High contrast and shifted chemical color.', prompt: 'cross-processed film aesthetic, unusual color shifts, increased contrast, green and cyan shadows, warm distorted highlights' },
    { id: 'scanned-vintage', labelFr: 'Vieille photo scannée', labelEn: 'Scanned vintage print', descriptionFr: 'Papier, poussière, rayures et couleurs passées.', descriptionEn: 'Paper, dust, scratches and faded color.', prompt: 'scanned vintage print, faded colors, visible paper texture, fine dust and scratches, mild softness, authentic aging artifacts' },
  ]),
];

export const PHOTO_FILTERS = PHOTO_FILTER_FAMILIES.flatMap(group => group.filters);

export const findPhotoFilter = (id: string | null | undefined) => (
  id ? PHOTO_FILTERS.find(filter => filter.id === id) || null : null
);
