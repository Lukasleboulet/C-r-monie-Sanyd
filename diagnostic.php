<?php
// Diagnostic (administrateurs connectés uniquement) : Discord + lecture du Google Sheet, étape par étape.
// Ouvre https://TON-SITE/diagnostic.php après t'être connecté au site.
require __DIR__ . '/lib.php';
header('Content-Type: text/plain; charset=utf-8'); header('Cache-Control: no-store');
db_open(); $u = authed();
if (!$u || !is_admin($u)) { db_close(); echo "Connecte-toi d'abord au site avec un compte administrateur, puis recharge cette page.\n"; exit; }
$sh = $db->state->sheet ?? null; $url = (string)($sh->url ?? ''); $gid = (string)($sh->gid ?? ''); $dist = (string)($sh->district ?? '');
db_close();
$ok = fn($b) => $b ? 'OK' : 'ÉCHEC';
echo "=== Serveur ===\nPHP " . PHP_VERSION . " · cURL : " . (function_exists('curl_init') ? 'oui' : 'NON') . "\n";
echo "DNS google : " . (gethostbyname('docs.google.com') !== 'docs.google.com' ? 'OK' : 'bloqué (contournement DNS-over-HTTPS utilisé)') . "\n";
echo "IP via DNS-over-HTTPS : " . (function_exists('curl_init') ? (implode(', ', doh_ips('docs.google.com')) ?: 'indisponible') : '-') . "\n\n";
echo "=== Discord ===\n";
try { [$c] = http_req('https://discord.com/api/v10/gateway'); echo "API Discord : HTTP $c → " . $ok($c === 200) . "\n"; } catch (Throwable $e) { echo "API Discord : ÉCHEC → " . $e->getMessage() . "\n"; }
echo "\n=== Google Sheet ===\n";
echo "Lien enregistré : " . ($url ?: '(aucun — colle-le dans Administration › Gestion des médailles)') . "\n";
echo "gid : " . ($gid ?: '(aucun → 1er onglet)') . " · district : " . ($dist ?: '(aucun)') . "\n";
$src = sheet_url($url, $gid !== '' ? $gid : null);
if (!$src) { echo "→ Lien invalide : il doit ressembler à https://docs.google.com/spreadsheets/d/…\n"; exit; }
echo "URL d'export : $src\n";
try { [$c, $t] = http_req($src); }
catch (Throwable $e) { echo "Téléchargement : ÉCHEC → " . $e->getMessage() . "\n"; exit; }
echo "Téléchargement : HTTP $c · " . strlen($t) . " octets\n";
if ($c !== 200) { echo "→ Google refuse (HTTP $c). Vérifie le partage : « Tous les utilisateurs disposant du lien » + « Lecteur ».\n"; exit; }
if (preg_match('/^\s*<(!doctype|html)/i', $t)) { echo "→ Google renvoie une page web au lieu du tableau : le Sheet n'est pas partagé publiquement (« Tous les utilisateurs disposant du lien »).\n"; exit; }
$f = fopen('php://memory', 'r+'); fwrite($f, $t); rewind($f); $rows = []; while (($r = fgetcsv($f, 0, ',', '"', '')) !== false) $rows[] = $r; fclose($f);
$n = fn($s) => strtolower(trim(strtr($s, ['é' => 'e', 'É' => 'e', 'è' => 'e'])));
$h = -1; foreach ($rows as $i => $r) { $L = array_map($n, $r); if (in_array('matricule', $L) && in_array('prenom', $L)) { $h = $i; break; } }
echo "Lignes lues : " . count($rows) . "\n";
if ($h < 0) { echo "→ Ligne d'en-tête introuvable (colonnes « Matricule » et « Prénom »).\n   Si les agents sont dans un autre onglet, renseigne le gid (nombre après « gid= » dans l'adresse quand l'onglet est ouvert).\n   Début du fichier reçu :\n"; foreach (array_slice($rows, 0, 4) as $r) echo '   | ' . implode(' | ', array_slice(array_filter($r, fn($x) => $x !== ''), 0, 10)) . "\n"; exit; }
$H = $rows[$h]; echo "En-tête trouvé ligne " . ($h + 1) . " : " . implode(' | ', array_filter($H, fn($x) => trim($x) !== '')) . "\n";
$col = fn($k) => array_search($k, array_map($n, $H), true);
$cd = $col('district'); $cp = $col('prenom'); $cn = $col('nom');
$cnt = []; $agents = 0;
foreach (array_slice($rows, $h + 1) as $r) { if (trim(($r[$cp] ?? '') . ($r[$cn] ?? '')) === '') continue; $agents++; $d = $cd !== false ? trim($r[$cd] ?? '') : '(pas de colonne District)'; $cnt[$d ?: '(vide)'] = ($cnt[$d ?: '(vide)'] ?? 0) + 1; }
arsort($cnt); echo "Agents trouvés : $agents\nPar district : "; foreach ($cnt as $d => $k) echo "$d ($k) · "; echo "\n";
$match = 0; foreach ($cnt as $d => $k) if ($n($d) === $n($dist)) $match = $k;
echo $match ? "→ OK : $match agent(s) avec le district « $dist ». La synchro devrait fonctionner.\n" : "→ Aucun agent avec le district « $dist » : corrige le nom du district dans Gestion des médailles (il doit être écrit comme dans le Sheet).\n";
