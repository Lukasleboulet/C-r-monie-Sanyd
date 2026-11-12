<?php
// SAMP · District de Sandy Shore — cœur du serveur PHP (hébergement mutualisé type InfinityFree : PHP sans Node.js).
// Même fonctionnement que server.js : comptes, rôles et données partagés, sessions signées, connexion Discord.
// Les données sont stockées dans data/db.php (fichier JSON protégé : il ne s'affiche pas dans le navigateur).
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'lib.php') { http_response_code(404); exit; }
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE); ini_set('display_errors', '0');

const DATA_GUARD = "<?php http_response_code(404); exit; ?>\n"; // empêche la lecture directe des fichiers de données
const TABS = ['eff', 'hrs', 'imp', 'cer', 'sta', 'med', 'set'];
const PERMS = ['agentAdd', 'agentEdit', 'agentDel', 'hoursEdit', 'hoursImport', 'weekAdd', 'cerEdit', 'cerValidate', 'cerEditDone', 'gradeEdit', 'actionEdit', 'sanctionEdit', 'usersManage', 'medalEdit', 'sheetSync', 'dataBackup', 'dataReset'];
const BUILTIN = ['admin', 'user', 'pending'];
const JF = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;

$ROOT = __DIR__; $DATA = $ROOT . '/data';
$CONFIG = ['baseUrl' => '', 'discordClientId' => '', 'discordClientSecret' => '', 'passwordLogin' => false];
if (is_file($ROOT . '/config.php')) { $c = include $ROOT . '/config.php'; if (is_array($c)) $CONFIG = array_merge($CONFIG, $c); }

function base_url() {
  global $CONFIG;
  // tolère une adresse saisie avec un fichier ou des paramètres (ex. https://site/discord.php ou https://site/?i=1)
  if (!empty($CONFIG['baseUrl'])) return rtrim(preg_replace('#/[^/]*\.(php|html?)$#i', '', preg_replace('/[?#].*$/', '', trim($CONFIG['baseUrl']))), '/');
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || ($_SERVER['SERVER_PORT'] ?? '') == 443;
  $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
  return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir;
}
function redirect_uri() { return base_url() . '/discord.php'; }
function discord_on() { global $CONFIG; return $CONFIG['discordClientId'] !== '' && $CONFIG['discordClientSecret'] !== ''; }
function is_secure() { return strpos(base_url(), 'https') === 0; }

// ---------- fichiers de données ----------
function ensure_data() {
  global $DATA;
  if (!is_dir($DATA)) @mkdir($DATA, 0755, true);
  if (!is_file("$DATA/.htaccess")) @file_put_contents("$DATA/.htaccess", "Require all denied\nDeny from all\n");
  if (!is_file("$DATA/index.html")) @file_put_contents("$DATA/index.html", '');
}
function read_guarded($f) { $s = @file_get_contents($f); if ($s === false) return null; if (strpos($s, DATA_GUARD) === 0) $s = substr($s, strlen(DATA_GUARD)); return $s; }
function write_guarded($f, $s) {
  $t = $f . '.tmp' . bin2hex(random_bytes(3));
  if (@file_put_contents($t, DATA_GUARD . $s) === false) throw new Exception('Écriture impossible dans data/ (droits du dossier ?)');
  if (!@rename($t, $f)) { @unlink($f); if (!@rename($t, $f)) throw new Exception('Écriture impossible dans data/'); }
}
function secret() {
  global $DATA; static $s = null; if ($s) return $s;
  $f = "$DATA/secret.php"; $s = trim((string)read_guarded($f));
  if (strlen($s) < 32) { $s = bin2hex(random_bytes(32)); write_guarded($f, $s); }
  return $s;
}
function default_roles() {
  return [
    (object)['id' => 'admin', 'name' => 'Administrateur', 'admin' => true, 'builtin' => true, 'tabs' => array_slice(TABS, 0, 6), 'perms' => PERMS],
    (object)['id' => 'user', 'name' => 'Utilisateur', 'builtin' => true, 'tabs' => array_slice(TABS, 0, 6), 'perms' => ['agentAdd', 'hoursEdit', 'hoursImport', 'weekAdd', 'cerEdit', 'cerValidate', 'dataBackup']],
    (object)['id' => 'pending', 'name' => 'En attente', 'builtin' => true, 'tabs' => [], 'perms' => []]];
}

// Verrou global : une seule requête à la fois lit/modifie la base (pas de pertes en cas d'écritures simultanées).
$LOCK = null; $db = null; $dbDirty = false;
function db_open() {
  global $DATA, $LOCK, $db;
  ensure_data();
  $LOCK = fopen("$DATA/lock", 'c'); if ($LOCK) flock($LOCK, LOCK_EX);
  $raw = read_guarded("$DATA/db.php");
  // Import d'une base Node (data/db.json) si présente et pas encore de base PHP
  if ($raw === null && is_file("$DATA/db.json")) $raw = @file_get_contents("$DATA/db.json");
  $d = $raw ? json_decode($raw) : null;
  if (!is_object($d)) $d = (object)[];
  foreach (['v' => 1, 'sv' => 0, 'state' => null, 'users' => [], 'roles' => null] as $k => $v) if (!property_exists($d, $k)) $d->$k = $v;
  if (!is_array($d->roles)) $d->roles = [];
  foreach (default_roles() as $i => $r) { $has = false; foreach ($d->roles as $x) if ($x->id === $r->id) $has = true; if (!$has) array_splice($d->roles, min($i, count($d->roles)), 0, [$r]); }
  if (($d->pv ?? 1) < 2) { // nouvelles permissions : accordées aux rôles qui avaient déjà l'accès équivalent
    foreach ($d->roles as $r) {
      if (!empty($r->admin)) { $r->perms = PERMS; continue; }
      $p = (array)($r->perms ?? []);
      if (in_array('hoursEdit', $p)) array_push($p, 'hoursImport', 'weekAdd');
      if (in_array('set', (array)($r->tabs ?? []))) array_push($p, 'gradeEdit', 'actionEdit', 'sanctionEdit');
      $r->perms = array_values(array_unique($p));
    }
    $d->pv = 2; $GLOBALS['dbDirty'] = true;
  }
  if (($d->pv ?? 1) < 3) { // onglet Médailles + permissions médailles / Google Sheet
    foreach ($d->roles as $r) {
      if (!empty($r->admin)) { $r->perms = PERMS; $r->tabs = array_slice(TABS, 0, 6); continue; }
      $t = (array)($r->tabs ?? []); $p = (array)($r->perms ?? []);
      if (in_array('sta', $t)) $t[] = 'med';
      if (in_array('cerEdit', $p)) $p[] = 'medalEdit';
      $r->tabs = array_values(array_unique($t)); $r->perms = array_values(array_unique($p));
    }
    $d->pv = 3; $GLOBALS['dbDirty'] = true;
  }
  $db = $d;
}
function db_close() {
  global $DATA, $LOCK, $db, $dbDirty;
  if ($dbDirty && $db) write_guarded("$DATA/db.php", json_encode($db, JF));
  $dbDirty = false;
  if ($LOCK) { flock($LOCK, LOCK_UN); fclose($LOCK); $LOCK = null; }
}
function touch_db() { global $db, $dbDirty; $db->v++; $dbDirty = true; }

// ---------- utilitaires ----------
function uid() { return bin2hex(random_bytes(6)); }
function b64u($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function ub64u($s) { return base64_decode(strtr($s, '-_', '+/')); }
function sign_s($s) { return b64u(hash_hmac('sha256', $s, secret(), true)); }
function mk_tok($id, $ttlMs) { $p = b64u(json_encode(['u' => $id, 'e' => round(microtime(true) * 1000) + $ttlMs])); return $p . '.' . sign_s($p); }
function read_tok($t) {
  if (!$t || strpos($t, '.') === false) return null;
  [$p, $s] = explode('.', $t, 2);
  if (!hash_equals(sign_s($p), $s)) return null;
  $o = json_decode(ub64u($p)); return $o && $o->e > microtime(true) * 1000 ? $o : null;
}
function set_cookie($name, $val, $maxAge = 0) {
  $o = ['path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => is_secure()];
  if ($maxAge) $o['expires'] = $maxAge < 0 ? 1 : time() + $maxAge;
  setcookie($name, $val, $o);
}
function out($code, $obj) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store, no-cache, must-revalidate'); header('Pragma: no-cache');
  echo json_encode($obj, JF);
}
function body() { static $b = null; if ($b === null) { $raw = file_get_contents('php://input'); $b = $raw ? json_decode($raw) : (object)[]; if (!is_object($b)) $b = (object)[]; } return $b; }
function set_pwd($u, $pwd) { $u->hash = password_hash($pwd, PASSWORD_DEFAULT); unset($u->salt); }
function check_pwd($u, $pwd) {
  if (empty($u->hash)) return false;
  if (empty($u->salt)) return password_verify((string)$pwd, $u->hash);
  return false; // ancien mot de passe créé par server.js (scrypt) : à redéfinir par un administrateur
}
function find_role($id) { global $db; foreach ($db->roles as $r) if ($r->id === $id) return $r; return null; }
function role_of($u) { return find_role($u->role ?? '') ?: find_role('user'); }
function is_admin($u) { return !empty(role_of($u)->admin); }
function perms_of($u) { return (array)(role_of($u)->perms ?? []); }
function can_read($u) { $r = role_of($u); return !empty($r->admin) || count((array)$r->tabs) > 0 || count((array)$r->perms) > 0; }
function can_write($u) { $r = role_of($u); return !empty($r->admin) || count((array)$r->perms) > 0 || count(array_intersect((array)$r->tabs, ['eff', 'hrs', 'imp', 'cer', 'set'])) > 0; }
function can_manage($u) { return is_admin($u) || in_array('usersManage', perms_of($u)); }
function pub($u) {
  return ['id' => $u->id, 'name' => $u->name, 'role' => $u->role, 'discordId' => $u->discordId ?? '', 'dname' => $u->dname ?? '', 'dun' => $u->dun ?? '',
    'avatar' => $u->avatar ?? null, 'created' => $u->created ?? 0, 'hasPwd' => !empty($u->hash) && empty($u->salt)];
}
function find_user($id) { global $db; foreach ($db->users as $u) if ($u->id === $id) return $u; return null; }
function authed() { $t = read_tok($_COOKIE['sid'] ?? ''); return $t ? find_user($t->u) : null; }
function pwd_on() { global $CONFIG; return !discord_on() || !empty($CONFIG['passwordLogin']); } // identifiant + mot de passe : seulement sans Discord (ou secours activé)
function flags() { return ['discord' => discord_on(), 'redirect' => redirect_uri(), 'pwd' => pwd_on()]; }
function payload($u) {
  global $db;
  $p = flags() + ['v' => $db->v, 'sv' => $db->sv, 'me' => pub($u), 'roles' => $db->roles];
  if (can_read($u)) $p['state'] = $db->state;
  if (can_manage($u)) $p['users'] = array_map('pub', $db->users);
  return $p;
}
function admin_view() { global $db; return ['v' => $db->v, 'users' => array_map('pub', $db->users), 'roles' => $db->roles]; }
function login_user($u, $remember) { set_cookie('sid', mk_tok($u->id, 30 * 864e5), $remember ? 30 * 86400 : 0); }
function slen($s) { return function_exists('mb_strlen') ? mb_strlen($s) : strlen($s); }
function name_err($n) {
  global $db;
  if (!is_string($n) || slen($n) < 2 || slen($n) > 32) return 'L’identifiant doit faire entre 2 et 32 caractères.';
  if (preg_match('/\s/u', $n)) return 'Pas d’espace dans l’identifiant.';
  foreach ($db->users as $u) if (strtolower($u->name) === strtolower($n)) return 'Cet identifiant existe déjà.';
  return '';
}
function pwd_err($p) { return !is_string($p) || slen($p) < 4 ? 'Le mot de passe doit faire au moins 4 caractères.' : ''; }
function did_err($d, $except = null) {
  global $db;
  if ($d && !preg_match('/^\d{15,22}$/', $d)) return 'ID Discord invalide (un nombre de 17 à 19 chiffres).';
  if ($d) foreach ($db->users as $u) if ($u->id !== $except && ($u->discordId ?? '') === $d) return 'Cet ID Discord est déjà associé à un compte.';
  return '';
}
function clean_roles($inp) {
  global $db;
  if (!is_array($inp) || count($inp) > 60) return null;
  $out = []; $names = [];
  foreach ($inp as $r) {
    if (!is_object($r) || !is_string($r->id ?? null) || !preg_match('/^[a-z0-9]{3,24}$/', $r->id) || !is_string($r->name ?? null)) return null;
    $name = trim($r->name); $name = function_exists('mb_substr') ? mb_substr($name, 0, 40) : substr($name, 0, 40);
    $k = function_exists('mb_strtolower') ? mb_strtolower($name) : strtolower($name);
    if ($name === '' || isset($names[$k])) return null; $names[$k] = 1;
    $adm = $r->id === 'admin';
    $o = (object)['id' => $r->id, 'name' => $name];
    if ($adm) $o->admin = true;
    $o->builtin = in_array($r->id, BUILTIN, true);
    $o->tabs = $adm ? array_slice(TABS, 0, 6) : array_values(array_unique(array_filter(is_array($r->tabs ?? null) ? $r->tabs : [], fn($t) => in_array($t, TABS, true))));
    $o->perms = $adm ? PERMS : array_values(array_unique(array_filter(is_array($r->perms ?? null) ? $r->perms : [], fn($p) => in_array($p, PERMS, true))));
    $out[] = $o;
  }
  foreach (BUILTIN as $id) { $ok = false; foreach ($out as $r) if ($r->id === $id) $ok = true; if (!$ok) return null; }
  foreach ($db->users as $u) { $ok = false; foreach ($out as $r) if ($r->id === $u->role) $ok = true; if (!$ok) return null; }
  return $out;
}

// lien Google Sheets -> URL d'export CSV (seul docs.google.com est accepté)
function sheet_url($link, $gid = null) {
  if (!preg_match('#docs\.google\.com/spreadsheets/d/([\w-]{20,})#', (string)$link, $m)) return null;
  if ($gid === null && preg_match('#[\#&?]gid=(\d+)#', (string)$link, $g)) $gid = $g[1];
  return 'https://docs.google.com/spreadsheets/d/' . $m[1] . '/export?format=csv' . ($gid !== null && ctype_digit((string)$gid) ? '&gid=' . $gid : '');
}

// ---------- limitation des essais de connexion ----------
function fails_rw($fn) {
  global $DATA; $f = "$DATA/fails.php";
  $all = json_decode((string)read_guarded($f), true) ?: []; $now = time();
  foreach ($all as $k => $v) if ($v['until'] < $now - 600 && $v['t'] < $now - 600) unset($all[$k]);
  $r = $fn($all); write_guarded($f, json_encode($all)); return $r;
}
function client_ip() { return $_SERVER['REMOTE_ADDR'] ?? '?'; }
function too_many() { $ip = client_ip(); return fails_rw(fn(&$a) => isset($a[$ip]) && $a[$ip]['until'] > time()); }
function add_fail() { $ip = client_ip(); fails_rw(function (&$a) use ($ip) { $f = $a[$ip] ?? ['n' => 0, 'until' => 0, 't' => time()]; $f['n']++; $f['t'] = time(); if ($f['n'] >= 5) { $f['until'] = time() + 30; $f['n'] = 0; } $a[$ip] = $f; }); }
function clear_fail() { $ip = client_ip(); fails_rw(function (&$a) use ($ip) { unset($a[$ip]); }); }

// ---------- HTTP sortant (Discord) ----------
// Certains hébergeurs gratuits (InfinityFree…) bloquent la résolution DNS : « Could not resolve host ».
// Dans ce cas on obtient l'IP via DNS-over-HTTPS (1.1.1.1 / 8.8.8.8, interrogés par IP), sinon des IP connues de Discord,
// puis on se connecte directement à cette IP (le certificat HTTPS reste vérifié pour le vrai nom d'hôte).
const DISCORD_IPS = ['162.159.137.232', '162.159.135.232', '162.159.136.232', '162.159.138.232', '162.159.128.233'];
function curl_raw($url, $method, $headers, $body, $resolve = null) {
  $c = curl_init($url);
  $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_USERAGENT => 'SandyShore-MDT (https://github.com, 1.0)'];
  if ($resolve) $o[CURLOPT_RESOLVE] = $resolve;
  $loc = null; $o[CURLOPT_HEADERFUNCTION] = function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); return strlen($h); };
  if ($body !== null) $o[CURLOPT_POSTFIELDS] = $body;
  curl_setopt_array($c, $o);
  $r = curl_exec($c); $code = curl_getinfo($c, CURLINFO_HTTP_CODE); $no = curl_errno($c); $err = curl_error($c); curl_close($c);
  return [$r, $code, $no, $err, $loc];
}
function doh_ips($host) {
  $ips = [];
  foreach (['https://1.1.1.1/dns-query?name=', 'https://8.8.8.8/resolve?name=', 'https://1.0.0.1/dns-query?name='] as $u) {
    [$r, $code] = curl_raw($u . rawurlencode($host) . '&type=A', 'GET', ['Accept: application/dns-json'], null);
    $j = $r ? json_decode($r) : null;
    foreach ($j->Answer ?? [] as $a) if (($a->type ?? 0) == 1 && filter_var($a->data ?? '', FILTER_VALIDATE_IP)) $ips[] = $a->data;
    if ($ips) break;
  }
  return $ips;
}
function http_req($url, $method = 'GET', $headers = [], $body = null, $hops = 0) {
  if (function_exists('curl_init')) {
    [$r, $code, $no, $err, $loc] = curl_raw($url, $method, $headers, $body);
    if ($r === false && $no === 6) { // CURLE_COULDNT_RESOLVE_HOST
      $host = parse_url($url, PHP_URL_HOST); $tried = [];
      $ips = array_unique(array_merge(doh_ips($host), $host === 'discord.com' ? DISCORD_IPS : []));
      foreach ($ips as $ip) {
        [$r, $code, $no, $err2, $loc] = curl_raw($url, $method, $headers, $body, ["$host:443:$ip"]);
        if ($r !== false) break; $tried[] = "$ip ($err2)";
      }
      if ($r === false) throw new Exception('cURL : ' . $err . ($ips ? ' ; connexion directe impossible : ' . implode(', ', array_slice($tried, 0, 2)) : ' ; DNS-over-HTTPS indisponible'));
    }
    if ($r === false) throw new Exception('cURL : ' . $err);
    if ($code >= 300 && $code < 400 && $loc && $hops < 5 && $method === 'GET') { // redirection (ex. Google Sheets -> googleusercontent.com)
      $next = strpos($loc, 'http') === 0 ? $loc : preg_replace('#^(https?://[^/]+).*$#', '$1', $url) . $loc;
      return http_req($next, 'GET', $headers, null, $hops + 1);
    }
    return [$code, $r];
  }
  $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", array_merge($headers, ['User-Agent: SandyShore-MDT (https://github.com, 1.0)'])), 'content' => $body ?? '', 'ignore_errors' => true, 'timeout' => 15]]);
  $r = @file_get_contents($url, false, $ctx); if ($r === false) throw new Exception('connexion à Discord impossible');
  $code = 0; foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
  return [$code, $r];
}
