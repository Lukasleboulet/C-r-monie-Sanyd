<?php
// Diagnostic : le serveur arrive-t-il à joindre Discord ? Ouvre https://TON-SITE/test-discord.php (aucune donnée sensible affichée).
require __DIR__ . '/lib.php';
header('Content-Type: text/plain; charset=utf-8'); header('Cache-Control: no-store');
echo "cURL : " . (function_exists('curl_init') ? 'oui' : 'NON') . "\n";
echo "DNS discord.com : " . (gethostbyname('discord.com') !== 'discord.com' ? gethostbyname('discord.com') : 'bloqué') . "\n";
echo "IP via DNS-over-HTTPS : " . (function_exists('curl_init') ? (implode(', ', doh_ips('discord.com')) ?: 'indisponible') : '-') . "\n";
try { [$c, $r] = http_req('https://discord.com/api/v10/gateway'); echo "Discord API : HTTP $c " . ($c === 200 ? '→ OK, la connexion Discord peut fonctionner' : '→ ' . substr(strip_tags($r), 0, 150)) . "\n"; }
catch (Throwable $e) { echo "Discord API : ÉCHEC → " . $e->getMessage() . "\n"; }
echo "Identifiants Discord dans config.php : " . (discord_on() ? 'oui' : 'NON') . "\nURL de redirection : " . redirect_uri() . "\n";
