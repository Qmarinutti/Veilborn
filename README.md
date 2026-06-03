# 🥚 Pokelike — jeu d'élevage idle multijoueur

Petit jeu web (non commercial pour l'instant) : tu élèves des **Bestioles**
originales, tu fais éclore des œufs, tu reproduis pour obtenir de nouvelles
espèces, et tu compares ta collection aux autres joueurs.

## Lancer en local

```bash
npm install
npm start                 # http://localhost:3000
# ou sur un autre port si 3000 est pris :
#   PORT=3100 npm start    (PowerShell : $env:PORT=3100; npm start)
```

En local, le jeu crée un fichier `data.db` (SQLite) — aucune config nécessaire.

## Mettre en ligne gratuitement (Render + Turso)

Le jeu est conçu pour un hébergement gratuit : l'« idle » est calculé à partir
d'horodatages, donc même un serveur qui se met en veille **ne perd aucune
progression**. Les sauvegardes vivent dans **Turso** (SQLite hébergé), séparé de
l'app, donc rien n'est perdu lors des redéploiements.

### 1. Base de données — Turso (gratuit, sans CB)
1. Crée un compte sur https://turso.tech
2. Crée une base (« database »).
3. Récupère **l'URL** (`libsql://...`) et génère un **token**.

### 2. Code — GitHub
1. Crée un dépôt sur https://github.com
2. Pousse ce dossier :
   ```bash
   git remote add origin https://github.com/TON-PSEUDO/pokelike.git
   git push -u origin main
   ```

### 3. Hébergement — Render (gratuit, sans CB)
1. Crée un compte sur https://render.com
2. **New → Web Service**, connecte ton dépôt GitHub `pokelike`.
3. Render détecte `render.yaml`. Dans **Environment**, ajoute :
   - `TURSO_DATABASE_URL` = l'URL Turso
   - `TURSO_AUTH_TOKEN` = le token Turso
4. **Deploy**. Tu obtiens une adresse type `https://pokelike.onrender.com`.

> Astuce : sur le forfait gratuit, l'app « s'endort » après ~15 min sans
> visiteur (réveil ~30 s au prochain accès). Pour l'enlever : forfait payant
> Render (~7 $/mois), **sans rien changer au code**.

## Ce qui marche (v0.2)

- **Comptes** : inscription / connexion (mot de passe haché, session cookie).
- **Élevage idle** : tes adultes produisent de l'essence en continu, même
  hors-ligne (plafonné à 12 h). Œufs et bébés évoluent tout seuls avec le temps.
- **Reproduction / génétique** : 2 adultes → 1 œuf (gènes hérités + mutation,
  chance de rareté supérieure et de *shiny*).
- **Sprites** dessinés en SVG (silhouette + couleur par type, shiny dorés).
- **Prairie** 🌳 : tes Bestioles se baladent dans un pré.
- **Incubateurs** achetables, **collection** (renommer / relâcher).
- **Multijoueur (async)** : classement + visite de l'élevage des autres.

## Suite prévue

- 🔄 Échange de Bestioles entre joueurs (marché / troc).
- ⚔️ Combats PvP (stats `force/vita/speed` et types déjà prêts).

## Structure

```
server/
  index.js   API REST + fichiers statiques
  db.js      base libSQL (fichier local OU Turso en prod)
  auth.js    inscription / connexion / sessions
  game.js    espèces, génétique, équilibrage   ← règle l'équilibrage ici (BALANCE / SPECIES)
  state.js   calcul idle (essence, éclosions, maturations)
public/
  index.html / css/style.css
  js/app.js      interface + prairie animée
  js/sprites.js  générateur de sprites SVG     ← remplace ici par de l'art si besoin
```
