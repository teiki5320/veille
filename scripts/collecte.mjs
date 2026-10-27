// Étape 1 du passage (aucune IA) : lit les flux RSS/Atom de chaque site,
// garde les articles des 72 dernières heures pas encore vus, et écrit
// tmp/candidats-<site>.json. Un flux en erreur n'arrête jamais le passage.
//
// Usage : node scripts/collecte.mjs [keurfoot keurbook …]

import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { RACINE, sites, lireEtat, ecrireEtat, ecrireJson, idDe, normaliserUrl, texteSeul, couper, telecharger } from './lib.mjs';

const FENETRE = 72 * 3600 * 1000;
const parseur = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, htmlEntities: true, cdataPropName: false, trimValues: true });

const liste = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const texte = (x) => {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (Array.isArray(x)) return texte(x[0]);
  if (typeof x === 'object') return texte(x['#text'] ?? x['@_href'] ?? '');
  return '';
};
const lienAtom = (l) => {
  const ls = liste(l);
  const alt = ls.find((x) => typeof x === 'object' && (!x['@_rel'] || x['@_rel'] === 'alternate')) ?? ls[0];
  return typeof alt === 'string' ? alt : alt?.['@_href'] || '';
};

export function lireFlux(xml) {
  const d = parseur.parse(xml);
  let items = [];
  if (d?.rss?.channel) items = liste(d.rss.channel.item).map((i) => ({ titre: texte(i.title), lien: texte(i.link) || texte(i.guid), date: texte(i.pubDate) || texte(i['dc:date']), description: texte(i.description) || texte(i['content:encoded']) }));
  else if (d?.feed) items = liste(d.feed.entry).map((e) => ({ titre: texte(e.title), lien: lienAtom(e.link), date: texte(e.published) || texte(e.updated), description: texte(e.summary) || texte(e.content) }));
  else if (d?.['rdf:RDF']) items = liste(d['rdf:RDF'].item).map((i) => ({ titre: texte(i.title), lien: texte(i.link), date: texte(i['dc:date']), description: texte(i.description) }));
  else throw new Error('format de flux inconnu');
  return items;
}

export async function collecterSite(config, { maintenant = Date.now(), telechargerFn = telecharger, etat = lireEtat(config.site) } = {}) {
  const candidats = new Map();
  const problemes = [];
  for (const flux of config.flux) {
    const suivi = (etat.flux[flux.url] ||= { nom: flux.nom, erreurs: 0 });
    suivi.nom = flux.nom;
    try {
      const xml = await telechargerFn(flux.url, { delai: 20000 });
      const items = lireFlux(xml);
      let gardes = 0;
      for (const it of items) {
        if (!it.lien || !/^https?:\/\//.test(it.lien.trim())) continue;
        const t = Date.parse(it.date);
        if (!Number.isFinite(t) || maintenant - t > FENETRE || t - maintenant > 6 * 3600 * 1000) continue;
        const lien = normaliserUrl(it.lien);
        const id = idDe(lien);
        if (etat.deja_vus[id] || candidats.has(id)) continue;
        candidats.set(id, {
          id,
          titre_original: texteSeul(it.titre),
          description: couper(texteSeul(it.description), 500),
          lien,
          date: new Date(t).toISOString(),
          source: flux.nom,
          langue: flux.langue || 'fr',
        });
        gardes++;
      }
      suivi.erreurs = 0;
      suivi.dernier_succes = new Date(maintenant).toISOString();
      suivi.derniere_erreur = null;
      suivi.articles = gardes;
    } catch (e) {
      suivi.erreurs = (suivi.erreurs || 0) + 1;
      suivi.derniere_erreur = `${new Date(maintenant).toISOString()} : ${String(e?.message || e).slice(0, 200)}`;
      problemes.push({ flux: flux.nom, url: flux.url, erreur: String(e?.message || e).slice(0, 200), erreurs_de_suite: suivi.erreurs, a_verifier: suivi.erreurs >= 3 });
    }
  }
  const tries = [...candidats.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { candidats: tries, problemes, etat };
}

async function principal() {
  const demandes = process.argv.slice(2);
  const bilan = { le: new Date().toISOString(), sites: {} };
  for (const config of sites()) {
    if (demandes.length && !demandes.includes(config.site)) continue;
    const { candidats, problemes, etat } = await collecterSite(config);
    ecrireEtat(config.site, etat);
    ecrireJson(path.join(RACINE, 'tmp', `candidats-${config.site}.json`), { site: config.site, collecte_le: bilan.le, candidats });
    // Fiches du site (pour les tags) : facultatif, jamais bloquant.
    let entites = [];
    if (config.entites_url) {
      try {
        const e = JSON.parse(await telecharger(config.entites_url, { delai: 20000 }));
        entites = Array.isArray(e) ? e : Array.isArray(e?.entites) ? e.entites : [];
      } catch {
        entites = [];
      }
    }
    ecrireJson(path.join(RACINE, 'tmp', `entites-${config.site}.json`), entites);
    bilan.sites[config.site] = { candidats: candidats.length, flux_en_erreur: problemes, entites: entites.length };
    const aVerifier = problemes.filter((p) => p.a_verifier).map((p) => p.flux);
    console.log(`${config.nom} : ${candidats.length} candidats, ${problemes.length} flux en erreur${aVerifier.length ? ` (à vérifier : ${aVerifier.join(', ')})` : ''}, ${entites.length} fiches pour les tags`);
  }
  ecrireJson(path.join(RACINE, 'tmp', 'collecte-bilan.json'), bilan);
}

if (import.meta.url === `file://${process.argv[1]}`) principal().catch((e) => {
  console.error('Collecte impossible :', e);
  process.exit(1);
});
