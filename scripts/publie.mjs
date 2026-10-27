// Étape 3 du passage (aucune IA) : contrôle anti-copie, image libre (ou carte),
// fusion avec les actus déjà publiées, validation du schéma v3, puis commit et push.
//
// Usage :
//   node scripts/publie.mjs --verifier   → contrôle anti-copie seul, écrit tmp/rejets-<site>.json
//   node scripts/publie.mjs              → publie (les actus encore rejetées sont abandonnées)
//   options : --sans-git (ne commit pas), et des noms de sites pour se limiter (keurfoot keurbook)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  RACINE, BASE_URL, MAX_ACTUS, MAX_PAR_PASSAGE, FENETRE_RECENTES, LIBELLES_THEMES,
  sites, lireJson, ecrireJson, lireEtat, ecrireEtat, controleAntiCopie, imageDejaVue,
  carteSvg, telecharger, mots, texteSeul, couper, heureParis, normaliserUrl,
} from './lib.mjs';

// ---------- Validation ----------
export function validateur() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(lireJson(path.join(RACINE, 'schema', 'actus-schema-v3.json')));
}

// ---------- Licences ----------
export function licenceWikimediaLibre(nom) {
  const n = String(nom || '').trim().toLowerCase();
  if (!n || /\bnc\b|-nc|\bnd\b|-nd|fair use|non-free/.test(n)) return false;
  return /^(cc0|cc-zero|public domain|pd\b|pd-|cc[ -]by(-sa)?([ -]\d|$))/.test(n);
}
export const auteurConnu = (a) => Boolean(a && String(a).trim()) && !/\b(unknown|inconnu|anonymous|anonyme|not provided)\b/i.test(String(a));
const LICENCES_OPENVERSE = { cc0: 'CC0', pdm: 'Domaine public (PDM)', by: 'CC BY', 'by-sa': 'CC BY-SA' };

const MOTS_VIDES = new Set(['the', 'and', 'des', 'les', 'une', 'pour', 'with', 'from', 'aux', 'sur', 'par', 'dans', 'football', 'soccer']);
const significatifs = (q) => [...new Set(mots(q).filter((m) => m.length >= 3 && !MOTS_VIDES.has(m)))];
const EXCLUS = /\b(logo|signature|map|carte|blason|coat of arms|crest|badge|kit|maillot|diagram|chart|icon|flag)\b/i;

// Pertinence : le titre / la description de l'image doivent parler du sujet.
export function pertinente(requete, texteImage, { tous = false } = {}) {
  const attendus = significatifs(requete);
  if (!attendus.length) return false;
  const vus = new Set(mots(texteImage));
  const trouves = attendus.filter((m) => vus.has(m)).length;
  return tous ? trouves === attendus.length : trouves >= Math.max(1, Math.ceil(attendus.length / 2));
}

// ---------- Sources d'images ----------
async function chercherWikimedia(requete) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: requete, gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1600' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const d = await telecharger(u.toString(), { type: 'json', delai: 20000 });
  const pages = Object.values(d?.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const res = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const m = ii.extmetadata || {};
    const licence = texteSeul(m.LicenseShortName?.value);
    const auteur = couper(texteSeul(m.Artist?.value), 120);
    const titre = String(p.title || '').replace(/^File:/, '');
    const description = texteSeul(m.ImageDescription?.value) + ' ' + texteSeul(m.ObjectName?.value) + ' ' + texteSeul(m.Categories?.value).replace(/\|/g, ' ');
    if (!/^image\/(jpeg|png|webp)$/.test(ii.mime || '')) continue;
    if ((ii.width || 0) < 600) continue;
    if (!licenceWikimediaLibre(licence) || !auteurConnu(auteur)) continue;
    if (EXCLUS.test(titre)) continue;
    if (!pertinente(requete, `${titre} ${description}`, { tous: true })) continue;
    res.push({ source: 'wikimedia', origine: ii.url, telechargement: ii.thumburl || ii.url, credit: auteur, licence, page: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}` });
  }
  return res;
}

async function chercherOpenverse(requete) {
  const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(requete)}&license_type=commercial&page_size=10`;
  const d = await telecharger(u, { type: 'json', delai: 20000 });
  const res = [];
  for (const r of d?.results || []) {
    const lic = String(r.license || '').toLowerCase();
    if (!LICENCES_OPENVERSE[lic]) continue;
    if (!auteurConnu(r.creator)) continue;
    if (r.width && r.width < 600) continue;
    const texteImage = `${r.title || ''} ${(r.tags || []).map((t) => t.name).join(' ')}`;
    if (EXCLUS.test(r.title || '')) continue;
    if (!pertinente(requete, texteImage)) continue;
    const licence = lic === 'pdm' ? LICENCES_OPENVERSE.pdm : `${LICENCES_OPENVERSE[lic]}${r.license_version && lic !== 'pdm' ? ` ${r.license_version}` : ''}`;
    res.push({ source: 'openverse', origine: r.url, telechargement: r.url, credit: couper(String(r.creator).trim(), 120), licence, page: r.foreign_landing_url || r.url });
  }
  return res;
}

// Banque perso : banque/<site>/index.json = [{ fichier, credit, licence, page, mots_cles: [] }] (vide au départ).
function chercherBanque(site, requete) {
  const dossier = path.join(RACINE, 'banque', site);
  const index = lireJson(path.join(dossier, 'index.json'), []);
  return (Array.isArray(index) ? index : [])
    .filter((e) => e.fichier && fs.existsSync(path.join(dossier, e.fichier)) && pertinente(requete, (e.mots_cles || []).join(' ')))
    .map((e) => ({ source: 'banque', origine: `banque/${site}/${e.fichier}`, fichierLocal: path.join(dossier, e.fichier), credit: e.credit || 'Banque perso', licence: e.licence ?? null, page: e.page ?? null }));
}

export async function enregistrerPhoto(buffer, site, id) {
  const dossier = path.join(RACINE, 'images', site);
  fs.mkdirSync(dossier, { recursive: true });
  const base = sharp(buffer, { failOn: 'none' }).rotate();
  // Photo en hauteur (souvent une personne) : on garde le haut pour ne pas couper la tête.
  const meta = await base.metadata();
  const portrait = (meta.autoOrient?.height || meta.height || 0) > (meta.autoOrient?.width || meta.width || 0) * 1.05;
  const position = portrait ? 'north' : 'attention';
  await base.clone().resize(1600, 900, { fit: 'cover', position }).webp({ quality: 80 }).toFile(path.join(dossier, `${id}.webp`));
  await base.clone().resize(600, 600, { fit: 'cover', position }).webp({ quality: 80 }).toFile(path.join(dossier, `${id}-carre.webp`));
}

export function enregistrerCarte(config, actu) {
  const dossier = path.join(RACINE, 'cartes', config.site);
  fs.mkdirSync(dossier, { recursive: true });
  const libelle = actu.competition || LIBELLES_THEMES[actu.theme] || config.nom;
  fs.writeFileSync(path.join(dossier, `${actu.id}.svg`), carteSvg({ config, pays: actu.pays, libelle }));
}

async function trouverImage(config, r, recentes, journal) {
  const req = r.image_requetes || {};
  const essais = [
    ...(req.wikimedia || []).map((q) => ['wikimedia', q]),
    ...(req.openverse || []).map((q) => ['openverse', q]),
    ...[...(req.openverse || []), ...(req.wikimedia || [])].map((q) => ['banque', q]),
  ];
  for (const [source, q] of essais) {
    let trouves = [];
    try {
      trouves = source === 'wikimedia' ? await chercherWikimedia(q) : source === 'openverse' ? await chercherOpenverse(q) : chercherBanque(config.site, q);
    } catch (e) {
      journal.push(`${source} « ${q} » : ${e.message}`);
      continue;
    }
    for (const t of trouves) {
      if (imageDejaVue(t.origine, recentes)) continue;
      try {
        const buf = t.fichierLocal ? fs.readFileSync(t.fichierLocal) : await telecharger(t.telechargement, { type: 'buffer', delai: 30000 });
        await enregistrerPhoto(buf, config.site, r.id);
        return {
          origine: t.origine,
          image: { url: `${BASE_URL}/images/${config.site}/${r.id}.webp`, source: t.source, credit: t.credit, licence: t.licence, page: t.page, alt: couper(r.image_alt, 160), mots_cles: [q], largeur: 1600, hauteur: 900 },
        };
      } catch (e) {
        journal.push(`téléchargement ${t.origine} : ${e.message}`);
      }
    }
  }
  enregistrerCarte(config, r);
  return {
    origine: `carte:${config.site}:${r.id}`,
    image: { url: `${BASE_URL}/cartes/${config.site}/${r.id}.svg`, source: 'carte', credit: `Illustration : ${config.nom}`, licence: null, page: null, alt: couper(r.image_alt, 160), mots_cles: [...(req.wikimedia || []), ...(req.openverse || [])].slice(0, 6), largeur: 1600, hauteur: 900 },
  };
}

// ---------- Contrôle anti-copie d'un lot ----------
export function verifierLot(redaction, candidats) {
  const parId = new Map(candidats.map((c) => [c.id, c]));
  const ok = [];
  const rejets = [];
  for (const r of redaction) {
    const principal = parId.get(r.id);
    if (!principal) {
      rejets.push({ id: r.id, titre: r.titre, raisons: ['id inconnu dans tmp/candidats (utilise l’id du candidat principal)'] });
      continue;
    }
    const origines = [principal, ...(r.autres_ids || []).map((i) => parId.get(i)).filter(Boolean)].flatMap((c) => [c.titre_original, c.description]);
    const raisons = controleAntiCopie(r, origines);
    if (raisons.length) rejets.push({ id: r.id, titre: r.titre, resume: r.resume, raisons, titre_original: principal.titre_original, description_origine: principal.description });
    else ok.push(r);
  }
  return { ok, rejets };
}

function nettoyerOrphelins(site, gardes) {
  const ids = new Set(gardes);
  let n = 0;
  for (const dossier of [path.join(RACINE, 'images', site), path.join(RACINE, 'cartes', site)]) {
    if (!fs.existsSync(dossier)) continue;
    for (const f of fs.readdirSync(dossier)) {
      const id = f.replace(/(-carre)?\.(webp|svg)$/, '');
      if (/^[0-9a-f]{40}$/.test(id) && !ids.has(id)) {
        fs.unlinkSync(path.join(dossier, f));
        n++;
      }
    }
  }
  return n;
}

async function publierSite(config, { verifierSeul, valider }) {
  const site = config.site;
  const redac = lireJson(path.join(RACINE, 'tmp', `redaction-${site}.json`), null);
  const cand = lireJson(path.join(RACINE, 'tmp', `candidats-${site}.json`), { candidats: [] });
  const redaction = Array.isArray(redac) ? redac : redac?.actus || [];
  const { ok, rejets } = verifierLot(redaction, cand.candidats || []);
  ecrireJson(path.join(RACINE, 'tmp', `rejets-${site}.json`), rejets);
  if (verifierSeul) return { site, nom: config.nom, verifie: redaction.length, rejets: rejets.length };

  const etat = lireEtat(site);
  const parId = new Map((cand.candidats || []).map((c) => [c.id, c]));
  const ancien = lireJson(path.join(RACINE, 'actus', `${site}.json`), { actus: [] });
  const dejaPublies = new Set((ancien.actus || []).map((a) => a.id));
  const origines = { ...(etat.origines || {}) };
  const recentes = (ancien.actus || []).slice(0, FENETRE_RECENTES).map((a) => ({ id: a.id, origine: origines[a.id] || a.image?.url }));
  const journal = [];
  const nouvelles = [];
  const maintenant = new Date().toISOString();
  for (const r of ok.filter((x) => !dejaPublies.has(x.id)).slice(0, MAX_PAR_PASSAGE)) {
    const c = parId.get(r.id);
    const autres = [...new Set((r.autres_ids || []).map((i) => parId.get(i)?.lien).filter((u) => u && u !== c.lien))];
    const base = {
      id: r.id,
      titre: String(r.titre).trim(),
      resume: String(r.resume).trim(),
      theme: r.theme || config.theme_defaut,
      pays: (r.pays || []).map((p) => String(p).toUpperCase()),
      ...(site === 'keurfoot' ? { competition: r.competition || null } : {}),
      ...(r.tags?.length ? { tags: r.tags } : {}),
      source_nom: c.source,
      source_url: c.lien,
      ...(autres.length ? { autres_sources: autres } : {}),
      publie_le: c.date,
      collecte_le: maintenant,
      langue: c.langue || 'fr',
    };
    const { origine, image } = await trouverImage(config, { ...r, ...base }, recentes, journal);
    recentes.unshift({ id: r.id, origine });
    origines[r.id] = origine;
    nouvelles.push({ ...base, image });
  }

  const fusion = new Map();
  for (const a of [...nouvelles, ...(ancien.actus || [])]) if (!fusion.has(a.id)) fusion.set(a.id, a);
  const actus = [...fusion.values()].sort((a, b) => b.publie_le.localeCompare(a.publie_le)).slice(0, MAX_ACTUS);
  const doc = { version: 3, site, genere_le: maintenant, actus };

  // Les déjà-vus : tout ce qui a été lu à ce passage (gardé ou non).
  const limite = Date.now() - 10 * 86400000;
  for (const c of cand.candidats || []) etat.deja_vus[c.id] ||= maintenant;
  for (const [id, le] of Object.entries(etat.deja_vus)) if (Date.parse(le) < limite) delete etat.deja_vus[id];

  if (!valider(doc)) {
    for (const a of nouvelles) for (const f of [`images/${site}/${a.id}.webp`, `images/${site}/${a.id}-carre.webp`, `cartes/${site}/${a.id}.svg`]) fs.rmSync(path.join(RACINE, f), { force: true });
    const erreurs = (valider.errors || []).slice(0, 5).map((e) => `${e.instancePath} ${e.message}`);
    ecrireEtat(site, etat);
    return { site, nom: config.nom, publie: false, nouvelles: 0, erreur: `fichier invalide (schéma v3) : ${erreurs.join(' ; ')}`, rejets: rejets.length, journal };
  }
  ecrireJson(path.join(RACINE, 'actus', `${site}.json`), doc);
  const garder = new Set(actus.map((a) => a.id));
  etat.origines = Object.fromEntries(Object.entries(origines).filter(([id]) => garder.has(id)));
  etat.images_recentes = actus.slice(0, FENETRE_RECENTES).map((a) => ({ id: a.id, origine: etat.origines[a.id] || a.image.url }));
  ecrireEtat(site, etat);
  const supprimes = nettoyerOrphelins(site, garder);
  const types = nouvelles.reduce((acc, a) => ((acc[a.image.source] = (acc[a.image.source] || 0) + 1), acc), {});
  return { site, nom: config.nom, publie: true, nouvelles: nouvelles.length, total: actus.length, images: types, abandonnees: rejets.length, orphelins_supprimes: supprimes, journal };
}

function git(...args) {
  return execFileSync('git', args, { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function principal() {
  const args = process.argv.slice(2);
  const verifierSeul = args.includes('--verifier');
  const sansGit = args.includes('--sans-git');
  const demandes = args.filter((a) => !a.startsWith('--'));
  const valider = validateur();
  const bilan = [];
  for (const config of sites()) {
    if (demandes.length && !demandes.includes(config.site)) continue;
    if (!fs.existsSync(path.join(RACINE, 'tmp', `redaction-${config.site}.json`))) {
      if (!verifierSeul) bilan.push({ site: config.site, nom: config.nom, publie: false, nouvelles: 0, erreur: 'pas de fichier tmp/redaction (rien de rédigé)' });
      continue;
    }
    try {
      bilan.push(await publierSite(config, { verifierSeul, valider }));
    } catch (e) {
      bilan.push({ site: config.site, nom: config.nom, publie: false, nouvelles: 0, erreur: String(e?.stack || e).slice(0, 500) });
    }
  }
  if (verifierSeul) {
    for (const b of bilan) console.log(`${b.nom} : ${b.verifie} actus contrôlées, ${b.rejets} rejetées par l'anti-copie${b.rejets ? ` → réécris-les dans tmp/redaction-${b.site}.json (voir tmp/rejets-${b.site}.json)` : ''}`);
    return;
  }
  ecrireJson(path.join(RACINE, 'tmp', 'publie-bilan.json'), { le: new Date().toISOString(), sites: bilan });
  for (const b of bilan) {
    if (b.publie) console.log(`${b.nom} : ${b.nouvelles} nouvelles actus (${Object.entries(b.images).map(([k, v]) => `${v} ${k}`).join(', ') || 'aucune image'}), ${b.total} en ligne, ${b.abandonnees} abandonnées (anti-copie)`);
    else console.log(`${b.nom} : NON publié — ${b.erreur}`);
    for (const j of (b.journal || []).slice(0, 8)) console.log(`   · ${j}`);
  }
  if (sansGit) return;
  git('add', 'actus', 'images', 'cartes', 'etat');
  const change = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: RACINE, encoding: 'utf8' }).trim();
  if (!change) {
    console.log('Rien de nouveau à publier.');
    return;
  }
  const { jour, heure } = heureParis();
  const parts = bilan.filter((b) => b.publie).map((b) => `${b.nouvelles} actus ${b.nom}`);
  const msg = `Veille du ${jour} à ${heure} : ${parts.join(', ') || 'mise à jour'}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  git('commit', '-m', msg);
  try {
    git('pull', '--rebase');
    git('push');
    console.log('Publié sur GitHub (main).');
  } catch (e) {
    console.error(`Push impossible : ${String(e.stderr || e.message).slice(0, 300)}`);
    process.exit(2);
  }
  if (bilan.some((b) => !b.publie)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) principal().catch((e) => {
  console.error('Publication impossible :', e);
  process.exit(1);
});
