#!/usr/bin/env node
// SAMP · District de Sandy Shore — serveur (Node.js ≥ 18, aucune dépendance à installer).
// Rôle : héberger le site + stocker comptes, rôles et données PARTAGÉS entre tous les ordinateurs,
// gérer les sessions et la connexion Discord (OAuth2, secret gardé côté serveur).
// Lancer : node server.js   →   http://localhost:3000
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = __dirname, DATA = process.env.DATA_DIR || path.join(ROOT, 'data'), DBF = path.join(DATA, 'db.json');
fs.mkdirSync(DATA, { recursive: true });
let C = {}; try { C = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch (e) {}
const PORT = +(process.env.PORT || C.port || 3000);
const FIXED = (process.env.BASE_URL || C.baseUrl || '').replace(/\/$/, ''); // vide = adresse détectée à chaque requête (tunnel Cloudflare, réseau local…)
let BASE = FIXED || `http://localhost:${PORT}`;
const DC = { id: process.env.DISCORD_CLIENT_ID || C.discordClientId || '', secret: process.env.DISCORD_CLIENT_SECRET || C.discordClientSecret || '' };
let REDIRECT = BASE + '/discord.php', SECURE = BASE.startsWith('https');

// ---------- secret de session + base de données (fichiers JSON dans ./data) ----------
const SKF = path.join(DATA, 'secret.key'); let SECRET;
try { SECRET = fs.readFileSync(SKF, 'utf8'); } catch (e) { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SKF, SECRET, { mode: 0o600 }); }

const TABS = ['eff', 'hrs', 'imp', 'cer', 'sta', 'med', 'set'];
const PERMS = ['agentAdd', 'agentEdit', 'agentDel', 'hoursEdit', 'hoursImport', 'weekAdd', 'cerEdit', 'cerValidate', 'cerEditDone', 'cerAll', 'gradeEdit', 'actionEdit', 'sanctionEdit', 'usersManage', 'medalEdit', 'sheetSync', 'dataBackup', 'dataReset'];
const BUILTIN = ['admin', 'pending']; // rôles indispensables (« Utilisateur » est un rôle ordinaire, supprimable)
const defaultRoles = () => [
  { id: 'admin', name: 'Administrateur', admin: true, builtin: true, tabs: TABS.slice(0, 6), perms: [...PERMS] },
  { id: 'user', name: 'Utilisateur', builtin: false, tabs: TABS.slice(0, 6), perms: ['agentAdd', 'hoursEdit', 'hoursImport', 'weekAdd', 'cerEdit', 'cerValidate', 'dataBackup'] },
  { id: 'pending', name: 'En attente', builtin: true, tabs: [], perms: [] }];
const DISTRICTS = ['mr', 'vesp', 'alta', 'sandy', 'rox']; // Mission Row, Vespucci, Alta, Sandy Shore, Roxwood : données séparées
let db = { v: 1, states: {}, svs: {}, users: [], roles: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DBF, 'utf8')) }; }
catch (e) { // reprise d'une base venant de l'hébergement PHP (data/db.php)
  try { const t = fs.readFileSync(path.join(DATA, 'db.php'), 'utf8'), i = t.indexOf('?>'); db = { ...db, ...JSON.parse(i >= 0 ? t.slice(i + 2) : t) }; console.log('  Base importée depuis data/db.php'); } catch (x) {}
}
if (!db.roles.length) db.roles = defaultRoles(); // base neuve : rôles de départ
defaultRoles().filter(d => BUILTIN.includes(d.id)).forEach(d => { if (!db.roles.some(r => r.id === d.id)) db.roles.push(d); }); // rôles indispensables toujours présents
db.roles.forEach(r => { r.builtin = BUILTIN.includes(r.id); });
const pv0 = db.pv || 1;
if ((db.pv || 1) < 2) { // nouvelles permissions : on les accorde aux rôles qui avaient déjà l'accès équivalent
  db.roles.forEach(r => { if (r.admin) { r.perms = [...PERMS]; return; } r.perms = r.perms || [];
    if (r.perms.includes('hoursEdit')) r.perms.push('hoursImport', 'weekAdd');
    if ((r.tabs || []).includes('set')) r.perms.push('gradeEdit', 'actionEdit', 'sanctionEdit');
    r.perms = [...new Set(r.perms)]; });
  db.pv = 2;
}
if ((db.pv || 1) < 3) { // onglet Médailles + permissions médailles / Google Sheet
  db.roles.forEach(r => { if (r.admin) { r.perms = [...PERMS]; r.tabs = TABS.slice(0, 6); return; }
    if ((r.tabs || []).includes('sta')) r.tabs = [...new Set([...r.tabs, 'med'])];
    if ((r.perms || []).includes('cerEdit')) r.perms = [...new Set([...r.perms, 'medalEdit'])]; });
  db.pv = 3;
}
if ((db.pv || 1) < 4) { // districts : l'ancienne base unique devient celle de Sandy Shore ; comptes existants -> Sandy Shore
  db.states = db.states || {}; db.svs = db.svs || {};
  if ('state' in db) { if (db.state) { db.states.sandy = db.state; db.svs.sandy = db.sv || 0; } delete db.state; delete db.sv; }
  db.users.forEach(u => { if (!Array.isArray(u.districts)) u.districts = u.role === 'pending' ? [] : ['sandy']; });
  db.pv = 4;
}
const persist = () => { const t = DBF + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, DBF); };
const touch = () => { db.v++; persist(); };
if (db.pv !== pv0) persist(); // base mise au nouveau format : enregistrée tout de suite

// ---------- utilitaires ----------
const uid = () => crypto.randomBytes(6).toString('hex');
const b64 = s => Buffer.from(s).toString('base64url');
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const mkTok = (id, ttl) => { const p = b64(JSON.stringify({ u: id, e: Date.now() + ttl })); return p + '.' + sign(p); };
function readTok(t) {
  if (!t || !t.includes('.')) return null;
  const [p, s] = t.split('.'), e = sign(p);
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.e > Date.now() ? o : null; } catch (x) { return null; }
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim()).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const setCookie = (res, name, val, maxAge) => {
  const c = `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ''}${SECURE ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', [...(res.getHeader('Set-Cookie') || []), c]);
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 15e6) { req.destroy(); no(new Error('trop gros')); } });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } });
});
const setPwd = (u, pwd) => { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = crypto.scryptSync(pwd, u.salt, 64).toString('hex'); };
const checkPwd = (u, pwd) => { if (!u.hash) return false; const h = crypto.scryptSync(String(pwd), u.salt, 64); return crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex')); };

const roleOf = u => db.roles.find(r => r.id === u.role) || db.roles.find(r => r.id === 'pending'); // rôle supprimé : aucun accès
const isAdmin = u => !!roleOf(u).admin;
const canRead = u => { const r = roleOf(u); return !!r.admin || r.tabs.length > 0 || r.perms.length > 0; };
const canWrite = u => { const r = roleOf(u); return !!r.admin || r.perms.length > 0 || r.tabs.some(t => ['eff', 'hrs', 'imp', 'cer', 'set'].includes(t)); };
const canManage = u => isAdmin(u) || roleOf(u).perms.includes('usersManage');
const dOf = u => isAdmin(u) ? [...DISTRICTS] : (u.districts || []).filter(d => DISTRICTS.includes(d)); // districts accessibles
const pickD = (u, q) => { const L = dOf(u); return L.includes(q) ? q : L.find(d => db.states[d]) || L[0] || null; }; // sinon : 1er district qui a des données
const seesUser = (u, t) => isAdmin(u) || t.role === 'pending' || (t.districts || []).some(d => dOf(u).includes(d)); // un gestionnaire voit les comptes de ses districts
const pub = u => ({ id: u.id, name: u.name, role: u.role, districts: u.districts || [], discordId: u.discordId || '', dname: u.dname || '', dun: u.dun || '', avatar: u.avatar || null, created: u.created, hasPwd: !!u.hash });
const authed = req => { const t = readTok(cookies(req).sid); return t ? db.users.find(u => u.id === t.u) || null : null; };
const PWD = !(DC.id && DC.secret) || !!(C.passwordLogin || process.env.PASSWORD_LOGIN); // identifiant + mot de passe : seulement si Discord n'est pas configuré (ou secours activé)
const flags = () => ({ discord: !!(DC.id && DC.secret), redirect: REDIRECT, pwd: PWD });
const payload = (u, dq) => { const d = pickD(u, dq); return { ...flags(), v: db.v, d, districts: dOf(u), sv: d ? db.svs[d] || 0 : 0, me: pub(u), roles: db.roles, state: canRead(u) && d ? db.states[d] ?? null : undefined, users: canManage(u) ? db.users.filter(t => seesUser(u, t)).map(pub) : undefined }; };
const adminView = u => ({ v: db.v, users: db.users.filter(t => !u || seesUser(u, t)).map(pub), roles: db.roles });

const nameErr = n => typeof n !== 'string' || n.length < 2 || n.length > 32 ? 'L’identifiant doit faire entre 2 et 32 caractères.' : /\s/.test(n) ? 'Pas d’espace dans l’identifiant.' : db.users.some(u => u.name.toLowerCase() === n.toLowerCase()) ? 'Cet identifiant existe déjà.' : '';
const pwdErr = p => typeof p !== 'string' || p.length < 4 ? 'Le mot de passe doit faire au moins 4 caractères.' : '';
const didErr = (d, except) => d && !/^\d{15,22}$/.test(d) ? 'ID Discord invalide (un nombre de 17 à 19 chiffres).' : d && db.users.some(u => u.id !== except && u.discordId === d) ? 'Cet ID Discord est déjà associé à un compte.' : '';

function cleanRoles(inp) {
  if (!Array.isArray(inp) || inp.length > 60) return null;
  const out = [], names = new Set();
  for (const r of inp) {
    if (!r || typeof r.id !== 'string' || !/^[a-z0-9]{3,24}$/.test(r.id) || typeof r.name !== 'string') return null;
    const name = r.name.trim().slice(0, 40); if (!name || names.has(name.toLowerCase())) return null; names.add(name.toLowerCase());
    const adm = r.id === 'admin';
    out.push({ id: r.id, name, ...(adm ? { admin: true } : {}), builtin: BUILTIN.includes(r.id),
      tabs: adm ? TABS.slice(0, 6) : (Array.isArray(r.tabs) ? [...new Set(r.tabs.filter(t => TABS.includes(t)))] : []),
      perms: adm ? [...PERMS] : (Array.isArray(r.perms) ? [...new Set(r.perms.filter(p => PERMS.includes(p)))] : []) });
  }
  if (!BUILTIN.every(id => out.some(r => r.id === id))) return null;
  if (!db.users.every(u => out.some(r => r.id === u.role))) return null;
  return out;
}

// lien Google Sheets -> URL d'export CSV (seul docs.google.com est accepté)
function sheetUrl(link, gid) {
  const id = (String(link).match(/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/) || [])[1]; if (!id) return null;
  const g = gid || (String(link).match(/[#&?]gid=(\d+)/) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${g && /^\d+$/.test(g) ? '&gid=' + g : ''}`;
}

// ---------- connexions : limitation des essais ----------
const fails = new Map();
const tooMany = ip => { const f = fails.get(ip); return f && f.until > Date.now(); };
const fail = ip => { const f = fails.get(ip) || { n: 0, until: 0 }; if (++f.n >= 5) { f.until = Date.now() + 30000; f.n = 0; } fails.set(ip, f); };
const login = (res, u, remember) => setCookie(res, 'sid', mkTok(u.id, 30 * 864e5), remember ? 30 * 86400 : 0);

// ---------- API ----------
async function api(req, res, url, p) {
  let m = req.method; const u = authed(req), seg = p.split('/').filter(Boolean), ip = req.socket.remoteAddress;
  if (url.searchParams.has('_m')) m = url.searchParams.get('_m').toUpperCase();
  if (m === 'GET' && p === '/api/boot') return json(res, 200, u ? payload(u, url.searchParams.get('d')) : { ...flags(), me: null, firstRun: !db.users.length });
  if (!PWD && m === 'POST' && ['/api/setup', '/api/login'].includes(p)) return json(res, 403, { error: 'Connexion uniquement avec Discord.' });
  if (m === 'POST' && p === '/api/setup') {
    if (db.users.length) return json(res, 403, { error: 'Un compte existe déjà.' });
    const b = await readBody(req), name = String(b.name || '').trim(), err = nameErr(name) || pwdErr(b.password);
    if (err) return json(res, 400, { error: err });
    const nu = { id: uid(), name, role: 'admin', districts: [...DISTRICTS], created: Date.now() }; setPwd(nu, b.password); db.users.push(nu); touch(); login(res, nu, b.remember);
    return json(res, 200, payload(nu));
  }
  if (m === 'POST' && p === '/api/login') {
    if (tooMany(ip)) return json(res, 429, { error: 'Trop d’essais : réessaie dans quelques secondes.' });
    const b = await readBody(req), t = db.users.find(x => x.name.toLowerCase() === String(b.name || '').trim().toLowerCase());
    if (!t || !checkPwd(t, b.password)) { fail(ip); return json(res, 401, { error: 'Identifiant ou mot de passe incorrect' }); }
    fails.delete(ip); login(res, t, b.remember); return json(res, 200, payload(t));
  }
  if (m === 'POST' && p === '/api/logout') { setCookie(res, 'sid', '', -1); return json(res, 200, { ok: true }); }
  if (!u) return json(res, 401, { error: 'Non connecté' });

  if (m === 'GET' && p === '/api/sync') return json(res, 200, String(db.v) === url.searchParams.get('v') ? { same: true, v: db.v } : payload(u, url.searchParams.get('d')));
  if (m === 'PUT' && p === '/api/state') {
    if (!canWrite(u)) return json(res, 403, { error: 'Droits insuffisants' });
    const b = await readBody(req);
    if (!b.state || !Array.isArray(b.state.agents) || !Array.isArray(b.state.weeks)) return json(res, 400, { error: 'Données invalides' });
    const d = b.d; if (!dOf(u).includes(d)) return json(res, 403, { error: 'District non autorisé pour ton compte.' });
    if (b.base !== (db.svs[d] || 0)) return json(res, 409, { state: db.states[d] ?? null, sv: db.svs[d] || 0, v: db.v, d });
    db.states[d] = b.state; db.svs[d] = (db.svs[d] || 0) + 1; touch(); return json(res, 200, { sv: db.svs[d], v: db.v, d });
  }
  if (m === 'GET' && p === '/api/sheet') { // lecture d'un Google Sheet (CSV) côté serveur : pas de blocage CORS dans le navigateur
    if (!isAdmin(u) && !roleOf(u).perms.includes('sheetSync')) return json(res, 403, { error: 'Droits insuffisants' });
    const src = sheetUrl(url.searchParams.get('url') || '', url.searchParams.get('gid'));
    if (!src) return json(res, 400, { error: 'Lien Google Sheets invalide.' });
    try {
      const r = await fetch(src, { redirect: 'follow' }), t = await r.text();
      if (!r.ok || /^\s*<(!doctype|html)/i.test(t)) return json(res, 400, { error: `Google Sheets a refusé l’accès (HTTP ${r.status}) : le fichier doit être partagé « Tous les utilisateurs disposant du lien ».` });
      return json(res, 200, { csv: t });
    } catch (e) { return json(res, 502, { error: 'Google Sheets injoignable : ' + e.message }); }
  }
  if (m === 'POST' && p === '/api/me/password') {
    if (!PWD) return json(res, 403, { error: 'Connexion uniquement avec Discord : pas de mot de passe.' });
    const b = await readBody(req);
    if (u.hash && !checkPwd(u, b.old)) return json(res, 400, { error: 'Le mot de passe actuel est incorrect.' });
    const err = pwdErr(b.password); if (err) return json(res, 400, { error: err });
    setPwd(u, b.password); touch(); return json(res, 200, { ok: true });
  }

  // ----- comptes : administrateurs + rôles avec « Gérer comptes » (sans toucher aux administrateurs) ; rôles : administrateurs -----
  if (!canManage(u)) return json(res, 403, { error: 'Réservé aux administrateurs' });
  const adm = isAdmin(u), roleOk = id => db.roles.some(r => r.id === id && (adm || !r.admin));
  const mine = dOf(u), mergeD = (old, req) => [...new Set([...(old || []).filter(d => !mine.includes(d)), ...(Array.isArray(req) ? req : []).filter(d => mine.includes(d) && DISTRICTS.includes(d))])];
  if (m === 'POST' && p === '/api/users') {
    const b = await readBody(req), name = String(b.name || '').trim(), pwd = PWD ? b.password || '' : '', did = String(b.discordId || '').trim();
    if (!PWD && !did) return json(res, 400, { error: 'Connexion uniquement avec Discord : renseigne l’ID Discord du compte.' });
    const err = nameErr(name) || didErr(did) || (pwd || !did ? pwdErr(pwd) : '') || (roleOk(b.role) ? '' : 'Rôle inconnu ou non autorisé.');
    if (err) return json(res, 400, { error: err });
    const nu = { id: uid(), name, role: b.role, districts: mergeD([], b.districts), created: Date.now() }; if (did) nu.discordId = did; if (pwd) setPwd(nu, pwd);
    db.users.push(nu); touch(); return json(res, 200, adminView(u));
  }
  if (seg[1] === 'users' && seg[2]) {
    const t = db.users.find(x => x.id === seg[2]); if (!t || !seesUser(u, t)) return json(res, 404, { error: 'Compte introuvable' });
    const admins = () => db.users.filter(isAdmin).length;
    if (!adm && isAdmin(t)) return json(res, 403, { error: 'Seul un administrateur peut modifier un compte administrateur.' });
    if (m === 'PATCH' && seg.length === 3) {
      const b = await readBody(req);
      if ('role' in b) {
        const r = db.roles.find(x => x.id === b.role); if (!r || !roleOk(r.id)) return json(res, 400, { error: 'Rôle inconnu ou non autorisé.' });
        if (isAdmin(t) && !r.admin && admins() < 2) return json(res, 400, { error: 'Il doit rester au moins un administrateur.' });
        t.role = b.role;
      }
      if ('districts' in b) t.districts = mergeD(t.districts, b.districts);
      if ('discordId' in b) {
        const d = String(b.discordId || '').trim(), err = didErr(d, t.id) || (!d && (!t.hash || !PWD) ? 'Ce compte n’a pas de mot de passe : garde son ID Discord ou définis-lui un mot de passe.' : '');
        if (err) return json(res, 400, { error: err });
        if (d) t.discordId = d; else delete t.discordId;
      }
      touch(); return json(res, 200, adminView(u));
    }
    if (m === 'DELETE' && seg.length === 3) {
      if (t.id === u.id) return json(res, 400, { error: 'Tu ne peux pas supprimer ton propre compte.' });
      if (isAdmin(t) && admins() < 2) return json(res, 400, { error: 'Il doit rester au moins un administrateur.' });
      db.users = db.users.filter(x => x !== t); touch(); return json(res, 200, adminView(u));
    }
    if (m === 'POST' && seg[3] === 'password') {
      if (!PWD) return json(res, 403, { error: 'Connexion uniquement avec Discord : pas de mot de passe.' });
      const b = await readBody(req), err = pwdErr(b.password); if (err) return json(res, 400, { error: err });
      setPwd(t, b.password); touch(); return json(res, 200, adminView(u));
    }
  }
  if (m === 'PUT' && p === '/api/roles') {
    if (!adm) return json(res, 403, { error: 'Réservé aux administrateurs' });
    const b = await readBody(req), r = cleanRoles(b.roles); if (!r) return json(res, 400, { error: 'Rôles invalides (nom en double, rôle intégré manquant ou rôle encore utilisé).' });
    db.roles = r; touch(); return json(res, 200, adminView(u));
  }
  return json(res, 404, { error: 'Introuvable' });
}

// ---------- connexion Discord (OAuth2, flux « code » : le secret reste ici) ----------
function discordStart(req, res) {
  const go = loc => { res.writeHead(302, { Location: loc }); res.end(); };
  if (!DC.id || !DC.secret) return go('./?dc=conf');
  const st = crypto.randomBytes(16).toString('hex'); setCookie(res, 'dst', st, 600);
  go('https://discord.com/oauth2/authorize?' + new URLSearchParams({ client_id: DC.id, response_type: 'code', scope: 'identify', redirect_uri: REDIRECT, state: st }));
}
function upsertDiscord(pf) {
  let u = db.users.find(x => x.discordId === pf.id);
  if (!u) {
    let name = String(pf.global_name || pf.username || 'Discord').replace(/\s+/g, '_').slice(0, 28); if (name.length < 2) name = 'discord_' + pf.id.slice(-4);
    if (db.users.some(x => x.name.toLowerCase() === name.toLowerCase())) name += '#' + pf.id.slice(-4);
    u = { id: uid(), name, role: db.users.length ? 'pending' : 'admin', districts: db.users.length ? [] : [...DISTRICTS], discordId: pf.id, created: Date.now() }; db.users.push(u);
  }
  u.dname = pf.global_name || pf.username || ''; u.dun = pf.username || ''; u.avatar = pf.avatar || null; touch(); return u;
}
async function discordCb(req, res, url) {
  const back = c => { res.writeHead(302, { Location: './?dc=' + c }); res.end(); };
  const st = url.searchParams.get('state'), code = url.searchParams.get('code'), ck = cookies(req).dst; setCookie(res, 'dst', '', -1);
  if (!code) return back('denied');
  if (!st || st !== ck) return back('state');
  try {
    const tr = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DC.id, client_secret: DC.secret, grant_type: 'authorization_code', code, redirect_uri: REDIRECT }) });
    if (!tr.ok) return back('error');
    const tok = await tr.json(), pr = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `${tok.token_type} ${tok.access_token}` } });
    if (!pr.ok) return back('error');
    const u = upsertDiscord(await pr.json()); login(res, u, true); return back('ok');
  } catch (e) { console.error('Discord :', e.message); return back('error'); }
}

// ---------- fichiers du site ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
function serveStatic(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel = decodeURIComponent(p); if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const blocked = !file.startsWith(ROOT + path.sep) || /(^|[\\/])(data|node_modules|\.[^\\/]*)([\\/]|$)/.test(path.relative(ROOT, file)) || ['server.js', 'config.json', 'package.json'].includes(path.basename(file)) || !MIME[path.extname(file).toLowerCase()];
  if (blocked) { res.writeHead(404); return res.end('Introuvable'); }
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()], 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!FIXED && req.headers.host) { // adresse publique vue par le visiteur (ex. https://xxxx.trycloudflare.com)
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http', host = String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim();
      if (/^[\w.-]+(:\d+)?$/.test(host)) { const nb = `${proto === 'https' ? 'https' : 'http'}://${host}`; if (nb !== BASE && !/localhost|127\.0\.0\.1/.test(host)) console.log(`\n  Adresse publique : ${nb}\n  → URL de redirection à mettre dans le portail Discord : ${nb}/discord.php\n`); BASE = nb; REDIRECT = BASE + '/discord.php'; SECURE = BASE.startsWith('https'); }
    }
    const url = new URL(req.url, BASE), p = url.pathname;
    if (p === '/api.php') return await api(req, res, url, '/api/' + (url.searchParams.get('r') || '').replace(/^\/+/, ''));
    if (p === '/discord.php') return url.searchParams.has('code') || url.searchParams.has('error') ? await discordCb(req, res, url) : discordStart(req, res);
    if (p.startsWith('/api/')) return await api(req, res, url, p);
    if (p === '/auth/discord') return discordStart(req, res);
    if (p === '/auth/discord/callback') return await discordCb(req, res, url);
    return serveStatic(req, res, p);
  } catch (e) { console.error(e); if (!res.headersSent) json(res, 500, { error: 'Erreur serveur' }); }
});
module.exports = { server, db: () => db, start: (port = PORT) => new Promise(ok => server.listen(port, ok)) };
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  SAMP · District de Sandy Shore\n  Site local  : http://localhost:${PORT}\n  Adresse     : ${FIXED || 'détectée automatiquement (tunnel Cloudflare, réseau local…)'}\n  Données     : ${DATA}\n  Discord     : ${DC.id && DC.secret ? 'configuré' : 'non configuré (renseigne config.json)'}\n`);
  });
}
