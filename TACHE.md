# Consignes de la tâche « Veille actus (12 h et 19 h) »

Tâche planifiée : id `veille-actus`, cron `0 12,19 * * *`, dossier `/Users/jeanperraudeau/Dev/apps/veille`, mode **Auto**.
À chaque passage, suis ces étapes **dans l'ordre**, sans rien demander à Jean. Lis d'abord `CLAUDE.md`.

## 1. Mise à jour

```sh
cd /Users/jeanperraudeau/Dev/apps/veille
git pull --ff-only
```

Si `package-lock.json` a changé avec ce pull, ou si `node_modules` n'existe pas : `npm ci`.

## 2. Collecte (aucune IA)

```sh
node scripts/collecte.mjs
```

Elle écrit `tmp/candidats-<site>.json` (articles des 72 dernières heures pas encore vus), `tmp/entites-<site>.json` (fiches du site pour les tags, peut être vide) et `tmp/collecte-bilan.json` (flux en erreur). Un flux en erreur n'arrête jamais le passage.

## 3. Rédaction (toi)

Pour **chaque site** de `sites/*.json` :

1. Lis `tmp/candidats-<site>.json` et `sites/<site>.json` (`sujets`, `exclusions`).
2. **Trie en lisant** : garde seulement ce qui correspond aux `sujets`, écarte les `exclusions` (et les rumeurs, les paris, les faits divers violents, les autres sports pour Keur Foot ; les polémiques politiques et les faits divers pour Keurbook).
3. **Fusionne les doublons** : la même info vue dans plusieurs flux = une seule actu. Le candidat le plus complet est l'`id` principal ; les autres vont dans `autres_ids`.
4. Garde **12 actus au plus**, les plus importantes d'abord.
5. Écris `tmp/redaction-<site>.json` — **toujours**, même vide (`{"site":"<site>","actus":[]}`) s'il n'y a rien à garder :

```json
{
  "site": "keurfoot",
  "actus": [
    {
      "id": "<id exact du candidat principal>",
      "autres_ids": ["<id d'un doublon>"],
      "titre": "…",
      "resume": "…",
      "theme": "foot",
      "pays": ["SN"],
      "competition": "Éliminatoires CAN 2027",
      "tags": [],
      "image_requetes": { "wikimedia": ["Sadio Mané"], "openverse": ["senegal football player"] },
      "image_alt": "…"
    }
  ]
}
```

Règles de rédaction :
- `titre` : **reformulé**, 90 caractères au plus, informatif, sans putaclic. Le titre original n'est jamais publié.
- `resume` : 2 à 3 phrases, **380 caractères au plus**, **en français même si la source est en anglais**, ton neutre, les faits seulement, aucune opinion, **rien d'inventé** (seulement ce que disent le titre et la description du candidat, ou l'article lui-même).
- N'écris **jamais 6 mots consécutifs** du titre ou de la description d'origine (noms propres compris : reformule autour, par ex. « la MansA, Maison des mondes africains » plutôt que de recopier la suite d'origine).
- `theme` : `foot` pour Keur Foot ; `livres`, `bd` ou `culture` pour Keurbook (liste complète dans le schéma).
- `pays` : codes ISO à 2 lettres des pays concernés, le principal en premier (il donne le drapeau de la carte). Vide si tu n'es pas sûr.
- `competition` : Keur Foot seulement (CAN, Éliminatoires CAN 2027, Ligue des champions CAF, Coupe de la CAF, Ballon d'Or, Premier League…), sinon `null`.
- `tags` : seulement des `tag` qui existent dans `tmp/entites-<site>.json` (ex. `auteur:marguerite-abouet`) ; sinon `[]`.
- `image_requetes`, du plus précis au plus large : pour Wikimedia, le **nom exact** de la personne, du lieu ou du club cité ; pour Openverse, 2 à 4 mots-clés **en anglais**, génériques (`african football stadium`, `bookstore books`…).
- `image_alt` : description factuelle de ce qu'on doit voir, 160 caractères au plus.

## 4. Contrôle anti-copie, puis publication (aucune IA)

```sh
node scripts/publie.mjs --verifier
```

S'il y a des rejets, lis `tmp/rejets-<site>.json` (toutes les suites de 6 mots reprises y sont listées), **réécris une seule fois** ces actus dans `tmp/redaction-<site>.json`, puis publie :

```sh
node scripts/publie.mjs
```

Les actus encore rejetées sont abandonnées. Le script cherche l'image (Wikimedia → Openverse → banque perso → carte générée), fusionne avec les actus déjà en ligne (60 au plus), valide le schéma v3 (un fichier invalide n'est **pas** publié : l'ancien reste en ligne), puis fait `git add actus images cartes etat`, le commit (« Veille du 27/10 à 12 h : 9 actus Keur Foot, 6 actus Keurbook »), `git pull --rebase` et `git push`.

Codes de sortie : `0` = tout est publié ; `1` = au moins un site n'a pas été publié ; `2` = le push a échoué. Le bilan est dans `tmp/publie-bilan.json`.

## 5. Alerte dans le Studio de Jean (seulement en cas de problème)

Envoie une alerte si :
- un site n'a pas pu être publié (`publie: false` dans `tmp/publie-bilan.json`), ou le push a échoué ;
- un flux a **3 échecs de suite** (`a_verifier: true` dans `tmp/collecte-bilan.json`) ;
- une étape a planté (collecte, `npm ci`, `git pull`).

Construis toujours le JSON avec `node -e` (jamais à la main), puis envoie-le. Exemple :

```sh
node -e 'process.stdout.write(JSON.stringify({
  id: "veille:keurfoot:publication",
  source: "veille",
  site: "Keur Foot",
  texte: "Veille actus : le fichier Keur Foot n’a pas été publié",
  detail: "fichier invalide (schéma v3) : /actus/3/resume must NOT have more than 380 characters",
  consigne: "Ouvrir /Users/jeanperraudeau/Dev/apps/veille, relancer node scripts/publie.mjs et corriger la rédaction fautive.",
  dossier: "/Users/jeanperraudeau/Dev/apps/veille"
}))' | curl -s -X POST http://localhost:4600/api/afaire -H 'Content-Type: application/json' --data-binary @-
```

Identifiants à utiliser (un même problème met à jour la même alerte au lieu d'en créer une nouvelle) :
- site non publié : `veille:<site>:publication` ;
- flux à vérifier : `veille:<site>:flux:<nom du flux en minuscules, tirets>` ;
- push impossible ou étape plantée : `veille:passage`.

Quand un problème signalé est **réglé** à un passage suivant (site de nouveau publié, flux revenu), marque l'alerte faite :

```sh
node -e 'process.stdout.write(JSON.stringify({ id: "veille:keurfoot:publication", etat: "fait", compteRendu: "Publié normalement au passage de 19 h." }))' | curl -s -X POST http://localhost:4600/api/afaire -H 'Content-Type: application/json' --data-binary @-
```

Si le Studio ne répond pas (`localhost:4600` éteint), note-le dans le résumé final, sans t'arrêter.

## 6. Résumé final (une ligne)

Exemple : « Veille 12 h : Keur Foot 9 actus (6 photos, 3 cartes), Keurbook 4 actus ; 2 abandonnées (anti-copie) ; flux à vérifier : BDZoom. »

## À ne jamais faire

- Modifier `actus/*.json` à la main, ou publier sans passer par `scripts/publie.mjs`.
- Copier un texte de la source, ou utiliser l'image de l'article source.
- Créer une branche ou une PR ; ajouter une clé ou un secret ; toucher `AGENTS.md`.
