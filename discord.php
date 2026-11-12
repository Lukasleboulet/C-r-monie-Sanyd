<?php
// Connexion Discord (OAuth2, flux « code » : le secret reste sur le serveur).
// discord.php            → redirige vers Discord
// discord.php?code=…     → retour de Discord (URL de redirection à enregistrer dans le portail Discord)
require __DIR__ . '/lib.php';
header('Cache-Control: no-store');
function go($loc) { header('Location: ' . $loc, true, 302); exit; }
function back($c, $why = '') { go('./?dc=' . $c . ($why !== '' ? '&why=' . rawurlencode(substr($why, 0, 160)) : '')); }
function why($step, $c, $r) { // résumé lisible de la réponse de Discord (JSON d'erreur, ou page Cloudflare si l'IP de l'hébergeur est bloquée)
  $j = json_decode($r); $d = $j ? trim(($j->error ?? '') . ' ' . ($j->error_description ?? $j->message ?? '')) : '';
  if (!$d) $d = stripos($r, 'cloudflare') !== false ? 'bloqué par Cloudflare (IP de l’hébergeur)' : trim(substr(strip_tags($r), 0, 80));
  error_log("Discord $step $c : $r"); return "$step HTTP $c : $d";
}

if (!discord_on()) back('conf');
if (!isset($_GET['code']) && !isset($_GET['error'])) {
  $st = bin2hex(random_bytes(16)); set_cookie('dst', $st, 600);
  go('https://discord.com/oauth2/authorize?' . http_build_query(['client_id' => $CONFIG['discordClientId'], 'response_type' => 'code', 'scope' => 'identify', 'redirect_uri' => redirect_uri(), 'state' => $st]));
}
$st = $_GET['state'] ?? ''; $code = $_GET['code'] ?? ''; $ck = $_COOKIE['dst'] ?? ''; set_cookie('dst', '', -1);
if (!$code) back('denied');
if (!$st || !hash_equals($ck, $st)) back('state');
try {
  [$c, $r] = http_req('https://discord.com/api/v10/oauth2/token', 'POST', ['Content-Type: application/x-www-form-urlencoded'],
    http_build_query(['client_id' => $CONFIG['discordClientId'], 'client_secret' => $CONFIG['discordClientSecret'], 'grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => redirect_uri()]));
  if ($c !== 200) back('error', why('jeton', $c, $r));
  $tok = json_decode($r);
  [$c, $r] = http_req('https://discord.com/api/v10/users/@me', 'GET', ['Authorization: ' . $tok->token_type . ' ' . $tok->access_token]);
  if ($c !== 200) back('error', why('profil', $c, $r));
  $pf = json_decode($r); if (!$pf || empty($pf->id)) back('error', 'profil illisible');

  db_open();
  $u = null; foreach ($db->users as $x) if (($x->discordId ?? '') === (string)$pf->id) $u = $x;
  if (!$u) {
    $name = substr(preg_replace('/\s+/u', '_', (string)($pf->global_name ?? $pf->username ?? 'Discord')), 0, 28);
    if (strlen($name) < 2) $name = 'discord_' . substr($pf->id, -4);
    foreach ($db->users as $x) if (strtolower($x->name) === strtolower($name)) { $name .= '#' . substr($pf->id, -4); break; }
    $u = (object)['id' => uid(), 'name' => $name, 'role' => count($db->users) ? 'pending' : 'admin', 'discordId' => (string)$pf->id, 'created' => round(microtime(true) * 1000)];
    $db->users[] = $u;
  }
  $u->dname = (string)($pf->global_name ?? $pf->username ?? ''); $u->dun = (string)($pf->username ?? ''); $u->avatar = $pf->avatar ?? null;
  touch_db(); db_close();
  login_user($u, true); back('ok');
} catch (Throwable $e) { error_log('Discord : ' . $e->getMessage()); try { db_close(); } catch (Throwable $x) {} back('error', $e->getMessage()); }
