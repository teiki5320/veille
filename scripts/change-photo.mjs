// Changer la photo d'une actu déjà publiée (photo hors sujet, logo coupé…), avec les
// mêmes règles que la publication : image libre (Wikimedia → Openverse → banque perso
// → carte générée), crédit, licence et page de l'original, cadrage sur les visages.
// La photo refusée n'est plus jamais reprise pour cette actu (etat.refusees).
//
// Usage :
//   node scripts/change-photo.mjs <site> <id> --wikimedia "Nom exact" --openverse "english keywords" \
//        --alt "ce qu'on verra (Wikimedia)" --alt-large "description générique (Openverse)" [--sans-git]
//   (--wikimedia et --openverse peuvent être répétés, du plus précis au plus large ;
//    <id> : l'id complet ou ses premiers caractères)
// Sans --sans-git, la commande envoie tout de suite : pour choisir, lancer d'abord avec --sans-git,
// regarder l'aperçu (tmp/apercu-<site>-<id>.png) ; photo refusée → relancer (elle ne reviendra plus),
// photo bonne → git add actus articles images cartes etat, commit, pull --rebase, push.
// Recadrage si besoin : node scripts/recadre.mjs <site> <id> <haut>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { RACINE, BASE_URL, FENETRE_RECENTES, sites, lireJson, ecrireJson, lireEtat, ecrireEtat } from './lib.mjs';
import { trouverImage, validateur, validateurArticle, ecrireIndexArticles } from './publie.mjs';

function options(args) {
  const o = { wikimedia: [], openverse: [], positionnels: [], sansGit: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--sans-git') o.sansGit = true;
    else if (a === '--wikimedia' || a === '--openverse') o[a.slice(2)].push(args[++i]);
    else if (a === '--alt') o.alt = args[++i];
    else if (a === '--alt-large') o.altLarge = args[++i];
    else o.positionnels.push(a);
  }
  return o;
}

export async function changerPhoto({ site, id: debut, wikimedia, openverse, alt, altLarge }) {
  const config = sites().find((s) => s.site === site);
  if (!config) throw new Error(`site inconnu : ${site}`);
  if (!wikimedia.length && !openverse.length) throw new Error('il faut au moins une recherche (--wikimedia ou --openverse)');
  const fichierActus = path.join(RACINE, 'actus', `${site}.json`);
  const doc = lireJson(fichierActus, { actus: [] });
  const dossierArticles = path.join(RACINE, 'articles', site);
  const idsArticles = fs.existsSync(dossierArticles) ? fs.readdirSync(dossierArticles).filter((f) => /^[0-9a-f]{40}\.json$/.test(f)).map((f) => f.slice(0, 40)) : [];
  const candidats = [...new Set([...doc.actus.map((a) => a.id), ...idsArticles])].filter((i) => i.startsWith(debut));
  if (candidats.length !== 1) throw new Error(candidats.length ? `id ambigu : ${debut}` : `actu introuvable : ${debut}`);
  const id = candidats[0];
  const actu = doc.actus.find((a) => a.id === id);
  const fichierArticle = path.join(dossierArticles, `${id}.json`);
  const article = fs.existsSync(fichierArticle) ? lireJson(fichierArticle, null) : null;
  const ancienne = (actu || article).image;

  // Photos à ne pas reprendre : les 20 dernières du site, la photo actuelle et celles déjà refusées pour cette actu.
  const etat = lireEtat(site);
  const origineActuelle = etat.origines?.[id] || ancienne?.url;
  const refusees = [...new Set([...(etat.refusees?.[id] || []), origineActuelle].filter(Boolean))];
  const recentes = [
    ...refusees.map((origine) => ({ id: `refusee-${id}`, origine })),
    ...doc.actus.filter((a) => a.id !== id).slice(0, FENETRE_RECENTES).map((a) => ({ id: a.id, origine: etat.origines?.[a.id] || a.image?.url })),
  ];
  const journal = [];
  const base = actu || { ...article, competition: article.competition ?? null };
  const r = { ...base, id, image_requetes: { wikimedia, openverse }, image_alt: alt || altLarge || ancienne?.alt, image_alt_large: altLarge || alt || ancienne?.alt };
  const { origine, image } = await trouverImage(config, r, recentes, journal);
  // Une recherche en panne (Wikimedia ou Openverse injoignable) ne doit pas finir en carte générée.
  if (image.source === 'carte' && journal.some((l) => /HTTP|délai|timeout|fetch/i.test(l))) {
    fs.rmSync(path.join(RACINE, 'cartes', site, `${id}.svg`), { force: true });
    if (ancienne?.source !== 'carte') await restaurerAncienne(site, id);
    throw new Error(`recherche d'image en panne, rien n'est changé : ${journal.join(' | ')}`);
  }
  if (image.source === 'carte') for (const f of [`images/${site}/${id}.webp`, `images/${site}/${id}-carre.webp`]) fs.rmSync(path.join(RACINE, f), { force: true });
  else fs.rmSync(path.join(RACINE, 'cartes', site, `${id}.svg`), { force: true });

  if (actu) {
    actu.image = image;
    doc.genere_le = new Date().toISOString();
    const valider = validateur();
    if (!valider(doc)) throw new Error(`actus/${site}.json invalide, rien n'est changé : ${(valider.errors || []).slice(0, 3).map((e) => `${e.instancePath} ${e.message}`).join(' ; ')}`);
  }
  if (article) {
    article.image = image;
    const validerArticle = validateurArticle();
    if (!validerArticle(article)) throw new Error(`article ${id} invalide, rien n'est changé : ${(validerArticle.errors || []).slice(0, 3).map((e) => `${e.instancePath} ${e.message}`).join(' ; ')}`);
  }
  if (actu) ecrireJson(fichierActus, doc);
  if (article) ecrireJson(fichierArticle, article);
  ecrireIndexArticles(site);
  etat.origines = { ...(etat.origines || {}), [id]: origine };
  etat.refusees = { ...(etat.refusees || {}), [id]: refusees };
  etat.images_recentes = doc.actus.slice(0, FENETRE_RECENTES).map((a) => ({ id: a.id, origine: etat.origines[a.id] || a.image.url }));
  ecrireEtat(site, etat);
  // Aperçu à regarder (outil Read) avant d'envoyer : si la photo ne va pas, relancer la même commande
  // (elle est notée comme refusée) avec d'autres recherches.
  let apercu = null;
  if (image.source !== 'carte') {
    apercu = path.join(RACINE, 'tmp', `apercu-${site}-${id.slice(0, 10)}.png`);
    fs.mkdirSync(path.dirname(apercu), { recursive: true });
    await sharp(path.join(RACINE, 'images', site, `${id}.webp`)).resize(800).png().toFile(apercu);
  }
  return { site, id, titre: (actu || article).titre, avant: ancienne, apres: image, journal, apercu, url: image.url.startsWith(BASE_URL) ? image.url : null };
}

// trouverImage a pu écraser la photo actuelle avant d'échouer : on la remet depuis git.
async function restaurerAncienne(site, id) {
  try {
    git('checkout', '--', `images/${site}/${id}.webp`, `images/${site}/${id}-carre.webp`);
  } catch {}
}

function git(...args) {
  return execFileSync('git', args, { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = options(process.argv.slice(2));
  const [site, id] = o.positionnels;
  changerPhoto({ site, id: id || '', wikimedia: o.wikimedia, openverse: o.openverse, alt: o.alt, altLarge: o.altLarge })
    .then((b) => {
      console.log(`${b.titre}\n  avant : ${b.avant?.source} — ${b.avant?.page || b.avant?.url}\n  après : ${b.apres.source} — ${b.apres.page || b.apres.url} (${b.apres.credit}, ${b.apres.licence ?? 'sans licence'})`);
      if (b.journal.length) console.log(`  journal : ${b.journal.join(' | ')}`);
      if (b.apercu) console.log(`  aperçu : ${b.apercu}`);
      if (!o.sansGit) {
        git('add', 'actus', 'articles', 'images', 'cartes', 'etat');
        git('commit', '-m', `Veille : nouvelle photo pour « ${b.titre.slice(0, 80)} » (${site})\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
        git('pull', '--rebase');
        git('push');
        console.log('  envoyé sur GitHub');
      }
    })
    .catch((e) => {
      console.error(`Échec : ${e.message}`);
      process.exit(1);
    });
}
