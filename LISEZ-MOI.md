# SAMP · District de Sandy Shore — Suivi des heures & cérémonies

Site + **serveur** : les comptes, les rôles et les données sont stockés sur le serveur et **partagés en direct** entre tous les ordinateurs (synchronisation toutes les 4 secondes, avec fusion des modifications simultanées).

## Lancer
1. Installe **Node.js 18 ou plus** (https://nodejs.org) — rien d'autre à installer.
2. Dans le dossier : `node server.js` (ou `npm start`).
3. Ouvre http://localhost:3000
4. Au premier lancement, crée le premier compte : il devient **administrateur**.

> Ne plus ouvrir `index.html` en double-clic ni avec Live Server : le site a besoin du serveur.

## Que les autres puissent se connecter
- **Même réseau** (Wi-Fi/LAN) : ils ouvrent `http://IP-DE-TON-PC:3000` (autorise Node dans le pare-feu).
- **Depuis Internet** : héberge le dossier sur un serveur/VPS (`node server.js`, idéalement derrière un proxy https type Caddy/Nginx), ou utilise un tunnel (cloudflared, ngrok…). Renseigne alors `baseUrl` dans `config.json` avec l'adresse publique.

## Configuration (`config.json`)
Copie `config.example.json` en `config.json` :
```json
{ "port": 3000, "baseUrl": "http://localhost:3000", "discordClientId": "", "discordClientSecret": "" }
```
(ou variables d'environnement `PORT`, `BASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`). Relance le serveur après modification.

## Connexion Discord
1. https://discord.com/developers/applications → **New Application** → onglet **OAuth2**.
2. **Redirects** → ajoute `<baseUrl>/auth/discord/callback` (ex. `http://localhost:3000/auth/discord/callback`). L'URL exacte est aussi affichée dans Paramètres › Comptes utilisateurs.
3. Copie le **Client ID** et le **Client Secret** dans `config.json`, relance le serveur.
- Le **tout premier compte** (identifiant ou Discord) est administrateur.
- Ensuite, une personne qui se connecte avec Discord apparaît dans **Paramètres › Comptes utilisateurs** avec le rôle **En attente** (pastille orange sur l'onglet Paramètres) ; tu lui choisis son rôle, et ça s'applique tout de suite chez elle, sans reconnexion. Tu vois son **pseudo Discord** à côté de son ID.
- Tu peux aussi créer le compte à l'avance (identifiant + ID Discord, mot de passe facultatif).

## Rôles et permissions (Paramètres › Rôles et accès — administrateurs)
- **Onglets accessibles** par rôle : Effectifs, Heures, Importer, Cérémonie, Statistiques, Paramètres (grades, options de décision, sanctions).
- **Permissions** par rôle : créer / modifier / retirer des agents · saisir ou importer les heures · préparer la cérémonie · la valider · modifier une cérémonie validée · sauvegarde · restaurer / réinitialiser.
- Rôles intégrés : **Administrateur** (tout), **Utilisateur** (permissions de base), **En attente** (aucun accès). Tu peux ajouter tes propres rôles ; les rôles et comptes ne se gèrent que par un administrateur (contrôlé côté serveur).

## Statistiques agent
Onglet **Statistiques** : choisis un agent → total / moyenne sur la **période de ton choix** (ou 4/8/12 dernières semaines), meilleure et plus faible semaine, tendance, classement et écart au district, graphique, **historique des grades** (création, modifications manuelles, décisions de cérémonie), sanctions, absences, formations et détail semaine par semaine.

## Données et sauvegarde
- `data/db.json` : toutes les données (**à sauvegarder régulièrement**) · `data/secret.key` : clé des sessions (ne pas partager).
- Mots de passe stockés hachés (scrypt + sel). Sessions par cookie sécurisé ; 5 essais ratés = blocage 30 s.
- Boutons Sauvegarde / Restaurer (menu de gauche) : export / import des données du site en JSON.
- Limite : les permissions « actions » sont appliquées dans l'interface ; le serveur vérifie qui peut écrire et protège les comptes et les rôles, mais ne contrôle pas champ par champ les modifications des données.

## Fichiers
`server.js` (serveur) · `index.html`, `style.css`, `app.js` (site) · `seed.js` (base vide) · `assets/logo.png` (écusson).
