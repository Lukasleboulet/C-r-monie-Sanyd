# SAMP · District de Sandy Shore — Suivi des heures & cérémonies

Site + **serveur** : les comptes, les rôles et les données sont stockés sur le serveur et **partagés en direct** entre tous les ordinateurs (synchronisation toutes les 4 secondes, avec fusion des modifications simultanées).

## Héberger sur ton PC avec Cloudflare Tunnel (Windows) — gratuit
1. Télécharge le projet : https://github.com/Lukasleboulet/c-r-monie-sanyd/archive/refs/heads/main.zip, puis dézippe-le (ex. `Documents\SandyShore`).
2. Double-clique **`INSTALLER.bat`** (installe Node.js et cloudflared), puis **redémarre le PC**.
3. Ouvre **`config.json`** avec le Bloc-notes et colle ton **Client ID** et ta **clé secrète** Discord (laisse `baseUrl` vide).
4. Double-clique **`DEMARRER.bat`** : une adresse `https://xxxx.trycloudflare.com` s'affiche. C'est l'adresse du site.
5. Portail Discord › OAuth2 › Redirects : ajoute `https://xxxx.trycloudflare.com/discord.php` (affichée aussi dans la fenêtre du serveur).
- Garde les deux fenêtres ouvertes et le PC allumé : sinon le site est coupé.
- ⚠️ Sans nom de domaine, **l'adresse change à chaque lancement de DEMARRER.bat** : il faut alors la redonner aux collègues et mettre à jour la redirection Discord. Pour une adresse fixe : un nom de domaine branché sur Cloudflare (tunnel nommé).
- Reprendre les données d'InfinityFree : copie `data/db.php` dans le dossier `data/` du projet avant le premier lancement (importé automatiquement).

## Héberger sur InfinityFree (ou tout hébergement PHP) — RECOMMANDÉ
InfinityFree n'exécute **pas Node.js** : `server.js` n'y tourne pas, d'où l'absence de synchronisation. Le site contient donc un serveur **PHP** équivalent (`api.php`, `discord.php`, `lib.php`).
1. Envoie **tout le contenu du dossier** dans `htdocs/` (FTP ou gestionnaire de fichiers), y compris `.htaccess`.
2. (Discord) Copie `config.example.php` en `config.php` et renseigne `discordClientId` / `discordClientSecret`.
3. Dans le portail Discord › OAuth2 › Redirects, ajoute : `https://TON-DOMAINE/discord.php` (l'URL exacte est affichée dans Administration › Accès & comptes).
4. Ouvre le site : le premier compte créé est administrateur. Le dossier `data/` est créé automatiquement (données protégées, non lisibles depuis le navigateur).
- Active le **SSL gratuit** d'InfinityFree (https) : les cookies de session sont alors sécurisés.
- Limite InfinityFree : ~50 000 requêtes/jour (au-delà : site suspendu jusqu'au lendemain). La synchro interroge le serveur toutes les 15 s quand on utilise le site, toutes les 60 s après 5 min sans activité, et pas du tout quand l'onglet est masqué (≈ 240 requêtes/heure au maximum par personne). app.js, style.css et le logo sont gardés en cache par le navigateur.
- Sauvegarde régulièrement `data/db.php` (ou bouton Sauvegarde).

## Lancer en local avec Node.js (optionnel)
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
2. **Redirects** → ajoute `<baseUrl>/discord.php` (ex. `http://localhost:3000/discord.php`). L'URL exacte est aussi affichée dans Administration › Accès & comptes.
3. Copie le **Client ID** et le **Client Secret** dans `config.json`, relance le serveur.
- Le **tout premier compte** (identifiant ou Discord) est administrateur.
- Ensuite, une personne qui se connecte avec Discord apparaît dans **Administration › Accès & comptes** avec le rôle **En attente** (pastille orange sur l'onglet Paramètres) ; tu lui choisis son rôle, et ça s'applique tout de suite chez elle, sans reconnexion. Tu vois son **pseudo Discord** à côté de son ID.
- Tu peux aussi créer le compte à l'avance (identifiant + ID Discord, mot de passe facultatif).

## Connexion uniquement avec Discord
Dès que Discord est configuré, **seule la connexion Discord est possible** : le formulaire identifiant / mot de passe disparaît et le serveur le refuse. Pour qu'un ancien compte (créé avec un mot de passe) puisse se connecter, renseigne son **ID Discord** dans Administration › Accès & comptes. En cas de panne de Discord, `'passwordLogin' => true` dans `config.php` réactive temporairement les mots de passe.

## Rôles et permissions (Administration › Accès & comptes — administrateurs)
- **Onglets accessibles** par rôle : Effectifs, Heures, Importer, Cérémonie, Statistiques, Paramètres (grades, options de décision, sanctions).
- **Permissions** par rôle (bouton « tout » pour tout cocher) :
  - Agents : créer · modifier · retirer
  - Heures : saisir · importer · ajouter une semaine
  - Cérémonie : préparer · valider · modifier une cérémonie validée
  - Paramètres : grades · options de décision · sanctions · **gérer les comptes** (valider les comptes en attente, gérer les comptes non administrateurs ; contrôlé côté serveur)
  - Données : sauvegarde · restaurer / réinitialiser
- Rôles intégrés : **Administrateur** (tout), **Utilisateur** (permissions de base), **En attente** (aucun accès). Tu peux ajouter tes propres rôles ; les rôles et comptes ne se gèrent que par un administrateur (contrôlé côté serveur).

## Statistiques agent
Onglet **Statistiques** : choisis un agent → total / moyenne sur la **période de ton choix** (ou 4/8/12 dernières semaines), meilleure et plus faible semaine, tendance, classement et écart au district, graphique, **historique des grades** (création, modifications manuelles, décisions de cérémonie), sanctions, absences, formations et détail semaine par semaine.

## Médailles & Google Sheet
Onglet **Médailles** :
- **Synchronisation Google Sheet** (permission « Synchro Google Sheet ») : colle le lien du Sheet (partagé « Tous les utilisateurs disposant du lien »), le district (« Sandy Shore »), puis **Synchroniser**. Un aperçu liste les agents à créer, les grades / matricules / dates d'arrivée à mettre à jour et les agents à archiver (absents du Sheet ou d'un autre district) ; décoche ce que tu ne veux pas, puis **Appliquer**. Les rangs masqués (Patron, Sheriff) sont ignorés. Les grades du Sheet sont reconnus automatiquement (« Officier II » = « Officier-2 »…) ; sinon l'aperçu te demande la correspondance.
- **Date d'arrivée** = la plus ancienne des dates des colonnes de grades (Rookie, Officier…). Modifiable à la main.
- **Rubans de service** : 2, 4, 6, 8, 10 et 12 mois d'ancienneté par défaut, attribués automatiquement ; la durée de chaque ruban / médaille est modifiable (nombre + jours, semaines, mois ou ans) ; liste « Rubans à remettre » avec bouton « Remis ».
- **Médailles** : ajoute / supprime des médailles, avec une image (redimensionnée automatiquement) ou une couleur ; attribution manuelle ou à l'ancienneté.

### Si la synchro ne marche pas
Connecte-toi en administrateur puis ouvre **`https://TON-SITE/diagnostic.php`** : la page teste chaque étape (accès à Google, partage du Sheet, onglet, ligne d'en-tête, nombre d'agents par district) et dit quoi corriger.

## Données et sauvegarde
- `data/db.json` : toutes les données (**à sauvegarder régulièrement**) · `data/secret.key` : clé des sessions (ne pas partager).
- Mots de passe stockés hachés (scrypt + sel). Sessions par cookie sécurisé ; 5 essais ratés = blocage 30 s.
- Boutons Sauvegarde / Restaurer (menu de gauche) : export / import des données du site en JSON.
- Limite : les permissions « actions » sont appliquées dans l'interface ; le serveur vérifie qui peut écrire et protège les comptes et les rôles, mais ne contrôle pas champ par champ les modifications des données.

## Fichiers
`server.js` (serveur) · `index.html`, `style.css`, `app.js` (site) · `seed.js` (base vide) · `assets/logo.png` (écusson).
