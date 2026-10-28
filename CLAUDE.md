# Veille actus — dépôt `teiki5320/veille`

Ce dépôt public contient les **actus récupérées automatiquement** pour les sites de Jean (Keur Foot, Keurbook, puis les autres). Une tâche planifiée Claude le remplit à **12 h et 19 h** (voir `TACHE.md`). Les fichiers sont servis par GitHub Pages sur `https://teiki5320.github.io/veille/` et lus en direct par les sites.

Décisions : `Studio/docs/veille/decisions-v1.md` (dépôt teiki5320/Studio).

## Règles

- **Branche `main` uniquement.** Pas de branche, pas de PR.
- Commits **en français**, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Ne jamais modifier `actus/*.json` à la main** : ils sont produits par `scripts/publie.mjs`, puis validés par le schéma `schema/actus-schema-v3.json`.
- **Aucun secret** dans ce dépôt (il est public). Wikimedia et Openverse n'ont pas de clé. Si une clé devenait nécessaire : trousseau du Mac, jamais ici.
- Légal : jamais de texte copié (titre et résumé réécrits, contrôle anti-copie de 6 mots), jamais l'image de l'article source, source toujours citée avec son lien, crédit de chaque image.
- Ajouter un site = ajouter `sites/<site>.json` (même forme que `keurfoot.json`) et son nom dans l'`enum` `site` du schéma s'il n'y est pas.

## Arborescence

- `sites/<site>.json` : configuration (couleurs de la carte, sujets, exclusions, flux RSS).
- `actus/<site>.json` : fichier publié, lu par le site.
- `articles/<site>/<id>.json` : article complet de chaque actu (300 à 450 mots, schéma `schema/article-schema-v1.json`), affiché sur la page `/actus/<slug>/` du site. Les articles (et leurs images) ne sont **jamais supprimés**, même quand l'actu sort des 60 plus récentes ; `articles/<site>/index.json` les liste tous : c'est lui que le site doit lire pour construire ses pages.
- `images/<site>/<id>.webp` (16:9) et `<id>-carre.webp` (600×600) : photos libres copiées. Cadrées sur les visages détectés (`scripts/visages.swift`, Vision du Mac) ; vérifier et corriger avec `scripts/recadre.mjs` (planche, recadrage d'une photo, `--tout`).
- `cartes/<site>/<id>.svg` : cartes générées (dernier recours).
- `etat/<site>.json` : déjà-vus, erreurs de flux, images récentes (anti-répétition).
- `banque/<site>/` : banque d'images perso (vide pour l'instant ; `index.json` = `[{ fichier, credit, licence, page, mots_cles }]`).
- `scripts/collecte.mjs` (étape 1), `scripts/sources.mjs` (texte des articles sources, pour rédiger et pour l'anti-copie), `scripts/publie.mjs` (étape 3), `scripts/test.mjs` (tests : `npm test`).
- `tmp/` : fichiers de travail d'un passage, jamais commités.
