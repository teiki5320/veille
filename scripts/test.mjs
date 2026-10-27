// Tests : node scripts/test.mjs  (aucun accès réseau)
import assert from 'node:assert/strict';
import { idDe, controleAntiCopie, carteSvg, imageDejaVue, lireJson, RACINE, normaliserUrl, sites, ICONES } from './lib.mjs';
import { validateur, licenceWikimediaLibre, pertinente, altCarte } from './publie.mjs';
import { collecterSite, lireFlux } from './collecte.mjs';
import path from 'node:path';

let ok = 0;
let ko = 0;
async function test(nom, f) {
  try {
    await f();
    ok++;
    console.log(`✅ ${nom}`);
  } catch (e) {
    ko++;
    console.log(`❌ ${nom}\n   ${e.message}`);
  }
}

const exemple = () => ({
  version: 3,
  site: 'keurfoot',
  genere_le: '2026-10-27T11:00:00.000Z',
  actus: [
    {
      id: idDe('https://www.example.com/article?utm_source=x'),
      titre: 'Le Sénégal assure sa place pour la phase finale',
      resume: 'Les Lions ont battu leur adversaire et terminent en tête de leur groupe. Ils retrouveront les meilleures équipes du continent en janvier.',
      theme: 'foot',
      pays: ['SN'],
      competition: 'CAN',
      tags: ['joueur:sadio-mane'],
      source_nom: 'RFI',
      source_url: 'https://www.example.com/article',
      autres_sources: ['https://www.example.org/autre'],
      publie_le: '2026-10-27T09:00:00.000Z',
      collecte_le: '2026-10-27T11:00:00.000Z',
      langue: 'fr',
      image: {
        url: 'https://teiki5320.github.io/veille/images/keurfoot/abc.webp',
        source: 'wikimedia',
        credit: 'Happiraphael',
        licence: 'CC BY-SA 4.0',
        page: 'https://commons.wikimedia.org/wiki/File:X.jpg',
        alt: 'Un joueur sénégalais dribble un défenseur',
        mots_cles: ['Sadio Mané'],
        largeur: 1600,
        hauteur: 900,
      },
    },
  ],
});

const valider = validateur();
const configFoot = lireJson(path.join(RACINE, 'sites', 'keurfoot.json'));

await test('Le schéma v3 valide un exemple complet', () => {
  assert.ok(valider(exemple()), JSON.stringify(valider.errors));
});
await test('Le schéma v3 refuse une actu sans image', () => {
  const d = exemple();
  delete d.actus[0].image;
  assert.equal(valider(d), false);
  d.actus[0].image = null;
  assert.equal(valider(d), false);
});
await test('Le schéma v3 refuse une actu sans source', () => {
  const d = exemple();
  delete d.actus[0].source_url;
  assert.equal(valider(d), false);
  const e = exemple();
  delete e.actus[0].source_nom;
  assert.equal(valider(e), false);
});
await test('Le schéma v3 refuse une image hébergée ailleurs', () => {
  const d = exemple();
  d.actus[0].image.url = 'https://upload.wikimedia.org/x.jpg';
  assert.equal(valider(d), false);
});
await test('Le schéma v3 refuse plus de 60 actus', () => {
  const d = exemple();
  d.actus = Array.from({ length: 61 }, () => d.actus[0]);
  assert.equal(valider(d), false);
});

const origine = ['Sadio Mané offre la victoire au Sénégal face au Soudan du Sud en fin de match', 'Le capitaine des Lions a marqué le but décisif à la 88e minute, permettant au Sénégal de rester en tête du groupe B.'];
await test("L'anti-copie rejette 6 mots consécutifs repris", () => {
  const r = controleAntiCopie({ titre: 'Victoire sénégalaise arrachée en fin de rencontre', resume: 'Le but décisif à la 88e minute, permettant au Sénégal de garder la main.' }, origine);
  assert.equal(r.length, 1);
  assert.match(r[0], /résumé/);
  const t = controleAntiCopie({ titre: 'Sadio Mané offre la victoire au Sénégal !', resume: 'Texte sans rapport aucun.' }, origine);
  assert.match(t[0], /titre/);
});
await test("L'anti-copie ignore la ponctuation et la casse", () => {
  const r = controleAntiCopie({ titre: 'x', resume: 'LE BUT DÉCISIF, à la 88E minute ; permettant au Sénégal…' }, origine);
  assert.equal(r.length, 1);
});
await test("L'anti-copie accepte une vraie reformulation", () => {
  const r = controleAntiCopie(
    { titre: 'Mané délivre les Lions face au Soudan du Sud', resume: "Entré dans les dernières minutes, l'attaquant a inscrit l'unique but de la rencontre. Avec ce succès, le Sénégal conserve la première place de sa poule." },
    origine,
  );
  assert.deepEqual(r, []);
});

await test('La carte générée est un SVG valide, avec un drapeau, sans le titre', () => {
  const titre = 'Le Sénégal assure sa place pour la phase finale';
  const svg = carteSvg({ config: configFoot, pays: ['SN'], libelle: 'CAN 2027' });
  assert.match(svg, /^<\?xml[^>]*>\s*<svg [^>]*width="1600" height="900"/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.match(svg, /#0b7226/, 'drapeau du Sénégal absent');
  assert.match(svg, /CAN 2027/);
  assert.match(svg, /Keur Foot · Actus/);
  assert.ok(!svg.includes(titre));
  // équilibre des balises
  const ouvertes = (svg.match(/<svg\b/g) || []).length;
  const fermees = (svg.match(/<\/svg>/g) || []).length;
  assert.equal(ouvertes, fermees);
});
await test('La carte sans pays connu met l’icône à la place du drapeau', () => {
  const svg = carteSvg({ config: configFoot, pays: [], libelle: 'Football' });
  assert.ok(!svg.includes('viewBox="0 0 640 480"'));
  assert.match(svg, /FOOTBALL/);
});

const schema = lireJson(path.join(RACINE, 'schema', 'actus-schema-v3.json'));
await test('Chaque configuration de site est complète et cohérente avec le schéma', () => {
  const enumSites = schema.properties.site.enum;
  const enumThemes = schema.properties.actus.items.properties.theme.enum;
  const liste = sites();
  assert.ok(liste.length >= 6, 'au moins 6 sites');
  for (const c of liste) {
    assert.ok(enumSites.includes(c.site), `${c.site} absent de l’enum site`);
    assert.ok(c.nom && c.sujets && Array.isArray(c.exclusions), `${c.site} : nom, sujets ou exclusions manquants`);
    for (const k of ['fond', 'fond2', 'encre']) assert.match(c.couleurs?.[k] || '', /^#[0-9a-f]{6}$/i, `${c.site} : couleur ${k}`);
    assert.ok(ICONES.includes(c.icone), `${c.site} : icône inconnue ${c.icone}`);
    assert.ok(enumThemes.includes(c.theme_defaut), `${c.site} : thème inconnu ${c.theme_defaut}`);
    assert.ok(c.flux.length >= 8 && c.flux.length <= 15, `${c.site} : ${c.flux.length} flux`);
    const urls = new Set();
    for (const f of c.flux) {
      assert.match(f.url, /^https:\/\//, `${c.site} : ${f.url}`);
      assert.ok(['fr', 'en'].includes(f.langue), `${c.site} : langue ${f.langue}`);
      assert.ok(!urls.has(f.url), `${c.site} : flux en double ${f.url}`);
      urls.add(f.url);
    }
  }
});
await test('Solelis : uniquement des sources françaises ; Kultiled exclut le cannabis', () => {
  const sol = lireJson(path.join(RACINE, 'sites', 'solelis.json'));
  assert.ok(sol.flux.every((f) => f.langue === 'fr'));
  const kul = lireJson(path.join(RACINE, 'sites', 'kultiled.json'));
  assert.ok(kul.exclusions.some((e) => /cannabis/i.test(e)));
});
await test('Chaque site a une carte valide avec son icône ; sans drapeau si drapeau: false', () => {
  for (const c of sites()) {
    const svg = carteSvg({ config: c, pays: ['SN'], libelle: 'Test' });
    assert.match(svg, /^<\?xml[^>]*>\s*<svg [^>]*width="1600" height="900"/);
    assert.equal((svg.match(/<svg\b/g) || []).length, (svg.match(/<\/svg>/g) || []).length, c.site);
    assert.equal((svg.match(/<g\b/g) || []).length, (svg.match(/<\/g>/g) || []).length, c.site);
    assert.match(svg, new RegExp(`${c.nom} · Actus`));
    const avecDrapeau = svg.includes('#0b7226');
    assert.equal(avecDrapeau, c.drapeau !== false, `${c.site} : drapeau ${avecDrapeau ? 'présent' : 'absent'}`);
    if (c.drapeau === false) assert.doesNotMatch(altCarte(c, { pays: ['FR'], theme: c.theme_defaut }), /drapeau/);
  }
});
await test("L'anti-répétition refuse une image vue dans les 20 dernières actus", () => {
  const recentes = Array.from({ length: 25 }, (_, i) => ({ id: String(i), origine: `https://upload.wikimedia.org/img${i}.jpg` }));
  assert.equal(imageDejaVue('https://upload.wikimedia.org/img5.jpg', recentes), true);
  assert.equal(imageDejaVue('https://upload.wikimedia.org/img19.jpg', recentes), true);
  assert.equal(imageDejaVue('https://upload.wikimedia.org/img22.jpg', recentes), false, 'au-delà de 20 actus, l’image redevient possible');
  assert.equal(imageDejaVue('https://upload.wikimedia.org/neuve.jpg', recentes), false);
});

await test('Licences : libres acceptées, NC/ND refusées', () => {
  for (const l of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-US']) assert.ok(licenceWikimediaLibre(l), l);
  for (const l of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'Fair use', '']) assert.ok(!licenceWikimediaLibre(l), l);
});
await test('Pertinence : une image doit parler du sujet', () => {
  assert.ok(pertinente('Sadio Mané', 'Dribble de Sadio Mane', { tous: true }));
  assert.ok(!pertinente('Sadio Mané', 'Stade de France vu du ciel', { tous: true }));
});

await test("L'id ignore les paramètres utm_*", () => {
  assert.equal(idDe('https://ex.com/a?utm_source=rss&x=1#top'), idDe('https://ex.com/a?x=1'));
  assert.equal(normaliserUrl('https://EX.com/a?utm_medium=1'), 'https://ex.com/a');
});

await test("Un flux qui ne répond pas n'arrête pas la collecte", async () => {
  const maintenant = Date.parse('2026-10-27T10:00:00Z');
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
    <item><title>Les Lions &amp; la CAN</title><link>https://ok.example/a?utm_source=rss</link><pubDate>Mon, 27 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Un texte <b>riche</b> &eacute;t&eacute;</p>]]></description></item>
    <item><title>Vieux</title><link>https://ok.example/vieux</link><pubDate>Mon, 20 Oct 2026 08:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const config = { site: 'keurfoot', flux: [
    { nom: 'Mort', url: 'https://mort.example/rss', langue: 'fr' },
    { nom: 'Vivant', url: 'https://ok.example/rss', langue: 'fr' },
  ] };
  const fauxTelechargement = async (url) => {
    if (url.includes('mort')) throw new Error('délai dépassé');
    return rss;
  };
  const etat = { deja_vus: {}, flux: { 'https://mort.example/rss': { nom: 'Mort', erreurs: 2 } }, images_recentes: [] };
  const { candidats, problemes } = await collecterSite(config, { maintenant, telechargerFn: fauxTelechargement, etat });
  assert.equal(candidats.length, 1, 'l’article récent du flux vivant doit être gardé');
  assert.equal(candidats[0].titre_original, 'Les Lions & la CAN');
  assert.equal(candidats[0].description, 'Un texte riche été');
  assert.equal(candidats[0].lien, 'https://ok.example/a');
  assert.equal(problemes.length, 1);
  assert.equal(problemes[0].a_verifier, true, '3 échecs de suite → à vérifier');
  assert.equal(etat.flux['https://mort.example/rss'].erreurs, 3);
});
await test('Lecture des flux Atom', () => {
  const items = lireFlux('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="alternate" href="https://x.example/a"/><updated>2026-10-27T08:00:00Z</updated><summary>S</summary></entry></feed>');
  assert.equal(items[0].lien, 'https://x.example/a');
});

console.log(`\n${ok} réussis, ${ko} en échec`);
process.exit(ko ? 1 : 0);
