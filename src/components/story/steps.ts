import type { Indicator, Scenario } from '../../lib/metricsTypes';

export interface StoryCamera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/**
 * État d'ouverture de l'application : carte neutre, aucun récit affiché,
 * choix d'entrée en attente. Les valeurs préchargées sont celles du
 * premier chapitre de STORY_STEPS, pour que « Découvrir les récits »
 * active exactement ce chapitre (couche, trajectoire, horizon) et que
 * changer de chapitre initial ne demande que de réordonner le tableau.
 */
export type EntryChoice = 'pending' | 'story' | 'explore' | 'closed';

export function openingState(): {
  mode: 'EXPLORE';
  entryChoice: EntryChoice;
  storyStep: 0;
  scenario: Scenario;
  indicator: Indicator;
  year: number;
} {
  const first = STORY_STEPS[0];
  if (!first) throw new Error('STORY_STEPS ne doit jamais être vide');
  return {
    mode: 'EXPLORE',
    entryChoice: 'pending',
    storyStep: 0,
    scenario: first.defaultScenario,
    indicator: first.layer,
    year: first.defaultYear,
  };
}

export interface StoryStep {
  /** Nature des données du chapitre : synthétique (démonstration), observée ou projetée. */
  dataNature?: 'synthetic' | 'observed' | 'projected';
  /** Source officielle des données, quand le chapitre est documenté. */
  sources?: string;
  /** Limites méthodologiques à afficher avec le récit. */
  limitations?: string;
  /** Période affichée pour les chapitres observés (défaut : 1982-2025). */
  periodLabel?: string;
  id: string;
  /** Aléa porté par la couche récit de ce chapitre. */
  layer: Indicator;
  chapter: string;
  title: string;
  description: string;
  narrative: string;
  bigStat: string;
  bigStatLabel: string;
  secondStat: string;
  secondStatLabel: string;
  camera: StoryCamera;
  defaultScenario: Scenario;
  defaultYear: number;
  /* Compat : accès direct utilisés par le store et la carte. */
  scenario: Scenario;
  indicator: Indicator;
  year: number;
}

export const STORY_STEPS: readonly StoryStep[] = [
  {
    id: 'ile-de-france-canicule',
    layer: 'heatwave',
    chapter: 'Chapter 1',
    title: '2050: The endless summer in Île-de-France',
    description: 'Summers comparable to those of Córdoba, Spain, for the Paris region.',
    narrative:
      'Under the current emissions trajectory, the Paris region will experience summers comparable to those of Córdoba in Spain. Urban heat islands and a lack of vegetation expose more than 3.5 million Île-de-France residents to consecutive tropical nights, overwhelming emergency services.',
    bigStat: '+35 nights',
    bigStatLabel: 'tropical nights each summer in Paris (above 20°C at night)',
    secondStat: '+28 days',
    secondStatLabel: 'above 35°C per year, and 4,200 avoidable hospitalizations',
    camera: { center: [2.35, 48.85], zoom: 10.2, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp585',
    defaultYear: 2050,
    scenario: 'ssp585',
    indicator: 'heatwave',
    year: 2050,
  },
  {
    id: 'gironde-argiles',
    layer: 'rga',
    chapter: 'Chapter 2',
    title: 'Gironde & Rhône Valley: The danger of clay shrink-swell',
    description: 'From Bordeaux to the Rhône corridor, soils that swell in winter, shrink in summer, and crack homes.',
    narrative:
      'The brutal alternation of wet winters and intense summer droughts causes clay soils to shrink and swell. More than 68% of the single-family housing stock is now cracked or at risk of becoming uninhabitable without massive underpinning work.',
    bigStat: '72%',
    bigStatLabel: 'of buildings exposed to cracking',
    secondStat: '€1.4 billion',
    secondStatLabel: 'in estimated compensation by 2050',
    camera: { center: [-0.58, 44.84], zoom: 10.2, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp585',
    defaultYear: 2050,
    scenario: 'ssp585',
    indicator: 'rga',
    year: 2050,
  },
  {
    id: 'sud-ouest-eau',
    layer: 'water_stress',
    chapter: 'Chapter 3',
    title: 'Water crisis and agricultural tensions in the South-West',
    description: 'Rivers at their lowest, and water uses coming into conflict.',
    narrative:
      'In the Adour-Garonne basin, the drop in summer river flows exceeds 40%. Conflicting uses between agricultural irrigation, energy cooling and drinking water force prefectures to impose restrictions as early as May.',
    bigStat: '−45%',
    bigStatLabel: 'in summer river flow',
    secondStat: '1 in 2',
    secondStatLabel: 'municipalities facing drinking water pressure',
    camera: { center: [1.44, 43.6], zoom: 10.2, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp245',
    defaultYear: 2100,
    scenario: 'ssp245',
    indicator: 'water_stress',
    year: 2100,
  },
  {
    id: 'paca-crues-eclairs',
    layer: 'flooding',
    chapter: 'Chapter 4',
    title: 'PACA & Mediterranean Arc: Flash floods',
    description: 'Torrential autumn rains on impermeable urban soils.',
    narrative:
      'From Nice to Montpellier, Mediterranean episodes dump the equivalent of several months of rain in a few hours onto largely impermeable cities. Urban runoff turns streets into torrents, floods ground floors and cuts off transport networks. Retention basins and soil de-sealing become civil protection infrastructure in their own right.',
    bigStat: '×2',
    bigStatLabel: 'increase in extreme rainfall intensity by 2050',
    secondStat: '1 in 3',
    secondStatLabel: 'residents exposed to flash flooding on the Mediterranean arc',
    camera: { center: [5.4, 43.55], zoom: 9.2, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp585',
    defaultYear: 2050,
    scenario: 'ssp585',
    indicator: 'flooding',
    year: 2050,
  },
  {
    id: 'alpes-neige',
    layer: 'water_stress',
    chapter: 'Chapter 5',
    title: 'Alps & Mountain ranges: The disappearing snow',
    description: 'The snowpack retreats, glaciers melt, resorts reinvent themselves.',
    narrative:
      'In the Alps, the Pyrenees and the Massif Central, the snowpack loses several weeks of cover per decade and the rain-snow line rises in altitude. Glaciers, summer water reserves, are melting in plain sight: summer flows in Alpine rivers are falling, rockfalls are multiplying on thawed rock faces, and mid-mountain resorts must transform their economic model before snow becomes exceptional.',
    bigStat: '−60%',
    bigStatLabel: 'of snow cover at 1,500 m by 2100',
    secondStat: '1 in 2',
    secondStatLabel: 'mid-mountain resorts without reliable snow at Christmas',
    camera: { center: [6.6, 45.9], zoom: 9.2, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp585',
    defaultYear: 2100,
    scenario: 'ssp585',
    indicator: 'water_stress',
    year: 2100,
  },
  {
    id: 'nord-canicule',
    layer: 'heatwave',
    chapter: 'Chapter 6',
    title: 'Hauts-de-France: The North is no longer sheltered from the heat',
    description: 'The region reputed to be the coolest in France sees its municipalities exposed to heatwaves triple in thirty years.',
    narrative:
      'The North was considered the region spared from extreme summers. In the project’s demonstration data (+4°C trajectory), the share of Hauts-de-France municipalities at high heatwave risk rises from 2.1% in 1990 to 6.4% in 2050, then 9.6% in 2100 — a tripling in thirty years. Locally, some municipalities already reach 22 heatwave days per year in 2050, in a built environment and with habits designed for a temperate climate: housing poorly adapted to night-time heat, an ageing population in former industrial basins. Figures calculated from the project’s demonstration partitions, to be confirmed with actual DRIAS projections.',
    bigStat: '6.4%',
    bigStatLabel: 'of municipalities at high heatwave risk in 2050 (2.1% in 1990)',
    secondStat: '×3',
    secondStatLabel: 'more municipalities exposed in thirty years; up to 22 heatwave days per year locally',
    camera: { center: [2.75, 49.95], zoom: 8.6, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp585',
    defaultYear: 2050,
    scenario: 'ssp585',
    indicator: 'heatwave',
    year: 2050,
  },
  {
    id: 'memoire-catastrophes',
    layer: 'catnat',
    chapter: 'Chapter 7',
    title: 'Natural disaster history: What France has already recognized',
    description: '247,140 official natural-disaster declarations (CatNat) since 1982: the administrative record of risk, municipality by municipality.',
    narrative:
      'Before projecting the future, let us look at what has already happened. Since 1982, the State has recognized 247,140 natural disasters in French municipalities (GASPAR database, Géorisques): flooding and mudslides first, then droughts and ground movements. Nearly nine in ten municipalities have been recognized at least once; the record reaches 83 declarations in a municipality in the Alpes-Maritimes. This history is not a physical measure of risk: a declaration also depends on requests from municipalities. But it shows where risk has already struck, been recognized and compensated — the starting point for any honest prevention. Observed data, with no projections: the map shows the recognized past, not the future.',
    bigStat: '83',
    bigStatLabel: 'declarations recognized in the most affected municipality, in the Alpes-Maritimes (GASPAR)',
    secondStat: '247,140',
    secondStatLabel: 'official natural-disaster declarations (CatNat) recognized in France since 1982',
    camera: { center: [2.55, 46.9], zoom: 5.9, pitch: 25, bearing: 0 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'catnat',
    year: 2025,
    dataNature: 'observed',
    sources:
      'Géorisques / GASPAR database (Ministry for Ecological Transition), official natural-disaster declarations (CatNat) 1982-2025, Licence Ouverte. Pipeline: scripts/build_catnat_partitions.py.',
    limitations:
      'A declaration is an administrative recognition, not a measure of hazard. No projection: the 2050 and 2100 horizons redisplay the cumulative total observed in 2025. The color scale counts cumulative declarations (capped at 25 or more).',
  },
  {
    id: 'habiter-cher-expose-prix',
    layer: 'prix_immo',
    chapter: 'Chapter 8',
    title: 'Property prices and disaster history (1) — Where housing costs the most',
    description: 'The median price per m² of 2023-2025 sales, municipality by municipality, where the market is active enough to measure it.',
    narrative:
      'First step: price. From 2,696,573 house and apartment sales retained in DVF (2023-2025), the median of municipal median prices reaches €2,042/m² — each municipality counts once; the median across all sales is €2,673/m². But this price can only be measured reliably in 11,919 municipalities with at least 30 sales: the others are shown in gray “not available”, with no substitute average. Prices peak in large metropolitan areas, on coastlines and in the mountains — the Alpes-Maritimes and Haute-Savoie both show a median municipal price close to €4,300/m². The next step will show whether this geography of prices overlaps with that of recognized disasters.',
    bigStat: '€2,042/m²',
    bigStatLabel: 'median of municipal median prices — each municipality counts once (DVF 2023-2025)',
    secondStat: '11,919',
    secondStatLabel: 'municipalities with at least 30 sales — the only ones interpreted individually',
    camera: { center: [2.55, 46.9], zoom: 5.9, pitch: 25, bearing: 0 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'prix_immo',
    year: 2025,
    dataNature: 'observed',
    periodLabel: 'DVF 2023-2025',
    sources:
      'DGFiP via data.gouv.fr, Demandes de valeurs foncières (DVF) 2023-2025, Licence Ouverte 2.0. Municipal median of prices per m² for house and apartment sales. Pipeline: scripts/build_dvf_catnat_partitions.py.',
    limitations:
      'DVF does not cover Alsace, Moselle or Mayotte. Prices describe properties sold, not the entire housing stock. Below 30 sales, the price is considered unreliable and should not be read municipality by municipality.',
  },
  {
    id: 'habiter-cher-expose-memoire',
    layer: 'catnat',
    chapter: 'Chapter 9',
    title: 'Property prices and disaster history (2) — Where disaster history weighs heaviest',
    description: 'The CatNat history of expensive territories… and of those that are not: two geographies that only partly overlap.',
    narrative:
      'Second step: history, reread across the same territories. The Alpes-Maritimes, among the most expensive, also carry the heaviest history: 83% of their municipalities with a reliable price have at least 10 CatNat declarations, with a median of 19 declarations. Haute-Savoie, just as expensive (around €4,300/m²), has only 14%, with a median of 6 declarations. Conversely, Indre, affordable (around €1,000/m²), shows 69% of municipalities with 10 declarations or more, driven by recognized droughts. History follows past hazards and administrative recognitions, not the price per square meter.',
    bigStat: '83%',
    bigStatLabel: 'of municipalities with a reliable price in the Alpes-Maritimes have at least 10 declarations (median: 19)',
    secondStat: '14%',
    secondStatLabel: 'in Haute-Savoie, just as expensive — history does not follow price',
    camera: { center: [6.9, 43.9], zoom: 8.4, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'catnat',
    year: 2025,
    dataNature: 'observed',
    periodLabel: 'CatNat 1982-2025',
    sources:
      'Géorisques / GASPAR database (Ministry for Ecological Transition), official natural-disaster declarations (CatNat) 1982-2025, Licence Ouverte; price levels DGFiP DVF 2023-2025. Pipeline: scripts/build_dvf_catnat_partitions.py.',
    limitations:
      'A declaration is an administrative recognition, not a future probability. The comparison covers only municipalities with a reliable price (at least 30 DVF sales).',
  },
  {
    id: 'habiter-cher-expose-croisement',
    layer: 'cher_expose',
    chapter: 'Chapter 10',
    title: 'Property prices and disaster history (3) — What the comparison shows, and what it does not',
    description: 'Where high prices and heavy history overlap — and where heavy history also concerns affordable territories.',
    narrative:
      'Third step: the comparison, without overstating its scope. At the level of municipalities with a reliable price, the link between price rank and CatNat history is weak (Spearman correlation of +0.13). There is nevertheless a gradient: 34% of the least expensive municipalities have at least 10 declarations, compared with 51% of the most expensive. In total, 1,507 expensive municipalities also accumulate a heavy history — Nice (€4,884/m², 83 declarations), Cannes (€5,895/m², 52 declarations) or Bordeaux (€4,625/m², 50 declarations). But 1,013 affordable municipalities also carry at least 10 declarations: prevention is not only about prized coastlines. This municipal comparison says neither why these territories overlap, nor which specific homes were damaged.',
    bigStat: '1,507',
    bigStatLabel: 'expensive municipalities (top quartile) with at least 10 CatNat declarations',
    secondStat: '+0.13',
    secondStatLabel: 'rank correlation between price and history (Spearman) — a weak link, not a rule',
    camera: { center: [7.15, 43.75], zoom: 9.2, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'cher_expose',
    year: 2025,
    dataNature: 'observed',
    periodLabel: 'DVF 2023-2025 × CatNat 1982-2025',
    sources:
      'Derived cross-reference DGFiP DVF 2023-2025 (median price per m², Licence Ouverte 2.0) × Géorisques GASPAR 1982-2025 (CatNat declarations, Licence Ouverte), by municipality INSEE code. Pipeline: scripts/build_dvf_catnat_partitions.py.',
    limitations:
      'Municipal conjunction: it locates neither damaged homes, nor a future probability, and establishes no causality between prices and disasters. Municipalities without a reliable price are excluded from the conjunction.',
  },
  {
    id: 'services-presence',
    layer: 'services',
    chapter: 'Chapter 11',
    title: 'Essential services (1) — What the municipality offers locally',
    description: 'Doctor, pharmacy, school, food, post office, bank, early childhood: the service categories present in each municipality.',
    narrative:
      'A new question, a new measure — and a precaution first. INSEE’s Base permanente des équipements records what is present in the municipality, not the distance a resident travels. From a basket of seven everyday categories (doctor, pharmacy, school, food, post office, bank, early childhood), 34.8% of French municipalities have none locally. School is the most widespread (61% of municipalities), bank the rarest (13%). A missing category does not say how far the nearest one is: it only says you will have to leave the municipality.',
    bigStat: '34.8%',
    bigStatLabel: 'of municipalities with none of the 7 service categories locally (BPE 2025)',
    secondStat: '61%',
    secondStatLabel: 'of municipalities have a school locally — only 13% have a bank',
    camera: { center: [2.55, 46.9], zoom: 5.9, pitch: 25, bearing: 0 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'services',
    year: 2025,
    dataNature: 'observed',
    periodLabel: 'BPE as of 1 January 2025',
    sources:
      'INSEE, Base permanente des équipements (BPE) 2025 as of 1 January 2025, Licence Ouverte. Basket of 7 categories (BPE TYPEQU codes): doctor D265, pharmacy D307, school C107-C109, food B104-B105-B202-B207, post office A206, bank A203, early childhood D502-D509. Pipeline: scripts/build_bpe_partitions.py.',
    limitations:
      'Presence in the municipality, not distance or travel time: the nearest service may be in the neighboring municipality. No weighting by population. The basket of 7 categories is a documented choice, not an official definition.',
  },
  {
    id: 'services-sante',
    layer: 'services',
    chapter: 'Chapter 12',
    title: 'Essential services (2) — Where even the doctor and pharmacy are missing',
    description: 'The local health deficit: nearly three-quarters of municipalities without a doctor or pharmacy locally.',
    narrative:
      'A closer look at health, the most sensitive category in the basket. In 72.2% of municipalities, there is neither a general practitioner nor a pharmacy locally. The departments of Meuse and Haute-Marne have around 72% of municipalities with none of the seven categories. This does not mean their residents are without care: they consult in neighboring market towns and small towns, at the cost of trips this map does not measure. What it shows is the daily dependence on a car or mutual help as soon as care is needed close to home.',
    bigStat: '72.2%',
    bigStatLabel: 'of municipalities without a general practitioner or pharmacy locally (BPE 2025)',
    secondStat: '72%',
    secondStatLabel: 'of municipalities in Meuse with no service category at all — the same in Haute-Marne',
    camera: { center: [5.35, 48.7], zoom: 8.0, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'services',
    year: 2025,
    dataNature: 'observed',
    periodLabel: 'BPE as of 1 January 2025',
    sources:
      'INSEE, Base permanente des équipements (BPE) 2025 as of 1 January 2025, Licence Ouverte. Health categories in the basket: general practitioner D265, pharmacy D307. Pipeline: scripts/build_bpe_partitions.py.',
    limitations:
      'Absence locally does not mean absence of access: actual distances depend on living areas and travel times, not measured here. The professionals counted are the facilities recorded by the BPE, as of 1 January 2025.',
  },
  {
    id: 'services-densite',
    layer: 'services',
    chapter: 'Chapter 13',
    title: 'Essential services (3) — Well-equipped market towns, dispersed rural areas: The real divide',
    description: 'Neither “all rural” nor “all urban”: INSEE’s density grid reveals a divide within rural areas themselves.',
    narrative:
      'Final step: compare without caricature, using INSEE’s density grid. In urban centers, 97% of municipalities bring together at least five categories. In rural areas with very dispersed housing, 88% have none or only one. But rural is not a single block: rural market towns show a median of four categories, and 48% bring together at least five — they are the ones that keep local access going. Conversely, 12% of small towns have none or only one category locally. The divide is less between city and countryside than between centers that concentrate and dispersed areas that depend on them.',
    bigStat: '88%',
    bigStatLabel: 'of rural municipalities with very dispersed housing have 0 or 1 category locally (BPE × INSEE density)',
    secondStat: '48%',
    secondStatLabel: 'of rural market towns bring together at least 5 categories — the local relays of rural areas',
    camera: { center: [2.6, 47.6], zoom: 7.6, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'services',
    year: 2025,
    dataNature: 'observed',
    periodLabel: 'BPE as of 1 January 2025',
    sources:
      'INSEE, Base permanente des équipements (BPE) 2025 and 7-level municipal density grid (BPE DENS7 field), Licence Ouverte. Pipeline: scripts/build_bpe_partitions.py.',
    limitations:
      'Density classifies the municipality of location, not the journeys of its residents. “Relay” market towns are a statistical reading of local presence, not a measure of their actual use.',
  },
  {
    id: 'voiture-possession',
    layer: 'voiture_menages',
    chapter: 'Chapter 14',
    title: 'Can you live without a car? (1) — A car in almost every household',
    description: 'The share of households with at least one car, municipality by municipality.',
    narrative:
      'After services, mobility — starting by not confusing owning with depending. According to the 2023 census, 81.2% of French households have at least one car. But this national average hides saturation: the median municipality shows 94.8% of households with a car, and only 39 municipalities fall below 50%. Paris is the exception (31%), followed by large dense cities. In other words, outside urban centers, not having a car is already a rare situation — which does not yet say how people travel each day.',
    bigStat: '81.2%',
    bigStatLabel: 'of households have at least one car (2023 Census)',
    secondStat: '94.8%',
    secondStatLabel: 'in the median municipality — car ownership is almost universal there',
    camera: { center: [2.55, 46.9], zoom: 5.9, pitch: 25, bearing: 0 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'voiture_menages',
    year: 2025,
    dataNature: 'observed',
    periodLabel: '2023 Census',
    sources:
      'INSEE, 2023 population census via the Melodi API (DS_RP_LOGEMENT_PRINC), Licence Ouverte 2.0: households in main residences with at least one car (CARS = C_GE1). Pipeline: scripts/build_mobilite_partitions.py.',
    limitations:
      'Ownership does not equal use or dependence. Below 30 households, the municipal share is not shown (data not available). The census is a rolling collection: municipal values are estimates, centered on 2023.',
  },
  {
    id: 'voiture-usage-travail',
    layer: 'voiture_travail',
    chapter: 'Chapter 15',
    title: 'Can you live without a car? (2) — Getting to work: The default mode',
    description: 'The share of working people who drive to work, from Paris to rural market towns.',
    narrative:
      'Second step: use, through the home-to-work commute of employed workers. Nationally, 69.1% travel to work by car; in the median municipality, it is 87.3%, and 81.5% of municipalities exceed 80%. The contrast follows density: 63% in dense urban centers, up to 89% in rural areas with dispersed housing. An important nuance: very dispersed rural areas fall back to 84% — more workers there work locally or without traveling, which the car ownership rate alone did not suggest. Paris, meanwhile, counts only 9% of workers by car.',
    bigStat: '87.3%',
    bigStatLabel: 'of workers in the median municipality travel to work by car (2023 Census)',
    secondStat: '9%',
    secondStatLabel: 'in Paris — 63% in dense urban centers, 89% in dispersed rural areas',
    camera: { center: [2.55, 46.9], zoom: 5.9, pitch: 25, bearing: 0 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'voiture_travail',
    year: 2025,
    dataNature: 'observed',
    periodLabel: '2023 Census',
    sources:
      'INSEE, 2023 population census via the Melodi API (DS_RP_NAVETTES_PRINC), Licence Ouverte 2.0: employed workers aged 15 or over, main mode of transport (TRANS = 5). Cross-references by density: INSEE 7-level grid (BPE 2025). Pipeline: scripts/build_mobilite_partitions.py.',
    limitations:
      'Home-to-work commute only, declared main mode: other reasons for travel, distances and times are not measured. Below 30 workers, share not shown.',
  },
  {
    id: 'voiture-alternatives',
    layer: 'transports_communs',
    chapter: 'Chapter 16',
    title: 'Can you live without a car? (3) — Where the alternative exists',
    description: 'Public transport for commuting to work: a narrow geography, concentrated on large urban areas.',
    narrative:
      'Third step: the collective alternative. It exists, but its geography is narrow. In the median municipality, only 1.8% of workers travel to work by public transport; only 5.5% of municipalities exceed 10%. At the other extreme, Paris reaches 61%, Lyon 39%, Lille 36%, Nice and Bordeaux around 30%. A low share does not prove an absence of demand: it may reflect a nonexistent or unsuitable offer, which this census does not describe. What the map establishes is where the collective alternative is now a real and widespread practice — and everywhere else, where it remains to be built.',
    bigStat: '1.8%',
    bigStatLabel: 'of workers in the median municipality travel to work by public transport (2023 Census)',
    secondStat: '61%',
    secondStatLabel: 'in Paris — 39% in Lyon, 36% in Lille: the alternative is primarily metropolitan',
    camera: { center: [2.45, 48.75], zoom: 9.2, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'transports_communs',
    year: 2025,
    dataNature: 'observed',
    periodLabel: '2023 Census',
    sources:
      'INSEE, 2023 population census via the Melodi API (DS_RP_NAVETTES_PRINC), Licence Ouverte 2.0: employed workers aged 15 or over, public transport (TRANS = 6). Pipeline: scripts/build_mobilite_partitions.py.',
    limitations:
      'The modal share describes neither the offer (lines, frequencies) nor its quality. Below 30 workers, share not shown. Walking, cycling and two-wheelers are not mapped in this chapter.',
  },
  {
    id: 'voiture-services-cumul',
    layer: 'voiture_travail',
    chapter: 'Chapter 17',
    title: 'Can you live without a car? (4) — Even with services, the car dominates',
    description: 'Cross-reference with the services story: the presence of services locally is not enough to loosen car use.',
    narrative:
      'Final step: cross-reference mobility and services, without turning it into causality. In well-provided rural market towns (at least four of the seven service categories from Chapter 11), the share of workers driving to work remains at a median of 85%, compared with 90% in market towns with no services at all. In urban belts, the gap is of the same order: 85% compared with 89%. Having a school, a pharmacy and a bakery locally therefore changes something, but does not overturn the default mode — work, meanwhile, is often elsewhere. This is where real dependence plays out: less in household equipment than in the daily distance between home, job and services.',
    bigStat: '85%',
    bigStatLabel: 'of workers drive in market towns well provided with services (≥ 4 categories, 2023 Census × BPE 2025)',
    secondStat: '90%',
    secondStatLabel: 'in market towns with no services locally — the gap exists, it remains narrow',
    camera: { center: [4.9, 45.65], zoom: 8.4, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'voiture_travail',
    year: 2025,
    dataNature: 'observed',
    periodLabel: '2023 Census',
    sources:
      'Derived cross-reference INSEE RP 2023 (Melodi, DS_RP_NAVETTES_PRINC, Licence Ouverte 2.0) × INSEE BPE 2025 (service categories, Licence Ouverte), by municipality and density class. Pipeline: scripts/build_mobilite_partitions.py and scripts/build_bpe_partitions.py.',
    limitations:
      'Descriptive comparison between groups of municipalities: it does not establish that services reduce car use. Home-to-work commutes cross municipal boundaries, which the map does not trace.',
  },
  {
    id: 'synthese-cumul',
    layer: 'fragilites',
    chapter: 'Chapter 18',
    title: 'Synthesis (1) — Counting fragilities, without merging them',
    description: 'A count of unfavorable observed dimensions — history, services, car — not a fragility score.',
    narrative:
      'Synthesis, then — but no overall score. This map counts, with equal weights, how many observed dimensions cross a documented unfavorable threshold: at least 10 CatNat declarations since 1982, at most 2 of the 7 service categories locally, at least 80% of workers driving to work. Of 29,735 assessable municipalities, 3,022 (10.2%) accumulate all three dimensions, and 4.2% none. The most frequent combination associates scarce services and dominant car use, without a heavy history: more than 15,000 municipalities. The project’s climate layers, demonstration simulations, are deliberately excluded from this count.',
    bigStat: '3,022',
    bigStatLabel: 'municipalities accumulate all 3 unfavorable dimensions (10.2% of municipalities assessed)',
    secondStat: '4.2%',
    secondStatLabel: 'of municipalities assessed cross none — the count is not a ranking',
    camera: { center: [2.55, 46.9], zoom: 5.9, pitch: 25, bearing: 0 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'fragilites',
    year: 2025,
    dataNature: 'observed',
    periodLabel: 'Observed 2023-2025 (synthesis)',
    sources:
      'Count derived from the project’s observed indicators: GASPAR 1982-2025, INSEE BPE 2025, INSEE RP 2023 (Licences Ouvertes). Thresholds and indicator audit: data/metrics/synthese_metadata.json. Pipeline: scripts/build_synthese_partitions.py.',
    limitations:
      'Conventional and documented thresholds, not standards: moving them changes the counts, not the data. If the car share is not established (fewer than 30 workers), the cumulative count is not calculated (missing data). Juxtaposed vintages (2023, 2025, 1982-2025), not a snapshot at a single date.',
  },
  {
    id: 'synthese-profils',
    layer: 'fragilites',
    chapter: 'Chapter 19',
    title: 'Synthesis (2) — Contrasting profiles, not a podium',
    description: 'Metropolises marked by disaster history alone, relay market towns, dispersed rural areas with a triple accumulation.',
    narrative:
      'The count does not say why: the profiles, themselves, tell the story. Paris, Lyon, Marseille, Nice and Bordeaux show only one unfavorable dimension — their heavy CatNat history (20 to 83 declarations) — with 7 service categories out of 7, a minority car use and real public transport. At the opposite extreme, 12.5% of rural municipalities with very dispersed housing accumulate all three dimensions, compared with 0% in dense urban centers, where 25% of municipalities cross none. Between the two, market towns and small towns sustain local services. Click a municipality: its fact sheet details each observed dimension, the price in context, and reminds what the synthesis does not mix.',
    bigStat: '12.8%',
    bigStatLabel: 'of rural municipalities with very dispersed housing accumulate all 3 dimensions (BPE × synthesis)',
    secondStat: '27%',
    secondStatLabel: 'of dense urban centers cross none — their fragilities lie elsewhere',
    camera: { center: [4.95, 49.55], zoom: 8.2, pitch: 35, bearing: -8 },
    defaultScenario: 'ssp245',
    defaultYear: 2025,
    scenario: 'ssp245',
    indicator: 'fragilites',
    year: 2025,
    dataNature: 'observed',
    periodLabel: 'Observed 2023-2025 (synthesis)',
    sources:
      'Count derived from the project’s observed indicators (GASPAR, BPE 2025, RP 2023) cross-referenced with the INSEE 7-level density grid. Pipeline: scripts/build_synthese_partitions.py.',
    limitations:
      'The same cumulative count can cover opposite realities (a metropolis with a heavy history, a rural municipality without services): always read the profile dimension by dimension, never the total alone. Count thresholds: previous chapter and metadata. Synthetic climate dimensions remain outside the observed synthesis.',
  },
];
