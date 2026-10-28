// Recadrage des photos déjà publiées (visage coupé, sujet hors cadre).
//   node scripts/recadre.mjs --tout                    → refait toutes les photos Wikimedia avec la règle par défaut
//   node scripts/recadre.mjs <site> <id> <haut> [url]  → une photo, bande gardée à <haut> (0 = haut, 1 = bas)
//   node scripts/recadre.mjs --planche <site> <id>…    → tmp/planche-<site>.png pour vérifier le cadrage d'un coup d'œil
// L'original Wikimedia est relu sur upload.wikimedia.org (l'API Commons limite vite les appels).
// Pour une photo Openverse ou de la banque, passer l'adresse (ou le chemin) de l'original en [url].
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RACINE } from './lib.mjs';
import { enregistrerPhoto } from './publie.mjs';

const UA = { 'User-Agent': 'VeilleToakeur/1.0 (https://github.com/teiki5320/veille)' };

export function urlOriginaleWikimedia(page) {
  const nom = decodeURIComponent(page.split('/wiki/')[1] || '').replace(/^File:/, '').replace(/ /g, '_');
  if (!nom) return null;
  const h = crypto.createHash('md5').update(nom).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(nom)}`;
}

async function lireOriginal(source) {
  if (!/^https?:/.test(source)) return fs.readFileSync(source);
  for (let essai = 0; essai < 5; essai++) {
    const r = await fetch(source, { headers: UA });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    await new Promise((ok) => setTimeout(ok, 4000 * (essai + 1)));
  }
  throw new Error(`original introuvable : ${source}`);
}

// Toutes les photos publiées (actus en ligne + articles gardés pour toujours), une fois chacune.
function photosPubliees() {
  const vues = new Map();
  const noter = (site, a) => { if (a.image?.source && a.image.source !== 'carte') vues.set(`${site}/${a.id}`, { site, id: a.id, image: a.image }); };
  for (const f of fs.readdirSync(path.join(RACINE, 'actus')).filter((x) => x.endsWith('.json'))) {
    const site = f.replace(/\.json$/, '');
    for (const a of JSON.parse(fs.readFileSync(path.join(RACINE, 'actus', f))).actus || []) noter(site, a);
  }
  const dossier = path.join(RACINE, 'articles');
  for (const site of fs.existsSync(dossier) ? fs.readdirSync(dossier) : []) {
    if (!fs.statSync(path.join(dossier, site)).isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(dossier, site)).filter((x) => x.endsWith('.json') && x !== 'index.json')) noter(site, JSON.parse(fs.readFileSync(path.join(dossier, site, f))));
  }
  return [...vues.values()];
}

async function planche(site, ids) {
  const vignettes = [];
  const fichiers = fs.readdirSync(path.join(RACINE, 'images', site)).filter((f) => !f.endsWith('-carre.webp'));
  const trouves = ids.map((id) => fichiers.find((f) => f.startsWith(id))).filter(Boolean);
  for (const [i, nom] of trouves.entries()) {
    const id = nom.replace(/\.webp$/, '');
    const fichier = path.join(RACINE, 'images', site, nom);
    const etiquette = Buffer.from(`<svg width="400" height="28"><rect width="400" height="28" fill="#000"/><text x="8" y="20" font-size="16" font-family="sans-serif" fill="#fff">${id.slice(0, 8)}</text></svg>`);
    const img = await sharp(fichier).resize(400, 225).composite([{ input: etiquette, top: 0, left: 0 }]).png().toBuffer();
    vignettes.push({ input: img, left: (i % 3) * 410, top: Math.floor(i / 3) * 235 });
  }
  const sortie = path.join(RACINE, 'tmp', `planche-${site}.png`);
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  await sharp({ create: { width: 1230, height: Math.max(1, Math.ceil(vignettes.length / 3)) * 235, channels: 3, background: '#fff' } }).composite(vignettes).png().toFile(sortie);
  console.log(sortie);
}

async function main(args) {
  if (args[0] === '--planche') return planche(args[1], args.slice(2));
  if (args[0] === '--tout') {
    let n = 0;
    for (const { site, id, image } of photosPubliees()) {
      if (image.source !== 'wikimedia') { console.log(`passée (${image.source}, original à donner à la main) : ${site} ${id.slice(0, 8)}`); continue; }
      try {
        await enregistrerPhoto(await lireOriginal(urlOriginaleWikimedia(image.page)), site, id);
        n++;
        console.log(`refaite : ${site} ${id.slice(0, 8)}`);
      } catch (e) {
        console.log(`ÉCHEC ${site} ${id.slice(0, 8)} : ${e.message}`);
      }
    }
    return console.log(`${n} photos refaites`);
  }
  const [site, id, haut, url] = args;
  if (!site || !id || haut == null) throw new Error('usage : node scripts/recadre.mjs <site> <id> <haut 0-1> [url]');
  const photo = photosPubliees().find((p) => p.site === site && p.id.startsWith(id));
  if (!photo) throw new Error(`photo inconnue : ${site} ${id}`);
  const source = url || (photo.image.source === 'wikimedia' ? urlOriginaleWikimedia(photo.image.page) : null);
  if (!source) throw new Error(`photo ${photo.image.source} : donne l'adresse de l'original`);
  await enregistrerPhoto(await lireOriginal(source), site, photo.id, Number(haut));
  console.log(`recadrée : ${site} ${photo.id.slice(0, 8)} (haut = ${haut})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
