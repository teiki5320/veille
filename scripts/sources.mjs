// Lit le texte des articles sources (aucune IA), pour rédiger les articles complets.
// Écrit tmp/sources/<site>/<id>.txt et affiche le nombre de mots trouvés.
//
// Usage :
//   node scripts/sources.mjs <site> <id> [<id>…]   → candidats choisis (tmp/candidats-<site>.json)
//   node scripts/sources.mjs <site> --publiees      → actus déjà en ligne sans article
//   node scripts/sources.mjs <site> <id> --ajoute <adresse> [<adresse>…]
//       → ajoute à la fin de tmp/sources/<site>/<id>.txt le texte d'un autre média (source mince) ;
//         l'adresse va aussi dans autres_sources de la rédaction. Le contrôle anti-copie porte aussi sur ce texte.

import fs from 'node:fs';
import path from 'node:path';
import { RACINE, lireJson, telecharger, texteSeul } from './lib.mjs';

// Texte principal d'une page : les paragraphes de <article> (ou de la page), sans menus ni pieds de page.
export function extraireTexte(html) {
  let h = String(html || '').replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure)[\s\S]*?<\/\1>/gi, ' ');
  const art = /<article[\s\S]*?<\/article>/i.exec(h);
  if (art && /<p[\s>]/i.test(art[0])) h = art[0];
  const paras = [...h.matchAll(/<(p|h2|h3|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => texteSeul(m[2]))
    .filter((t) => t.length >= 40 && !/cookies?|abonnez|newsletter|tous droits|©|javascript/i.test(t));
  return [...new Set(paras)].join('\n\n');
}

export async function lireSource(url) {
  const html = await telecharger(url, { delai: 25000 });
  return extraireTexte(html);
}

async function principal() {
  const [site, ...reste] = process.argv.slice(2);
  if (!site) throw new Error('usage : node scripts/sources.mjs <site> <id>… | --publiees | <id> --ajoute <adresse>…');
  if (reste.includes('--ajoute')) {
    const id = reste[0];
    const adresses = reste.slice(reste.indexOf('--ajoute') + 1);
    if (!/^[0-9a-f]{40}$/.test(id) || !adresses.length) throw new Error('usage : node scripts/sources.mjs <site> <id> --ajoute <adresse>…');
    const fichier = path.join(RACINE, 'tmp', 'sources', site, `${id}.txt`);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    let texte = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8') : '';
    for (const u of adresses) {
      try {
        const t = await lireSource(u);
        const n = t.split(/\s+/).filter(Boolean).length;
        if (n) texte += (texte ? '\n\n' : '') + `[${u}]\n` + t;
        console.log(`   ${u} : ${n} mots ajoutés`);
      } catch (e) {
        console.log(`   ${u} : ${e.message} (rien ajouté : colle le texte lu avec WebFetch à la fin du fichier)`);
      }
    }
    fs.writeFileSync(fichier, texte);
    const n = texte.split(/\s+/).filter(Boolean).length;
    console.log(`${id} : ${n} mots en tout${n < 250 ? ' (encore mince : une autre source, ou "source_mince": true si rien n’existe)' : ' → article de 300 à 450 mots'}`);
    return;
  }
  let cibles;
  if (reste.includes('--publiees')) {
    const doc = lireJson(path.join(RACINE, 'actus', `${site}.json`), { actus: [] });
    cibles = doc.actus.filter((a) => !a.slug).map((a) => ({ id: a.id, lien: a.source_url, autres: a.autres_sources || [] }));
  } else {
    const cand = lireJson(path.join(RACINE, 'tmp', `candidats-${site}.json`), { candidats: [] });
    const parId = new Map(cand.candidats.map((c) => [c.id, c]));
    cibles = reste.map((id) => parId.get(id)).filter(Boolean).map((c) => ({ id: c.id, lien: c.lien, autres: [] }));
  }
  const dossier = path.join(RACINE, 'tmp', 'sources', site);
  fs.mkdirSync(dossier, { recursive: true });
  for (const c of cibles) {
    let texte = '';
    for (const u of [c.lien, ...c.autres]) {
      try {
        const t = await lireSource(u);
        texte += (texte ? '\n\n' : '') + t;
      } catch (e) {
        console.log(`   ${u} : ${e.message}`);
      }
    }
    fs.writeFileSync(path.join(dossier, `${c.id}.txt`), texte);
    const n = texte.split(/\s+/).filter(Boolean).length;
    console.log(`${c.id} : ${n} mots${n < 250 ? ' (source mince : cherche la même info chez un autre média et ajoute son texte avec --ajoute <adresse> ; 150 mots et "source_mince": true seulement si rien n’existe)' : ''}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) principal().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
