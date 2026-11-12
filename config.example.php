<?php
// Copie ce fichier en « config.php » (même dossier) et remplis-le. Il n'est jamais affiché dans le navigateur.
return [
  // Adresse publique du site (la racine, PAS discord.php). Vide = détectée automatiquement (recommandé).
  // Ex. : 'https://sandyshore.infinityfreeapp.com'
  'baseUrl' => '',
  // Portail Discord : https://discord.com/developers/applications → ton application → OAuth2
  'discordClientId' => '',
  'discordClientSecret' => '',
  // Secours : true = réactive la connexion par identifiant + mot de passe (par défaut : Discord uniquement dès que Discord est configuré).
  'passwordLogin' => false,
];
