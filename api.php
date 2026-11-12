<?php
// SAMP · District de Sandy Shore — API (équivalent PHP de server.js). Appelé par app.js : api.php?r=<route>[&_m=PUT|PATCH|DELETE]
require __DIR__ . '/lib.php';

try {
  db_open();
  route();
  db_close();
} catch (Throwable $e) {
  error_log('Sandy Shore : ' . $e->getMessage());
  try { $GLOBALS['dbDirty'] = false; db_close(); } catch (Throwable $x) {}
  if (!headers_sent()) out(500, ['error' => 'Erreur serveur : ' . $e->getMessage()]);
}

function route() {
  global $db;
  $m = strtoupper($_GET['_m'] ?? $_SERVER['REQUEST_METHOD']);
  $r = trim((string)($_GET['r'] ?? ''), '/'); $seg = $r === '' ? [] : explode('/', $r);
  $u = authed(); $b = in_array($m, ['POST', 'PUT', 'PATCH', 'DELETE']) ? body() : (object)[];

  if ($m === 'GET' && $r === 'boot') return out(200, $u ? payload($u) : flags() + ['me' => null, 'firstRun' => !count($db->users)]);
  if (!pwd_on() && $m === 'POST' && in_array($r, ['setup', 'login'])) return out(403, ['error' => 'Connexion uniquement avec Discord.']);
  if ($m === 'POST' && $r === 'setup') {
    if (count($db->users)) return out(403, ['error' => 'Un compte existe déjà.']);
    $name = trim((string)($b->name ?? '')); $err = name_err($name) ?: pwd_err($b->password ?? null);
    if ($err) return out(400, ['error' => $err]);
    $nu = (object)['id' => uid(), 'name' => $name, 'role' => 'admin', 'created' => round(microtime(true) * 1000)]; set_pwd($nu, $b->password);
    $db->users[] = $nu; touch_db(); login_user($nu, !empty($b->remember));
    return out(200, payload($nu));
  }
  if ($m === 'POST' && $r === 'login') {
    if (too_many()) return out(429, ['error' => 'Trop d’essais : réessaie dans quelques secondes.']);
    $n = strtolower(trim((string)($b->name ?? ''))); $t = null;
    foreach ($db->users as $x) if (strtolower($x->name) === $n) $t = $x;
    if (!$t || !check_pwd($t, $b->password ?? '')) {
      add_fail();
      return out(401, ['error' => $t && !empty($t->salt) ? 'Mot de passe à redéfinir (ancien serveur) : demande à un administrateur, ou connecte-toi avec Discord.' : 'Identifiant ou mot de passe incorrect']);
    }
    clear_fail(); login_user($t, !empty($b->remember)); return out(200, payload($t));
  }
  if ($m === 'POST' && $r === 'logout') { set_cookie('sid', '', -1); return out(200, ['ok' => true]); }
  if (!$u) return out(401, ['error' => 'Non connecté']);

  if ($m === 'GET' && $r === 'sync') return out(200, (string)$db->v === (string)($_GET['v'] ?? '') ? ['same' => true, 'v' => $db->v] : payload($u));
  if ($m === 'PUT' && $r === 'state') {
    if (!can_write($u)) return out(403, ['error' => 'Droits insuffisants']);
    $s = $b->state ?? null;
    if (!is_object($s) || !is_array($s->agents ?? null) || !is_array($s->weeks ?? null)) return out(400, ['error' => 'Données invalides']);
    if (($b->base ?? null) !== $db->sv) return out(409, ['state' => $db->state, 'sv' => $db->sv, 'v' => $db->v]);
    $db->state = $s; $db->sv++; touch_db(); return out(200, ['sv' => $db->sv, 'v' => $db->v]);
  }
  if ($m === 'GET' && $r === 'sheet') { // lecture d'un Google Sheet (CSV) côté serveur
    if (!is_admin($u) && !in_array('sheetSync', perms_of($u))) return out(403, ['error' => 'Droits insuffisants']);
    $src = sheet_url($_GET['url'] ?? '', isset($_GET['gid']) && $_GET['gid'] !== '' ? $_GET['gid'] : null);
    if (!$src) return out(400, ['error' => 'Lien Google Sheets invalide.']);
    db_close(); // la lecture peut prendre quelques secondes : on libère la base
    try { [$c, $t] = http_req($src); }
    catch (Throwable $e) { return out(502, ['error' => 'Google Sheets injoignable : ' . $e->getMessage()]); }
    if ($c !== 200 || preg_match('/^\s*<(!doctype|html)/i', $t)) return out(400, ['error' => "Google Sheets a refusé l’accès (HTTP $c) : le fichier doit être partagé « Tous les utilisateurs disposant du lien »."]);
    return out(200, ['csv' => $t]);
  }
  if ($m === 'POST' && $r === 'me/password') {
    if (!pwd_on()) return out(403, ['error' => 'Connexion uniquement avec Discord : pas de mot de passe.']);
    if (!empty($u->hash) && empty($u->salt) && !check_pwd($u, $b->old ?? '')) return out(400, ['error' => 'Le mot de passe actuel est incorrect.']);
    $err = pwd_err($b->password ?? null); if ($err) return out(400, ['error' => $err]);
    set_pwd($u, $b->password); touch_db(); return out(200, ['ok' => true]);
  }

  // ----- comptes : administrateurs + rôles avec « Gérer comptes » (sans toucher aux administrateurs) ; rôles : administrateurs -----
  if (!can_manage($u)) return out(403, ['error' => 'Réservé aux administrateurs']);
  $adm = is_admin($u);
  $roleOk = function ($id) use ($adm) { $r = find_role((string)$id); return $r && ($adm || empty($r->admin)); };

  if ($m === 'POST' && $r === 'users') {
    $name = trim((string)($b->name ?? '')); $pwd = pwd_on() ? (string)($b->password ?? '') : ''; $did = trim((string)($b->discordId ?? ''));
    if (!pwd_on() && $did === '') return out(400, ['error' => 'Connexion uniquement avec Discord : renseigne l’ID Discord du compte.']);
    $err = name_err($name) ?: did_err($did) ?: (($pwd !== '' || $did === '') ? pwd_err($pwd) : '') ?: ($roleOk($b->role ?? '') ? '' : 'Rôle inconnu ou non autorisé.');
    if ($err) return out(400, ['error' => $err]);
    $nu = (object)['id' => uid(), 'name' => $name, 'role' => $b->role, 'created' => round(microtime(true) * 1000)];
    if ($did !== '') $nu->discordId = $did; if ($pwd !== '') set_pwd($nu, $pwd);
    $db->users[] = $nu; touch_db(); return out(200, admin_view());
  }
  if (($seg[0] ?? '') === 'users' && isset($seg[1])) {
    $t = find_user($seg[1]); if (!$t) return out(404, ['error' => 'Compte introuvable']);
    if (!$adm && is_admin($t)) return out(403, ['error' => 'Seul un administrateur peut modifier un compte administrateur.']);
    $admins = function () { global $db; return count(array_filter($db->users, 'is_admin')); };
    if ($m === 'PATCH' && count($seg) === 2) {
      if (property_exists($b, 'role')) {
        if (!$roleOk($b->role)) return out(400, ['error' => 'Rôle inconnu ou non autorisé.']);
        if (is_admin($t) && empty(find_role($b->role)->admin) && $admins() < 2) return out(400, ['error' => 'Il doit rester au moins un administrateur.']);
        $t->role = $b->role;
      }
      if (property_exists($b, 'discordId')) {
        $d = trim((string)$b->discordId);
        $err = did_err($d, $t->id) ?: (($d === '' && (empty($t->hash) || !pwd_on())) ? 'Ce compte n’a pas de mot de passe : garde son ID Discord ou définis-lui un mot de passe.' : '');
        if ($err) return out(400, ['error' => $err]);
        if ($d !== '') $t->discordId = $d; else unset($t->discordId);
      }
      touch_db(); return out(200, admin_view());
    }
    if ($m === 'DELETE' && count($seg) === 2) {
      if ($t->id === $u->id) return out(400, ['error' => 'Tu ne peux pas supprimer ton propre compte.']);
      if (is_admin($t) && $admins() < 2) return out(400, ['error' => 'Il doit rester au moins un administrateur.']);
      $db->users = array_values(array_filter($db->users, fn($x) => $x !== $t)); touch_db(); return out(200, admin_view());
    }
    if ($m === 'POST' && ($seg[2] ?? '') === 'password') {
      if (!pwd_on()) return out(403, ['error' => 'Connexion uniquement avec Discord : pas de mot de passe.']);
      $err = pwd_err($b->password ?? null); if ($err) return out(400, ['error' => $err]);
      set_pwd($t, $b->password); touch_db(); return out(200, admin_view());
    }
  }
  if ($m === 'PUT' && $r === 'roles') {
    if (!$adm) return out(403, ['error' => 'Réservé aux administrateurs']);
    $rl = clean_roles($b->roles ?? null); if (!$rl) return out(400, ['error' => 'Rôles invalides (nom en double, rôle intégré manquant ou rôle encore utilisé).']);
    $db->roles = $rl; touch_db(); return out(200, admin_view());
  }
  return out(404, ['error' => 'Introuvable']);
}
