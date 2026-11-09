// Reprendre l'article d'une actu déjà en ligne (trop court, fait à corriger), avec les mêmes contrôles
// que la publication : longueur (300 à 480 mots, 150 seulement avec "source_mince": true), anti-copie de
// 6 mots sur tout le texte des sources (tmp/sources/<site>/<id>.txt, sources ajoutées comprises), schéma v1.
// Recalcule mots et lecture_min, met à jour lecture_min et autres_sources de l'actu (schéma v3), refait l'index.
// Ne commit pas : regarde le résultat, puis git add articles actus && commit && git pull --rebase && git push.
//
// Usage :
//   node scripts/sources.mjs <site> <id> --ajoute <adresse>…    (texte des médias lus en plus, pour l'anti-copie)
//   node scripts/reprend-article.mjs <site> <fichier.json> [--verifier]
// fichier.json : { "id": "<id>", "article": { "chapo": "…", "blocs": [...] }, "autres_sources": ["…"], "source_mince": false }

import fs from 'node:fs';
import path from 'node:path';
import { RACINE, BASE_URL, lireJson, ecrireJson, controleArticle, motsArticle, lectureMin } from './lib.mjs';
import { propre, validateur, validateurArticle, ecrireIndexArticles } from './publie.mjs';
import { lireSource } from './sources.mjs';

const nbMots = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

export async function reprendre(site, demande, { verifierSeul = false } = {}) {
  const id = demande.id;
  const fArticle = path.join(RACINE, 'articles', site, `${id}.json`);
  const ancien = lireJson(fArticle, null);
  if (!ancien) return { id, ok: false, raisons: [`articles/${site}/${id}.json introuvable`] };
  const fSource = path.join(RACINE, 'tmp', 'sources', site, `${id}.txt`);
  if (!fs.existsSync(fSource) || !nbMots(fs.readFileSync(fSource, 'utf8'))) {
    // Source pas encore lue : celle de l'actu, puis les autres sources déjà citées.
    let texte = '';
    for (const u of [ancien.source_url, ...(ancien.autres_sources || [])]) {
      try {
        const t = await lireSource(u);
        if (t) texte += (texte ? '\n\n' : '') + t;
      } catch {}
    }
    fs.mkdirSync(path.dirname(fSource), { recursive: true });
    fs.writeFileSync(fSource, texte);
  }
  const source = fs.readFileSync(fSource, 'utf8');
  const autres = [...new Set([...(ancien.autres_sources || []), ...(demande.autres_sources || [])])].filter((u) => /^https?:\/\//.test(u) && u !== ancien.source_url);
  const article = {
    chapo: propre(demande.article?.chapo || ''),
    blocs: (demande.article?.blocs || []).map((b) => ({ intertitre: b.intertitre ? propre(b.intertitre) : null, paragraphes: (b.paragraphes || []).map(propre).filter(Boolean) })),
  };
  const raisons = controleArticle(article, [source], nbMots(source), { autresSources: autres, sourceMince: demande.source_mince === true });
  const mots = motsArticle(article);
  if (raisons.length) return { id, ok: false, mots, mots_source: nbMots(source), raisons };
  const doc = { ...ancien, chapo: article.chapo, blocs: article.blocs, mots, lecture_min: lectureMin(mots), ...(autres.length ? { autres_sources: autres } : {}), redige_le: new Date().toISOString() };
  // Ordre des champs comme docArticle (autres_sources après source_url).
  const ordre = ['version', 'site', 'id', 'slug', 'titre', 'chapo', 'blocs', 'mots', 'lecture_min', 'theme', 'pays', 'competition', 'tags', 'source_nom', 'source_url', 'autres_sources', 'publie_le', 'redige_le', 'image'];
  const final = Object.fromEntries(ordre.filter((k) => k in doc).map((k) => [k, doc[k]]));
  const vArt = validateurArticle();
  if (!vArt(final)) return { id, ok: false, mots, raisons: (vArt.errors || []).map((e) => `schéma article : ${e.instancePath} ${e.message}`) };
  const fActus = path.join(RACINE, 'actus', `${site}.json`);
  const actus = lireJson(fActus, null);
  let actusModifie = null;
  if (actus) {
    const i = actus.actus.findIndex((a) => a.id === id);
    if (i >= 0) {
      actusModifie = structuredClone(actus);
      actusModifie.actus[i] = { ...actus.actus[i], lecture_min: final.lecture_min, ...(autres.length ? { autres_sources: autres } : {}), article_url: `${BASE_URL}/articles/${site}/${id}.json` };
      const v = validateur();
      if (!v(actusModifie)) return { id, ok: false, mots, raisons: (v.errors || []).slice(0, 5).map((e) => `schéma v3 : ${e.instancePath} ${e.message}`) };
    }
  }
  if (verifierSeul) return { id, ok: true, mots, verifie: true };
  ecrireJson(fArticle, final);
  if (actusModifie) ecrireJson(fActus, actusModifie);
  ecrireIndexArticles(site);
  return { id, ok: true, mots, avant: ancien.mots };
}

async function principal() {
  const args = process.argv.slice(2);
  const verifierSeul = args.includes('--verifier');
  const [site, fichier] = args.filter((a) => !a.startsWith('--'));
  if (!site || !fichier) throw new Error('usage : node scripts/reprend-article.mjs <site> <fichier.json> [--verifier]');
  const contenu = lireJson(path.resolve(fichier), null);
  if (!contenu) throw new Error(`${fichier} illisible`);
  let bad = 0;
  for (const d of Array.isArray(contenu) ? contenu : [contenu]) {
    const r = await reprendre(site, d, { verifierSeul });
    if (r.ok) console.log(`✅ ${r.id.slice(0, 10)} : ${r.avant ?? '?'} → ${r.mots} mots${r.verifie ? ' (vérifié, rien écrit)' : ''}`);
    else {
      bad++;
      console.log(`❌ ${r.id?.slice(0, 10)} (${r.mots ?? '?'} mots, source ${r.mots_source ?? '?'}) :\n   - ${r.raisons.join('\n   - ')}`);
    }
  }
  if (bad) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) principal().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
