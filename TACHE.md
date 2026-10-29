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
2. **Trie en lisant** : garde seulement ce qui correspond aux `sujets`, écarte les `exclusions` (et les rumeurs, les paris, les faits divers violents, les autres sports pour Keur Foot ; les polémiques politiques et les faits divers pour Keurbook). Règles fermes des autres sites :
   - **Keur Cook** : jamais d'actu santé ni de nutrition médicale, jamais de vocabulaire de vente ; les sources générales sur l'Afrique ne donnent qu'une actu si elle parle vraiment de cuisine.
   - **Keur Déco** : seulement la déco, le design ou l'artisanat d'Afrique et de sa diaspora (pas les enchères).
   - **Kultiled** : culture en intérieur et lumière des plantes, partout dans le monde (pas seulement l'Afrique) ; **jamais de cannabis, de chanvre, de CBD ni de drogue**.
   - **Solelis** : France uniquement, du point de vue du dirigeant de TPE ou PME ; pas de noms de dirigeants ou de petites entreprises inconnus.
   - **Keur Bible** : seulement la culture chrétienne en Afrique et dans la diaspora (fêtes et pèlerinages, gospel, art sacré et patrimoine, livres et films, figures chrétiennes africaines, communautés en France), pour toutes les Églises ; **jamais de politique, de scandale, de polémique entre Églises ni de persécutions** ; ton respectueux, jamais prosélyte.
   - Il est normal de n'avoir qu'une ou deux actus (voire aucune) pour Keur Cook, Keur Déco, Kultiled et Keur Bible : ne garde jamais un article hors sujet pour faire du volume.
3. **Fusionne les doublons** : la même info vue dans plusieurs flux = une seule actu. Le candidat le plus complet est l'`id` principal ; les autres vont dans `autres_ids`.
4. Garde **4 actus au plus par site et par jour** (les deux passages comptés ensemble ; regarde dans `actus/<site>.json` combien ont un `collecte_le` d'aujourd'hui et ne rédige que ce qu'il reste). Choisis **les plus pertinentes et les plus « buzz »** : celles dont tout le monde parle (reprises par plusieurs flux = beaucoup d'`autres_ids`), les grands noms, les grands événements, les records et les premières. Classe-les de la plus forte à la moins forte. Le script de publication coupe de toute façon au-delà de 4 par jour.
5. **Lis les sources des actus gardées** (aucune IA) : `node scripts/sources.mjs <site> <id> <id>…` (ids des candidats principaux). Le texte va dans `tmp/sources/<site>/<id>.txt` et le nombre de mots s'affiche.
   - Si une source fait **moins de 250 mots** (page bloquée, vidéo, brève) : ouvre-la avec WebFetch ; sinon cherche la **même info chez un autre média sérieux** (WebSearch), lis-le avec WebFetch, **ajoute son texte à la fin** de `tmp/sources/<site>/<id>.txt` et son adresse dans `autres_sources` de l'actu.
   - Si, malgré ça, tu n'as pas de quoi écrire 150 mots vrais : **n'en fais pas une actu** (prends-en une autre).
6. Écris `tmp/redaction-<site>.json` — **toujours**, même vide (`{"site":"<site>","actus":[]}`) s'il n'y a rien à garder :

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
      "image_alt": "…",
      "image_alt_large": "…",
      "autres_sources": [],
      "article": {
        "chapo": "…",
        "blocs": [
          { "intertitre": null, "paragraphes": ["…", "…"] },
          { "intertitre": "…", "paragraphes": ["…"] },
          { "intertitre": "…", "paragraphes": ["…"] }
        ]
      }
    }
  ]
}
```

Règles de rédaction :
- `titre` : **reformulé**, 90 caractères au plus, informatif, sans putaclic. Le titre original n'est jamais publié.
- `resume` : 2 à 3 phrases, **380 caractères au plus**, **en français même si la source est en anglais**, ton neutre, les faits seulement, aucune opinion, **rien d'inventé** (seulement ce que disent le titre et la description du candidat, ou l'article lui-même).
- N'écris **jamais 6 mots consécutifs** du titre ou de la description d'origine (noms propres compris : reformule autour, par ex. « la MansA, Maison des mondes africains » plutôt que de recopier la suite d'origine).
- `theme` : `foot` pour Keur Foot ; `livres`, `bd` ou `culture` pour Keurbook ; `cuisine` pour Keur Cook ; `culture` pour Keur Bible ; `deco` pour Keur Déco ; `culture-interieur` pour Kultiled ; `entreprises` pour Solelis (liste complète dans le schéma).
- `pays` : codes ISO à 2 lettres des pays concernés, le principal en premier (il donne le drapeau de la carte). Vide si tu n'es pas sûr.
- `competition` : Keur Foot seulement (CAN, Éliminatoires CAN 2027, Ligue des champions CAF, Coupe de la CAF, Ballon d'Or, Premier League…), sinon `null`.
- `tags` : seulement des `tag` qui existent dans `tmp/entites-<site>.json` (ex. `auteur:marguerite-abouet`, `matiere:wax`, `rubrique:creches-et-noel`, `occasion:noel`, `legume:tomate`, `situation:dettes-urssaf`) ; sinon `[]`. Keur Cook n'a pas de tags : ses pages pays filtrent sur `pays`.
- `image_requetes`, du plus précis au plus large : pour Wikimedia, le **nom exact** de la personne, du lieu ou du club cité ; pour Openverse, 2 à 4 mots-clés **en anglais**, génériques (`african football stadium`, `bookstore books`…).
- `image_alt` : description factuelle de ce qu'on verra sur la photo **Wikimedia** (la personne, le lieu ou le club exact), 160 caractères au plus. Reste prudent : la photo trouvée peut montrer une autre vue du sujet (une racine plutôt qu'une gousse, un bouton plutôt qu'un pot) ; décris le sujet, pas un détail que tu supposes.
- `article` : **l'article complet**, affiché sur sa propre page du site (`/actus/<adresse>/`). Règles :
  - **300 à 450 mots** (contrôlé : 300 à 480) ; **150 mots au moins** seulement si la source fait moins de 250 mots.
  - `chapo` : 1 ou 2 phrases d'attaque (40 à 320 caractères) qui disent l'essentiel.
  - `blocs` : 3 ou 4 blocs. Le 1er sans intertitre (les faits : qui, quoi, où, quand). Puis des intertitres courts et informatifs (pas de questions racoleuses) : le contexte, les chiffres ou les réactions, ce qui va se passer ensuite. 1 à 3 paragraphes par bloc.
  - **Rien d'inventé** : seulement ce que disent `tmp/sources/<site>/<id>.txt`, le titre et la description du candidat, et des faits de contexte **sûrs et vérifiables** (dates, palmarès, rôle d'une institution). Pas de citation entre guillemets sauf si elle est mot pour mot dans la source, et alors 15 mots au plus et attribuée.
  - **Bilans et chiffres historiques** : même si la source donne un seul chiffre, un bilan discuté se donne en fourchette, avec les dates exactes (ex. génocide des Tutsi au Rwanda : « entre 800 000 et plus d'un million de morts, d'avril à juillet 1994 »). Un chiffre absent de la source (vues, ventes, abonnés…) ne s'écrit pas.
  - **En français**, ton neutre de journaliste, phrases courtes, aucune opinion, aucun vocabulaire de vente.
  - **Jamais 6 mots consécutifs** de la source (le contrôle compare tout le texte de `tmp/sources`). Reformule complètement, ne suis pas l'ordre des phrases de la source.
  - Ne cite jamais un autre site de Jean.
- `autres_sources` : adresses des médias lus en plus quand la source était mince (sinon `[]`).
- `image_alt_large` : description **générique**, vraie pour n'importe quelle photo Openverse trouvée avec tes mots-clés (ex. « Des joueurs lors d'un match de football en Afrique »). Pour une carte générée, le texte alternatif est écrit automatiquement.

## 4. Contrôle anti-copie, puis publication (aucune IA)

```sh
node scripts/publie.mjs --verifier
```

S'il y a des rejets, lis `tmp/rejets-<site>.json` (suites de 6 mots reprises, article trop court ou trop long), **réécris une seule fois** ces actus dans `tmp/redaction-<site>.json`, puis publie :

```sh
node scripts/publie.mjs
```

Les actus encore rejetées sont abandonnées. Le script écrit l'article dans `articles/<site>/<id>.json` (schéma `schema/article-schema-v1.json`), ajoute `slug`, `article_url` et `lecture_min` à l'actu, cherche l'image (Wikimedia → Openverse → banque perso → carte générée), fusionne avec les actus déjà en ligne (60 au plus), valide le schéma v3 (un fichier invalide n'est **pas** publié : l'ancien reste en ligne), puis fait `git add actus articles images cartes etat`, le commit (« Veille du 27/10 à 12 h : 9 actus Keur Foot, 6 actus Keurbook »), `git pull --rebase` et `git push`.

Codes de sortie : `0` = tout est publié ; `1` = au moins un site n'a pas été publié ; `2` = le push a échoué. Le bilan est dans `tmp/publie-bilan.json`.

### Vérifier le cadrage des photos (obligatoire, Jean y tient)

Le script cadre chaque photo sur les visages détectés (Vision du Mac). Vérifie quand même **chaque photo publiée** :

```sh
node scripts/recadre.mjs --planche <site> <id> <id>…   # ids des actus publiées avec une photo
```

Ouvre `tmp/planche-<site>.png` (outil Read). Pour chaque vignette : aucun visage ni tête coupés, le sujet de l'actu visible. Sinon, recadre :

```sh
node scripts/recadre.mjs <site> <id> <haut>    # haut : 0 = garder le haut de la photo, 1 = le bas (essaie 0.1, 0.2…)
```

Pour une photo Openverse, ajoute l'adresse de l'original (page Flickr → `og:image`). Refais la planche jusqu'à ce que ce soit bon, puis `git add images && git commit -m "Veille : recadrage des photos" && git pull --rebase && git push`.

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
