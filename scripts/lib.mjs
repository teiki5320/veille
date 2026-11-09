// Outils communs à la collecte, à la publication et aux tests.
// Aucune clé, aucun secret : Wikimedia et Openverse sont ouverts.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'https://teiki5320.github.io/veille';
export const USER_AGENT = 'VeilleKeur/1.0 (contact: admin@toakeur.com)';
export const MAX_ACTUS = 60;
export const MAX_PAR_PASSAGE = 12;
// Jean, 29/10 : 3 ou 4 actus par jour et par site, les plus pertinentes et les plus « buzz » (les deux passages comptés ensemble).
export const MAX_PAR_JOUR = 4;
export const jourParis = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
export const FENETRE_RECENTES = 20;

// ---------- Fichiers ----------
export const lireJson = (f, defaut) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return defaut;
  }
};
export const ecrireJson = (f, d) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
};

export function sites() {
  const dossier = path.join(RACINE, 'sites');
  return fs
    .readdirSync(dossier)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => lireJson(path.join(dossier, f), null))
    .filter(Boolean);
}

export const etatVide = () => ({ deja_vus: {}, flux: {}, images_recentes: [] });
export const lireEtat = (site) => ({ ...etatVide(), ...lireJson(path.join(RACINE, 'etat', `${site}.json`), {}) });
export const ecrireEtat = (site, etat) => ecrireJson(path.join(RACINE, 'etat', `${site}.json`), etat);

// ---------- URL et identifiant ----------
export function normaliserUrl(u) {
  try {
    const url = new URL(String(u).trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const k of [...url.searchParams.keys()]) if (/^utm_/i.test(k)) url.searchParams.delete(k);
    return url.toString();
  } catch {
    return String(u || '').trim();
  }
}
export const idDe = (u) => crypto.createHash('sha1').update(normaliserUrl(u)).digest('hex');

// ---------- Texte ----------
const ENTITES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â',
  aacute: 'á', auml: 'ä', ccedil: 'ç', icirc: 'î', iuml: 'ï', iacute: 'í', ocirc: 'ô', ouml: 'ö', oacute: 'ó', ugrave: 'ù',
  ucirc: 'û', uuml: 'ü', uacute: 'ú', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Agrave: 'À', Ccedil: 'Ç', oelig: 'œ', OElig: 'Œ',
  ntilde: 'ñ', euro: '€', deg: '°', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', times: '×',
};
export function decoderEntites(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n] ?? m);
}
export function texteSeul(html) {
  let s = decoderEntites(String(html ?? ''));
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  s = decoderEntites(s); // entités doublement encodées
  return s.replace(/\s+/g, ' ').trim();
}
export const couper = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

export const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const mots = (s) =>
  sansAccents(String(s ?? '').toLowerCase())
    .replace(/[’'`]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

// ---------- Anti-copie (règle 4) ----------
// Rejette si le texte réécrit reprend 6 mots consécutifs ou plus d'un texte d'origine.
export function suiteCopiee(texte, origines, n = 6) {
  const t = mots(texte);
  const grams = new Set();
  for (const o of origines) {
    const m = mots(o);
    for (let i = 0; i + n <= m.length; i++) grams.add(m.slice(i, i + n).join(' '));
  }
  for (let i = 0; i + n <= t.length; i++) {
    const g = t.slice(i, i + n).join(' ');
    if (grams.has(g)) return g;
  }
  return null;
}
// Toutes les suites reprises (fusionnées), pour pouvoir tout corriger en une seule réécriture.
export function suitesCopiees(texte, origines, n = 6) {
  const t = mots(texte);
  const grams = new Set();
  for (const o of origines) {
    const m = mots(o);
    for (let i = 0; i + n <= m.length; i++) grams.add(m.slice(i, i + n).join(' '));
  }
  const res = [];
  let fin = -1;
  for (let i = 0; i + n <= t.length; i++) {
    if (!grams.has(t.slice(i, i + n).join(' '))) continue;
    if (i <= fin && res.length) res[res.length - 1] = t.slice(res.debut, i + n).join(' ');
    else {
      res.push(t.slice(i, i + n).join(' '));
      res.debut = i;
    }
    fin = i + n;
  }
  return res;
}
export function controleAntiCopie(actu, origines) {
  return [
    ...suitesCopiees(actu.titre, origines).map((s) => `titre : « ${s} »`),
    ...suitesCopiees(actu.resume, origines).map((s) => `résumé : « ${s} »`),
  ];
}

// ---------- Article complet ----------
// Bornes de longueur : 300 à 450 mots visés ; si la source est trop mince pour
// tenir 300 mots sans rien inventer, 150 mots suffisent.
export const ARTICLE_MAX = 480;
export const ARTICLE_MIN = 300;
export const ARTICLE_MIN_SOURCE_MINCE = 150;
export const SOURCE_MINCE = 250;

export const textesArticle = (a) => [a?.chapo, ...(a?.blocs || []).flatMap((b) => [b.intertitre, ...(b.paragraphes || [])])].filter(Boolean).map(String);
export const motsArticle = (a) => textesArticle(a).reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0);
export const lectureMin = (n) => Math.max(1, Math.round(n / 220));

// Adresse de la page : titre sans accents + début de l'id (stable et unique).
export function slugDe(titre, id) {
  let base = '';
  const propre = String(titre).replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').replace(/ß/g, 'ss');
  for (const m of mots(propre).map((x) => x.replace(/[^a-z0-9]/g, '')).filter((x) => x.length > 1 || /\d/.test(x))) {
    if (base.length + m.length + 1 > 70) break;
    base = base ? `${base}-${m}` : m;
  }
  return `${base || 'actu'}-${String(id).slice(0, 6)}`;
}

// Défauts d'un article : longueur, forme, suites de 6 mots reprises de la source.
// motsSource : mots de tmp/sources/<site>/<id>.txt (source principale + textes ajoutés avec --ajoute).
// L'exception « source mince » (150 mots au lieu de 300) n'est accordée que si le rédacteur
// l'a demandée (source_mince: true) après avoir cherché la même info ailleurs : avant le 09/11,
// elle était automatique dès que la source faisait moins de 250 mots (ou n'avait pas été lue),
// et 15 articles de Keur Foot sont sortis entre 172 et 240 mots.
export function controleArticle(article, origines, motsSource, { autresSources = [], sourceMince = false } = {}) {
  const raisons = [];
  if (!article || typeof article !== 'object') return ['article manquant'];
  if (!article.chapo || String(article.chapo).length < 40) raisons.push('chapô manquant ou trop court (40 caractères au moins)');
  if (String(article.chapo || '').length > 320) raisons.push('chapô trop long (320 caractères au plus)');
  const blocs = Array.isArray(article.blocs) ? article.blocs : [];
  if (blocs.length < 2) raisons.push('au moins 2 blocs (intertitre + paragraphes)');
  if (blocs.some((b) => !Array.isArray(b.paragraphes) || !b.paragraphes.length)) raisons.push('chaque bloc a au moins un paragraphe');
  const n = motsArticle(article);
  const mince = motsSource < SOURCE_MINCE;
  if (!motsSource) raisons.push('source non lue (tmp/sources vide) : lance node scripts/sources.mjs <site> <id>, ou ajoute le texte d’un autre média avec --ajoute <adresse>');
  else if (mince && n < ARTICLE_MIN && !sourceMince) {
    raisons.push(
      autresSources.length
        ? `source mince (${motsSource} mots) alors que des autres_sources sont citées : ajoute leur texte avec node scripts/sources.mjs <site> <id> --ajoute <adresse>, puis écris 300 mots ; si tout reste mince, mets "source_mince": true`
        : `source mince (${motsSource} mots) : cherche la même info chez un autre média sérieux, ajoute son texte (node scripts/sources.mjs <site> <id> --ajoute <adresse>) et son adresse dans autres_sources, puis écris 300 mots ; seulement si rien n’existe, mets "source_mince": true (150 mots au moins)`,
    );
  }
  const min = mince && sourceMince ? ARTICLE_MIN_SOURCE_MINCE : ARTICLE_MIN;
  if (n < min && !(mince && !sourceMince && motsSource)) raisons.push(`trop court : ${n} mots (${min} au moins${min === ARTICLE_MIN ? '' : ', source mince'})`);
  if (n > ARTICLE_MAX) raisons.push(`trop long : ${n} mots (${ARTICLE_MAX} au plus)`);
  for (const t of textesArticle(article)) for (const s of suitesCopiees(t, origines)) raisons.push(`article : « ${s} »`);
  return raisons;
}

// ---------- Doublons avec les actus déjà en ligne ----------
// Deux passages (12 h et 19 h) voyaient la même nouvelle chez deux médias et la publiaient deux fois
// (Keur Bible : Avelino Chico, Vatican News puis ACI Africa ; Keur Foot : liste de Vieira, forfait de Mamadou Sarr…).
const MOTS_COURANTS_DOUBLON = new Set('avec dans pour sont plus leur cette entre apres avant mais comme tout tous deux trois fait faire lors sera aussi depuis encore leurs selon contre quand dont elle elles nous vous'.split(' '));
const NOMS_TROP_COURANTS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'en', 'et', 'il', 'elle', 'ils', 'ce', 'cette', 'son', 'sa', 'ses', 'pour', 'avec', 'dans', 'sur', 'apres', 'avant', 'selon', 'mais', 'lors', 'ligue', 'coupe', 'senegal', 'france', 'afrique', 'can', 'caf', 'maroc', 'nigeria']);
const nomsPropres = (t) => new Set((String(t).match(/\b\p{Lu}[\p{L}'’-]{2,}/gu) || []).map((w) => sansAccents(w.toLowerCase())).filter((w) => !NOMS_TROP_COURANTS.has(w)));
const motsPleins = (t) => new Set(mots(t).filter((w) => w.length >= 4 && !MOTS_COURANTS_DOUBLON.has(w)));
const jaccard = (x, y) => {
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n || 1);
};
export const SEUIL_DOUBLON = 0.34;
export const JOURS_DOUBLON = 5;
// Proximité de deux actus (titre + résumé ou chapô) : noms propres communs (poids 0,5) + mots pleins communs.
export function similariteActus(a, b) {
  const ta = `${a.titre || ''} ${a.resume || a.article?.chapo || ''}`;
  const tb = `${b.titre || ''} ${b.resume || b.article?.chapo || ''}`;
  return jaccard(nomsPropres(ta), nomsPropres(tb)) * 0.5 + jaccard(motsPleins(ta), motsPleins(tb));
}
// Actus déjà en ligne (publiées dans les JOURS_DOUBLON jours autour) qui ressemblent trop à r.
export function doublonsProbables(r, enLigne, { date = null } = {}) {
  const t = Date.parse(date || new Date().toISOString());
  return enLigne
    .filter((a) => a.id !== r.id && Math.abs(Date.parse(a.publie_le || a.collecte_le) - t) <= JOURS_DOUBLON * 86400000)
    .map((a) => ({ a, score: similariteActus(r, a) }))
    .filter((x) => x.score >= SEUIL_DOUBLON)
    .sort((x, y) => y.score - x.score)
    .map(({ a, score }) => ({ id: a.id, titre: a.titre, publie_le: a.publie_le, score: Math.round(score * 100) / 100 }));
}

// ---------- Anti-répétition des images ----------
export function imageDejaVue(origine, recentes) {
  const o = normaliserUrl(origine);
  return recentes.slice(0, FENETRE_RECENTES).some((r) => normaliserUrl(r.origine) === o);
}

// ---------- Carte générée (SVG 1600×900) ----------
const echapper = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const ICONES = ['ballon', 'livre', 'marmite', 'jarre', 'plante', 'soleil', 'croix'];

export const LIBELLES_THEMES = {
  foot: 'Football', politique: 'Politique', economie: 'Économie', societe: 'Société', culture: 'Culture', livres: 'Livres',
  bd: 'Bande dessinée', cuisine: 'Cuisine', deco: 'Déco', cadeaux: 'Cadeaux', 'culture-interieur': 'Culture en intérieur',
  entreprises: 'Entreprises',
};

function icone(nom, encre, x, y, taille) {
  const s = taille / 100;
  const g = (contenu) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${encre}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${contenu}</g>`;
  if (nom === 'marmite')
    return g(
      `<path d="M14 44 H86 V68 C86 80 76 88 64 88 H36 C24 88 14 80 14 68 Z"/><path d="M14 52 H5 M86 52 H95"/><path d="M10 44 C22 32 78 32 90 44"/><circle cx="50" cy="30" r="4" fill="${encre}"/><path d="M36 22 C32 16 40 12 36 5 M64 22 C60 16 68 12 64 5" stroke-width="3"/>`,
    );
  if (nom === 'jarre')
    return g(
      '<path d="M38 8 H62 M41 8 C41 19 35 22 27 30 C14 43 14 71 30 84 C39 91 61 91 70 84 C86 71 86 43 73 30 C65 22 59 19 59 8"/><path d="M19 48 H81 M18 64 H82" stroke-width="3"/><path d="M26 48 L32 64 L38 48 L44 64 L50 48 L56 64 L62 48 L68 64 L74 48" stroke-width="3"/>',
    );
  if (nom === 'plante')
    return g(
      `<rect x="12" y="6" width="76" height="12" rx="3" fill="${encre}"/><path d="M28 26 L23 37 M50 26 V39 M72 26 L77 37" stroke-width="3"/><path d="M30 70 H70 L64 93 H36 Z"/><path d="M50 70 V46"/><path d="M50 60 C37 60 29 52 29 42 C42 42 50 49 50 60 Z M50 53 C63 53 71 45 71 35 C58 35 50 42 50 53 Z" fill="${encre}"/>`,
    );
  if (nom === 'soleil')
    return g(
      `<circle cx="50" cy="50" r="19" fill="${encre}"/><path d="M50 5 V20 M50 80 V95 M5 50 H20 M80 50 H95 M18 18 L29 29 M71 71 L82 82 M82 18 L71 29 M29 71 L18 82"/>`,
    );
  if (nom === 'croix')
    return g(
      `<path d="M20 96 V46 C20 24 33 10 50 10 C67 10 80 24 80 46 V96"/><path d="M50 28 V80 M36 44 H64" stroke-width="8"/>`,
    );
  if (nom === 'livre')
    return g(
      '<path d="M50 22 C38 14 22 12 8 14 V82 C22 80 38 82 50 90 C62 82 78 80 92 82 V14 C78 12 62 14 50 22 Z"/><path d="M50 22 V90"/><path d="M18 30 C28 29 37 31 44 35 M18 46 C28 45 37 47 44 51 M18 62 C28 61 37 63 44 67 M82 30 C72 29 63 31 56 35 M82 46 C72 45 63 47 56 51 M82 62 C72 61 63 63 56 67" stroke-width="3"/>',
    );
  // ballon (par défaut)
  return g(
    `<circle cx="50" cy="50" r="44"/><path d="M50 30 L69 44 L62 66 L38 66 L31 44 Z" fill="${encre}"/><path d="M50 30 V7 M69 44 L91 37 M62 66 L76 86 M38 66 L24 86 M31 44 L9 37" stroke-width="4"/>`,
  );
}

function drapeau(pays, racine = RACINE) {
  if (!pays) return null;
  const f = path.join(racine, 'node_modules', 'flag-icons', 'flags', '4x3', `${String(pays).toLowerCase()}.svg`);
  if (!fs.existsSync(f)) return null;
  const src = fs.readFileSync(f, 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(src)?.[1] || '0 0 640 480';
  const ns = /xmlns:xlink=/.test(src) ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '';
  const interieur = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return { vb, ns, interieur };
}

export function carteSvg({ config, pays, libelle }) {
  const { fond, fond2, encre } = config.couleurs;
  const L = 1600;
  const H = 900;
  const bandes = Array.from({ length: 40 }, (_, i) => `<rect x="${i * 40 + 18}" y="0" width="4" height="${H}"/>`).join('');
  // drapeau: false dans la config (Kultiled, Solelis) : jamais de drapeau, l'icône au centre.
  const d = config.drapeau === false ? null : drapeau(pays?.[0]);
  let centre;
  if (d) {
    const w = 520;
    const h = 390;
    const x = (L - w) / 2;
    const y = 150;
    centre =
      `<rect x="${x - 10}" y="${y - 10}" width="${w + 20}" height="${h + 20}" rx="18" fill="${encre}" opacity="0.18"/>` +
      `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${d.vb}" preserveAspectRatio="xMidYMid slice"${d.ns}>${d.interieur}</svg>`;
  } else {
    centre = icone(config.icone, encre, (L - 340) / 2, 160, 340);
  }
  const texte = echapper(String(libelle || '').toUpperCase());
  const taille = texte.length > 26 ? 64 : texte.length > 18 ? 78 : 92;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" role="img" aria-label="${echapper(config.nom)} · Actus">
<defs><linearGradient id="fond" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${fond}"/><stop offset="1" stop-color="${fond2}"/></linearGradient></defs>
<rect width="${L}" height="${H}" fill="url(#fond)"/>
<g fill="${encre}" opacity="0.06">${bandes}</g>
${icone(config.icone, encre, L - 170, 50, 110)}
${centre}
<text x="${L / 2}" y="660" text-anchor="middle" fill="${encre}" font-family="'Barlow Condensed','Arial Narrow',Helvetica,Arial,sans-serif" font-weight="800" font-size="${taille}" letter-spacing="3">${texte}</text>
<text x="${L / 2}" y="830" text-anchor="middle" fill="${encre}" opacity="0.85" font-family="Helvetica,Arial,sans-serif" font-weight="600" font-size="40" letter-spacing="2">${echapper(config.nom)} · Actus</text>
</svg>
`;
}

// ---------- Réseau ----------
export async function telecharger(url, { delai = 20000, type = 'text' } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, signal: AbortSignal.timeout(delai), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (type === 'json') return r.json();
  if (type === 'buffer') return Buffer.from(await r.arrayBuffer());
  return r.text();
}

// ---------- Heure de Paris ----------
export function heureParis(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { jour: `${p.day}/${p.month}`, heure: `${Number(p.hour)} h${p.minute !== '00' ? ` ${p.minute}` : ''}` };
}
