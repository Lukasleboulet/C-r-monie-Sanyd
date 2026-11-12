// ====== SAMP · District de Sandy Shore : suivi des heures & cérémonies (site + serveur Node.js : comptes, rôles et données partagés) ======
const DEFAULT_GRADES = ['Capitaine','Lieutenant-Chef','Lieutenant','Sergent-2','Sergent-1','SLO','Officier-3','Officier-2','Officier','Rookie']; // du plus haut au plus bas
const RIB_COLORS = ['#4f8ad8', '#3dbb7a', '#e0b23a', '#e0733a', '#c9473f', '#8e5bd6'];
const defaultMedals = () => [2, 4, 6, 8, 10, 12].map((m, i) => ({ id: 'rub' + m, name: `Ruban de service — ${m} mois`, n: m, u: 'm', color: RIB_COLORS[i], img: '' }));
const DEFAULT_ACTIONS = [{ id: 'promo', label: 'Montée', mv: -1 }, { id: 'retro', label: 'Rétrogradation', mv: 1 }]; // mv : décalage dans la hiérarchie (-1 monte, 1 descend, 0 = aucun)
const DEFAULT_SANCTIONS = ['Avertissement', 'Blâme', 'Mise à pied']; // modifiables par l'admin (Paramètres)
const KEY = 'samp-sandy-shore-v1'; // clé propre à ce site (ne pas partager avec le site Vespucci)
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const F = m => m == null ? '–' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
const BAR_MAX = 3000; // barres d’heures : pleines à 50h (3000 min)
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function tparse(line, loose) { // "43h30min", "43:30", "43.5" -> minutes
  const hm = [...line.matchAll(/(\d+)h(\d{1,2})?(?:min)?(?![a-z])/gi)];
  if (hm.length) { const x = hm.at(-1); return +x[1] * 60 + (+x[2] || 0); }
  const c = [...line.matchAll(/(\d+):(\d{2})/g)];
  if (c.length) { const x = c.at(-1); return +x[1] * 60 + +x[2]; }
  const d = loose ? line.trim().match(/^(\d+(?:[.,]\d+)?)$/) : line.match(/[\t;,]\s*(\d+(?:[.,]\d+)?)\s*$/);
  return d ? Math.round(parseFloat(d[1].replace(',', '.')) * 60) : null;
}

// ---------- état ----------
function thisMonday() { // 1re semaine d'une base vide : le lundi de la semaine en cours (jj/mm)
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}
function seed() {
  return {
    weeks: SEED.weeks.length ? [...SEED.weeks] : [thisMonday()],
    agents: SEED.rows.map(([mat, nom, prenom, grade, w]) => ({ id: uid(), mat, nom, prenom, grade, w })),
    grades: [...DEFAULT_GRADES], gcol: {}, sanctions: [...DEFAULT_SANCTIONS], actions: DEFAULT_ACTIONS.map(x => ({ ...x })),
    ceremonies: {} // { "19/10": { agentId: {a: id de l’option, from, g, r, done} } }
  };
}
// Semaines « jj/mm » sans année : on déduit l'année (une date à plus de 2 semaines dans le futur = année précédente) pour les classer par date.
function weekKey(w) { const [d, m] = String(w).split('/').map(Number), n = new Date(); let y = n.getFullYear(); if (new Date(y, m - 1, d) - n > 14 * 864e5) y--; return y * 10000 + m * 100 + d; }
function sortWeeks(d) { // remet les semaines dans l'ordre chronologique, avec les heures et les références qui en dépendent
  const p = d.weeks.map((w, i) => i).sort((a, b) => weekKey(d.weeks[a]) - weekKey(d.weeks[b]) || a - b);
  if (p.every((x, i) => x === i)) return false;
  const inv = []; p.forEach((o, n) => inv[o] = n);
  d.weeks = p.map(i => d.weeks[i]);
  d.agents.forEach(a => { a.w = p.map(i => a.w[i] ?? null); if (a.arch && a.arch.w != null) a.arch.w = inv[a.arch.w] ?? a.arch.w; });
  (d.glog || []).forEach(g => { if (g.w != null && inv[g.w] != null) g.w = inv[g.w]; });
  return true;
}
function migrate(d) { // le grade « Rookie-PPA » n'existe pas : fusionné dans « Rookie »
  const fix = g => g === 'Rookie-PPA' ? 'Rookie' : g;
  d.agents.forEach(a => a.grade = fix(a.grade));
  Object.values(d.ceremonies || {}).forEach(c => Object.values(c).forEach(x => { x.from = fix(x.from); x.g = fix(x.g); }));
  d.grades = [...new Set((d.grades || DEFAULT_GRADES).map(fix))];
  d.agents.forEach(a => { if (!d.grades.includes(a.grade)) d.grades.push(a.grade); });
  d.actions ||= DEFAULT_ACTIONS.map(x => ({ ...x }));
  d.gcol ||= {};
  d.glog ||= [];
  d.medals ||= defaultMedals();
  d.medals.forEach(m => { if (m.months && !m.n) { m.n = m.months; m.u = 'm'; } delete m.months; }); // ancienneté : nombre + unité (j, s, m, a) d.awards ||= {}; d.sheet ||= { url: '', gid: '', district: 'Sandy Shore', gmap: {}, last: 0 };
  sortWeeks(d);
  d.ignRanks ||= ['Patron', 'Sheriff']; // rangs ignorés à l'import et masqués (sauf agents ajoutés à la main)
  d.sanctions ||= [...DEFAULT_SANCTIONS];
  Object.values(d.ceremonies || {}).forEach(c => Object.values(c).forEach(x => ['fps', 'f1020', 'fus', 'abs'].forEach(k => { if (k in x && typeof x[k] !== 'boolean') x[k] = !!x[k] && x[k] !== 'Non'; })));
  return d;
}
let S = migrate(seed()); // remplacé par les données du serveur après la connexion
let admin = false, me = null; // admin = compte au rôle « Administrateur »
let tab = 'eff', cw = null, hw = null, hall = false, flt = { q: '', g: '' };

const gi = g => { const i = S.grades.indexOf(g); return i < 0 ? 99 : i; };
const gradeColor = g => { const i = S.grades.indexOf(g); return S.gcol?.[g] || (i >= 0 && i <= 2 ? '#f5b81c' : i >= 0 && i <= 5 ? '#9fb36a' : '#b8a47c'); };
const badge = g => { const c = gradeColor(g); return `<span class="bdg" style="--c:${c}">${esc(g)}</span>`; };
const sym = x => x.to !== undefined ? '◆' : x.mv < 0 ? '▲' : x.mv > 0 ? '▼' : '•';
const effOpts = sel => [['-2', 'Monte de 2 grades'], ['-1', 'Monte d’un grade'], ['0', 'Aucun changement de grade'], ['1', 'Descend d’un grade'], ['2', 'Descend de 2 grades'], ['fix', 'Passe à un grade précis…']].map(([v, t]) => `<option value="${v}" ${v === String(sel) ? 'selected' : ''}>${t}</option>`).join('');
const full = a => `${a.prenom} ${a.nom}`.trim();
const tot = a => a.w.reduce((x, y) => x + (y || 0), 0);
const ignR = g => (S.ignRanks || []).some(x => norm(x) === norm(g || ''));
const hiddenA = a => !a.man && ignR(a.grade); // rang masqué (Patron, Sheriff…) et agent non ajouté à la main
const actv = () => S.agents.filter(a => !a.arch && !hiddenA(a)); // agents en service (hors archivés et rangs masqués)
const byGrade = L => [...L].sort((a, b) => gi(a.grade) - gi(b.grade) || a.nom.localeCompare(b.nom));
const sorted = () => byGrade(actv());
const gopts = sel => [...new Set([...S.grades, ...S.agents.map(a => a.grade)])].map(g => `<option ${g === sel ? 'selected' : ''}>${esc(g)}</option>`).join('');
const wopts = sel => S.weeks.map((w, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>Semaine du ${w}</option>`).join('');

// ---------- vues ----------
const archDate = a => new Date(a.arch.t).toLocaleDateString('fr-FR');
function archHtml() {
  const q = norm(flt.q), L = byGrade(S.agents.filter(a => a.arch)).filter(a => (!flt.g || a.grade === flt.g) && (!q || norm(full(a) + ' ' + a.mat).includes(q)));
  return `<div class="wrapt"><table><thead><tr><th>Matricule</th><th>Agent</th><th>Grade</th><th>Archivé le</th><th>Raison</th><th>Total heures</th><th></th></tr></thead><tbody>` +
    L.map(a => `<tr class="arch"><td class="mono">${esc(a.mat)}</td><td><span class="av">${esc(initials(a))}</span>${esc(full(a))}</td><td>${badge(a.grade)}</td><td>${archDate(a)}${a.arch.w != null && S.weeks[a.arch.w] ? ` <span class="note">(sem. du ${S.weeks[a.arch.w]})</span>` : ''}</td><td>${esc(a.arch.why || '—')}</td><td class="hcell">${F(tot(a))}</td><td class="acts">${can('agentDel') ? `<button class="btn ghost" data-a="unarch" data-id="${a.id}">Réintégrer</button><button class="btn del" data-a="del" data-id="${a.id}">Supprimer</button>` : ''}</td></tr>`).join('') +
    `</tbody></table></div>` + (L.length ? '<p class="note">Les agents archivés n’apparaissent plus dans les heures, la cérémonie ni les totaux, mais leurs statistiques restent consultables (onglet Statistiques › « Archivés »).</p>' : '<p class="note">Aucun agent archivé.</p>');
}
function listHtml() {
  if (flt.arch) return archHtml();
  const q = norm(flt.q), wi = flt.w ?? S.weeks.length - 1;
  const L = sorted().filter(a => (!flt.g || a.grade === flt.g) && (!q || norm(full(a) + ' ' + a.mat).includes(q)));
  return `<div class="wrapt"><table><thead><tr><th>Matricule</th><th>Agent</th><th>Grade</th><th>Heures (semaine du ${S.weeks[wi]})</th><th></th></tr></thead><tbody>` +
    L.map(a => `<tr><td class="mono">${can('agentEdit') ? `<input class="ein" data-a="emat" data-id="${a.id}" value="${esc(a.mat)}">` : esc(a.mat)}</td><td>${can('agentEdit') ? `<input class="ein" data-a="epre" data-id="${a.id}" value="${esc(a.prenom)}" placeholder="Prénom"> <input class="ein" data-a="enom" data-id="${a.id}" value="${esc(a.nom)}" placeholder="Nom">` : `<span class="av">${esc(((a.prenom || '')[0] || '') + ((a.nom || '')[0] || ''))}</span>${esc(full(a))}`}</td><td>${can('agentEdit') ? `<select class="ein" data-a="egr" data-id="${a.id}">${gopts(a.grade)}</select>` : badge(a.grade)}</td><td class="hcell">${F(a.w[wi])}<span class="mini"><i style="width:${Math.min(100, (a.w[wi] || 0) / BAR_MAX * 100)}%"></i></span></td><td>${can('agentDel') ? `<button class="btn ghost" data-a="arch" data-id="${a.id}" title="Retirer de l’effectif en gardant ses statistiques">Archiver</button>` : ''}</td></tr>`).join('') +
    `</tbody></table></div>` + (L.length ? '' : '<p class="note">Aucun agent.</p>');
}
function vEff() {
  return (can('agentAdd') ? `<section class="panel"><h2>Créer un agent</h2><div class="frm">
    <input id="n-mat" placeholder="Matricule"><input id="n-pre" placeholder="Prénom"><input id="n-nom" placeholder="Nom">
    <select id="n-gr">${gopts([...S.grades].reverse().find(g => !ignR(g)) || S.grades.at(-1))}</select><button class="btn gold" data-a="add">Ajouter</button></div></section>` : '') + `
    <div class="frm"><input id="q" placeholder="Rechercher (nom, matricule)…" value="${esc(flt.q)}">
    <select id="fg"><option value="">Tous les grades</option>${gopts(flt.g)}</select><select id="ew">${wopts(flt.w ?? S.weeks.length - 1)}</select><span class="note">${actv().length} agents</span>${S.agents.some(a => a.arch) || flt.arch ? `<button class="btn ghost${flt.arch ? ' on' : ''}" data-a="sharch">${flt.arch ? '← Effectif en service' : `Archivés (${S.agents.filter(a => a.arch).length})`}</button>` : ''}</div>
    <div id="list">${listHtml()}</div>`;
}
let hq = '', hg = ''; // recherche / filtre de grade de l'onglet Heures
const minM = () => Math.round((S.minH ?? 10) * 60); // minimum d'heures par semaine (minutes)
function hRow(a) { // une ligne de la vue « par semaine »
  const v = a.w[hw], p = hw > 0 ? a.w[hw - 1] : null, mn = minM(), low = v != null && v < mn, d = v != null && p != null ? v - p : null;
  return `<tr class="hr${low ? ' low' : ''}${v == null ? ' empty' : ''}" data-row="${a.id}" style="--c:${gradeColor(a.grade)}"><td><div class="hag"><span class="av">${esc(initials(a))}</span><span><b>${esc(full(a))}</b>${a.mat && a.mat !== '-' ? `<small class="mono">${esc(a.mat)}</small>` : ''}</span></div></td><td>${badge(a.grade)}</td>
    <td class="hcell hprev">${F(p)}</td><td><input class="hin" data-a="hin" data-id="${a.id}" value="${v == null ? '' : F(v)}" placeholder="—" ${can('hoursEdit') ? '' : 'readonly'}></td>
    <td><div class="hbar" title="Objectif ${F(mn)} · barre pleine à ${F(BAR_MAX)}"><i style="width:${Math.min(100, (v || 0) / BAR_MAX * 100)}%"></i><em style="left:${Math.min(100, mn / BAR_MAX * 100)}%"></em></div></td>
    <td class="hcell hd ${d == null ? '' : d >= 0 ? 'pos' : 'neg'}">${d == null ? '—' : Fd(d)}</td></tr>`;
}
function hStats() {
  const all = actv(), mn = minM(), vals = all.map(a => a.w[hw]), f = vals.filter(x => x != null), t = f.reduce((x, y) => x + y, 0), act = f.filter(x => x > 0).length;
  const pt = hw > 0 ? all.reduce((x, a) => x + (a.w[hw - 1] || 0), 0) : null;
  return { t, pt, act, avg: act ? t / act : 0, low: f.filter(x => x < mn).length, empty: vals.length - f.length, n: all.length };
}
function hCards() {
  const s = hStats(), d = s.pt == null ? null : s.t - s.pt;
  const card = (l, v, sub, cls = '') => `<div class="sk ${cls}"><span>${l}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  return card('Total de la semaine', F(s.t), d == null ? '' : `<i class="${d >= 0 ? 'pos' : 'neg'}">${Fd(d)}</i> vs semaine préc.`, 'hi') + card('Moyenne / agent actif', F(Math.round(s.avg)), `${s.act} agent(s) actif(s)`) +
    card(`Sous le minimum (${F(minM())})`, s.low, 'heures saisies insuffisantes', s.low ? 'down' : '') + card('Non renseignés', s.empty, `sur ${s.n} agent(s)`, s.empty ? 'warn' : '');
}
function vHrs() {
  if (hw == null || hw >= S.weeks.length) hw = S.weeks.length - 1;
  const seg = `<div class="segs"><button class="seg${hall ? '' : ' on'}" data-a="hmode" data-v="0">Par semaine</button><button class="seg${hall ? ' on' : ''}" data-a="hmode" data-v="1">Toutes les semaines</button></div>`;
  const filt = `<input id="hq" placeholder="Rechercher un agent…" value="${esc(hq)}" style="flex:1;min-width:180px"><select id="hg"><option value="">Tous les grades</option>${gopts(hg)}</select>`;
  const L = sorted().filter(a => (!hg || a.grade === hg) && (!hq || norm(full(a) + ' ' + a.mat).includes(norm(hq))));
  if (hall) return `<div class="frm htool">${seg}${filt}</div><p class="note">${can('hoursEdit') ? 'Clique sur une case pour modifier les heures.' : 'Lecture seule : ton rôle ne permet pas de modifier les heures.'}</p><div class="wrapt g"><table><thead><tr><th>Agent</th>${S.weeks.map(w => `<th>${w}</th>`).join('')}<th>Total</th></tr></thead><tbody>` +
    L.map(a => `<tr><td>${esc(full(a))}<small>${esc(a.mat)} · ${esc(a.grade)}</small></td>` +
      S.weeks.map((_, j) => `<td class="c${can('hoursEdit') ? '' : ' ro'}${a.w[j] != null && a.w[j] < minM() ? ' lowc' : ''}" ${can('hoursEdit') ? 'data-a="cell"' : ''} data-id="${a.id}" data-j="${j}" style="background:rgba(232,135,58,${a.w[j] == null ? 0 : Math.min(.55, a.w[j] / 5400)})">${F(a.w[j])}</td>`).join('') +
      `<td><b>${F(tot(a))}</b></td></tr>`).join('') + `</tbody></table></div>`;
  return `<div class="frm htool"><div class="wnav"><button class="btn ghost" data-a="hprev" ${hw > 0 ? '' : 'disabled'} title="Semaine précédente">◀</button><select id="hw">${wopts(hw)}</select><button class="btn ghost" data-a="hnext" ${hw < S.weeks.length - 1 ? '' : 'disabled'} title="Semaine suivante">▶</button></div>${seg}${filt}
    <label class="hmin" title="Minimum d’heures par semaine">Minimum <input data-a="hmin" type="number" min="0" step="0.5" value="${S.minH ?? 10}" ${can('hoursEdit') ? '' : 'disabled'}> h</label></div>
    <div class="skg hcards" id="hcards">${hCards()}</div>
    <p class="note">Semaine du <b>${S.weeks[hw]}</b>${hw > 0 ? ` · semaine précédente : ${S.weeks[hw - 1]}` : ''} · saisis les heures (12h30, 12:30 ou 12.5) puis Entrée ou Tab.</p>
    <div class="wrapt"><table class="htab"><thead><tr><th>Agent</th><th>Grade</th><th>Sem. préc.</th><th>Heures</th><th title="Le trait vertical marque le minimum">Progression</th><th>Écart</th></tr></thead><tbody>` +
    L.map(hRow).join('') + `</tbody></table></div>${L.length ? '' : '<p class="note">Aucun agent.</p>'}`;
}
function vImp() {
  if (!can('hoursImport')) return '<section class="panel"><h2>Importer des heures</h2><p class="note">Lecture seule : ton rôle ne permet pas d’importer des heures.</p></section>';
  return `<section class="panel"><h2>Importer des heures</h2>
  <p class="note">Colle directement ton tableau (colonnes <code>Nom ⇥ Rang ⇥ Part employé ⇥ Heures</code>, l’en-tête et la ligne TOTAL sont ignorés ; la part employé n’est pas utilisée), ou des lignes du type <code>Prénom Nom 43h30min</code>. Les agents sont reconnus par « Prénom Nom ».</p>
  <div class="frm"><select id="iw">${wopts(S.weeks.length - 1)}</select>${can('weekAdd') ? '<button class="btn ghost" data-a="week">+ Nouvelle semaine</button>' : ''}
  <label class="note"><input type="checkbox" id="ic" style="flex:none;min-width:0"> Créer les agents inconnus (avec leur rang)</label>
  <label class="note"><input type="checkbox" id="ig" style="flex:none;min-width:0"> Mettre à jour les grades depuis la colonne Rang</label>
  ${can('gradeEdit') ? '<label class="note"><input type="checkbox" id="icg" style="flex:none;min-width:0"> Créer les grades inconnus</label>' : ''}</div>
  <textarea id="it" placeholder="Rayan Sef&#9;Patron&#9;0&#9;3h50min&#10;Paul Pinoto&#9;Patron&#9;0&#9;14h26min"></textarea>
  <div class="frm" style="margin-top:8px"><button class="btn gold" data-a="import">Importer</button></div><div id="ir" class="note"></div></section>`;
}
const INFO = [['casiers', 'Nb Casiers', 'num'], ['sanction', 'Sanction', 'sel'], ['fps', 'Forma PS', 'chk'], ['f1020', 'Forma 10-20', 'chk'], ['fus', 'Fusillade / PPA L (slo)', 'chk'], ['abs', 'Absence', 'chk']];
function infoCell(a, d, [k, , t], dis) {
  const v = d[k], at = `data-a="inf" data-id="${a.id}" data-k="${k}"${dis ? ' disabled' : ''}`;
  if (t === 'chk') return `<td class="ck"><label class="chk"><input type="checkbox" ${at} ${v ? 'checked' : ''}><span></span></label></td>`;
  if (t === 'sel') { const L = [...S.sanctions]; if (v && !L.includes(v)) L.push(v); return `<td><select class="cin" ${at}><option value="">—</option>${L.map(o => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td>`; }
  return `<td><input class="cin" type="number" min="0" ${at} value="${esc(v ?? '')}"></td>`;
}
function vCer() {
  if (cw == null || cw >= S.weeks.length) cw = S.weeks.length - 1;
  const j = cw, wk = S.weeks[j], w1 = j > 0 ? S.weeks[j - 1] : '—', D = S.ceremonies[wk] || {};
  const rows = sorted().map(a => {
    const h1 = j > 0 ? a.w[j - 1] : null, h2 = a.w[j], d = D[a.id] || {}, on = !!d.a, lock = !can('cerEdit') || (d.done && !can('cerEditDone'));
    const gi0 = S.grades.indexOf(d.done ? d.from : a.grade), gk = S.grades.indexOf(d.g || ''), cls = !on ? '' : gk < 0 || gk === gi0 ? 'dec' : gk < gi0 ? 'up' : 'down';
    return `<tr class="${cls}"><td><div class="nm"><span>${esc(a.prenom)} <b>${esc((a.nom || '').toUpperCase())}</b></span>${badge(d.done ? d.from : a.grade)}</div></td><td class="mono">${esc(a.mat)}</td>
    <td><div class="stk"><select class="cin" data-a="act" data-id="${a.id}" ${lock ? 'disabled' : ''}><option value="">Décision</option>${S.actions.map(x => `<option value="${x.id}" ${d.a === x.id ? 'selected' : ''}>${sym(x)} ${esc(x.label)}</option>`).join('')}</select>
    <select class="cin" data-a="ng" data-id="${a.id}" title="Nouveau grade" ${lock ? 'disabled' : ''}>${gopts(on ? d.g || a.grade : a.grade)}</select></div></td>
    <td>${F(h1)}</td><td>${F(h2)}</td><td><b>${F(Math.round(((h1 || 0) + (h2 || 0)) / 2))}</b></td>
    ${INFO.map(i => infoCell(a, d, i, !can('cerEdit'))).join('')}
    <td><input class="cin" data-a="why" data-id="${a.id}" value="${esc(d.r || '')}" placeholder="Explication" ${lock ? 'disabled' : ''}></td>
    <td><input class="cin" data-a="inf" data-id="${a.id}" data-k="notes" placeholder="Notes" value="${esc(d.notes || '')}" ${can('cerEdit') ? '' : 'disabled'}></td></tr>`;
  }).join('');
  return `<section class="panel"><h2>Cérémonie</h2><div class="frm"><select id="cw">${wopts(j)}</select>
  <span class="note">S-1 = semaine du ${w1} · S-2 = semaine du ${wk} · Moyenne = (S-1 + S-2) ÷ 2 · Choisis une décision, ou directement un nouveau grade.</span></div></section>
  <div class="wrapt cerw"><table class="cer"><thead><tr><th rowspan="2">Prénom NOM</th><th rowspan="2">Matricule</th><th rowspan="2">Promotion</th><th colspan="3" class="h">Nombre d’heures par semaine</th><th colspan="6" class="i">Informations</th><th rowspan="2" class="e">Explication décision</th><th rowspan="2" class="n">Notes CS</th></tr>
  <tr class="r2"><th class="h">S-1<small>${w1}</small></th><th class="h">S-2<small>${wk}</small></th><th class="h">Moyenne</th>${INFO.map(i => `<th class="i">${i[1]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
  <section class="panel" style="margin-top:14px"><h2>Récapitulatif</h2><pre id="rc">${esc(recap())}</pre>
  <div class="frm noprint"><button class="btn gold" data-a="copy">Copier</button>
  ${can('cerValidate') ? '<button class="btn" data-a="apply">Valider : appliquer les changements de grade</button>' : ''}</div></section>`;
}
function recap() {
  const D = S.ceremonies[S.weeks[cw]] || {}, L = actv().filter(a => D[a.id]?.a);
  const blocks = S.actions.map(x => {
    const r = L.filter(a => D[a.id].a === x.id).map(a => `• ${full(a)} (${a.mat}) : ${D[a.id].from || a.grade} → ${D[a.id].g || a.grade} — ${D[a.id].r || 'sans raison'}`);
    return r.length ? `${sym(x)} ${x.label.toUpperCase()}\n${r.join('\n')}` : '';
  }).filter(Boolean);
  return `SAMP — DISTRICT DE SANDY SHORE\nCÉRÉMONIE — SEMAINE DU ${S.weeks[cw]}\n\n` + (blocks.join('\n\n') || 'Aucune décision.');
}
const lockFs = (perm, html) => can(perm) ? html : `<fieldset class="ro" disabled title="Ton rôle ne permet pas de modifier cette section">${html}</fieldset>`;
const mgr = () => admin || can('usersManage'); // gestion des comptes (non administrateurs)
function vSet() {
  return `<section class="panel"><h2>Grades (du plus haut au plus bas)</h2>${can('gradeEdit') ? '' : '<p class="note">Lecture seule.</p>'}` + lockFs('gradeEdit', 
    S.grades.map((g, i) => `<div class="frm srow gr"><button class="btn ghost" data-a="gup" data-i="${i}" ${i ? '' : 'disabled'}>▲</button><button class="btn ghost" data-a="gdn" data-i="${i}" ${i < S.grades.length - 1 ? '' : 'disabled'}>▼</button><input data-a="gname" data-i="${i}" value="${esc(g)}"><input type="color" class="col" data-a="gcol" data-i="${i}" value="${gradeColor(g)}" title="Couleur du grade"><button class="btn ghost" data-a="gcolr" data-i="${i}" title="Couleur par défaut">↺</button><span class="note">${S.agents.filter(a => a.grade === g).length} agent(s)</span><button class="btn del" data-a="gdel" data-i="${i}">Retirer</button></div>`).join('') +
    `<div class="frm"><input id="gn" placeholder="Nouveau grade (ajouté en bas, puis déplace-le avec ▲)"><button class="btn gold" data-a="gadd">Ajouter</button></div>`) + `</section>
  <section class="panel"><h2>Rangs masqués</h2><p class="note">Les lignes de ces rangs sont ignorées à l’import (heures, création d’agent et de grade) et les agents de ces rangs n’apparaissent nulle part — sauf ceux que tu as ajoutés toi-même dans Effectifs. ${(() => { const n = S.agents.filter(hiddenA).length; return n ? `<b>${n}</b> agent(s) actuellement masqué(s).` : ''; })()}</p>` + lockFs('gradeEdit',
    `<div class="frm">${(S.ignRanks || []).map((x, i) => `<span class="tag">${esc(x)} <button class="btn del mini-b" data-a="irdel" data-i="${i}" title="Ne plus masquer">✕</button></span>`).join('') || '<span class="note">Aucun rang masqué.</span>'}</div>
    <div class="frm"><input id="irn" placeholder="Rang à masquer (ex : Patron)"><button class="btn gold" data-a="iradd">Ajouter</button></div>`) + `</section>
  <section class="panel"><h2>Options de décision (cérémonie)</h2><p class="note">Chaque option peut monter ou descendre d’un ou deux grades, ne rien changer, ou envoyer vers un grade précis (ex : Passe à SLO). Dans la cérémonie, le nouveau grade reste modifiable.</p>` + lockFs('actionEdit',
    S.actions.map((x, i) => `<div class="frm srow ac">${mvBtns('a', i, S.actions.length)}<input data-a="aname" data-id="${x.id}" value="${esc(x.label)}"><select data-a="aeff" data-id="${x.id}">${effOpts(x.to !== undefined ? 'fix' : x.mv)}</select>${x.to !== undefined ? `<select data-a="ato" data-id="${x.id}">${gopts(x.to)}</select>` : '<span></span>'}<button class="btn del" data-a="adel" data-id="${x.id}">Retirer</button></div>`).join('') +
    `<div class="frm"><input id="an2" placeholder="Nouvelle option"><select id="ae">${effOpts(0)}</select><select id="at" hidden>${gopts(S.grades[0])}</select><button class="btn gold" data-a="aadd">Ajouter</button></div>`) + `</section>
  <section class="panel"><h2>Sanctions (menu déroulant de la cérémonie)</h2>` + lockFs('sanctionEdit',
    S.sanctions.map((x, i) => `<div class="frm srow sa">${mvBtns('s', i, S.sanctions.length)}<input data-a="sname" data-i="${i}" value="${esc(x)}"><button class="btn del" data-a="sdel" data-i="${i}">Retirer</button></div>`).join('') +
    `<div class="frm"><input id="sn" placeholder="Nouvelle sanction (ex : Mise à pied 48h)"><button class="btn gold" data-a="sadd">Ajouter</button></div>`) + `</section>`;
}
function vAcc() { // Administration › Accès & comptes : demandes d'accès, comptes, rôles et permissions
  return usersPanel() + (admin ? rolesPanel() : '');
}

const views = { eff: vEff, hrs: vHrs, imp: vImp, cer: vCer, set: vSet, sta: vSta, med: vMedMain, acc: vAcc, mda: vMda };
const TITLES = { eff: 'Effectifs', hrs: 'Heures de service', imp: 'Importer des heures', cer: 'Cérémonie', set: 'Personnalisation', sta: 'Statistiques agent', med: 'Médailles & rubans', acc: 'Accès & comptes', mda: 'Gestion des médailles' };
const TSUB = { eff: 'Liste des agents du district, grades et matricules', hrs: 'Saisie et suivi des heures de service semaine par semaine', imp: 'Import en masse des heures depuis ta feuille', cer: 'Décisions, sanctions et notes de la cérémonie', set: 'Grades, options de décision, sanctions et rangs masqués', sta: 'Heures, grades, sanctions et historique de chaque agent depuis le début', med: 'Rubans de service à remettre et médailles des agents', acc: 'Demandes d’accès, comptes utilisateurs, rôles et permissions', mda: 'Catalogue des médailles et rubans, synchronisation avec le Google Sheet' };
const TICON = { eff: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.8 0 4.5 1.9 4.5 4.5"/>', hrs: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', imp: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 20h16"/>', cer: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>', sta: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>', med: '<path d="M8 2h8l-2.5 7h-3z"/><circle cx="12" cy="15" r="6"/><path d="m12 12 .9 1.9 2.1.3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.4 2.1-.3z"/>', acc: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', mda: '<path d="M8 2h8l-2.5 7h-3z"/><circle cx="12" cy="15" r="6"/><path d="M12 12v6M9 15h6"/>' };
function render() {
  if (!canTab(tab)) tab = TABS.find(canTab) || null; // onglet non autorisé -> 1er onglet accessible
  document.querySelectorAll('#nav button[data-t]').forEach(b => { b.hidden = !canTab(b.dataset.t); b.classList.toggle('on', b.dataset.t === tab); });
  $('#gadm').hidden = ['set', 'acc', 'mda'].every(t => $(`#nav [data-t="${t}"]`).hidden);
  $('#pt').textContent = tab ? TITLES[tab] : 'Accès restreint';
  $('#psub').textContent = tab ? (tab === 'eff' ? `${actv().length} agent(s) en service · ` : '') + TSUB[tab] : 'Aucun onglet n’est autorisé pour ton rôle.';
  $('#pic').innerHTML = tab ? `<svg viewBox="0 0 24 24">${TICON[tab]}</svg>` : '';
  setKpi();
  $('#view').innerHTML = tab ? views[tab]() : me?.role === 'pending'
    ? `<section class="panel"><h2>Compte en attente de validation</h2><p class="note">Tu es connecté avec Discord, mais aucun rôle ne t’a encore été attribué. Communique ton ID Discord à un administrateur : <b class="mono">${esc(me.discordId || '')}</b></p></section>`
    : '<section class="panel"><h2>Aucun accès</h2><p class="note">Ton rôle n’a accès à aucun onglet. Demande à un administrateur de modifier tes accès.</p></section>';
  { const pend = mgr() ? users.filter(u => u.role === 'pending').length : 0, sb = $('#nav [data-t="acc"]'); if (pend) sb.dataset.n = pend; else delete sb.dataset.n; }
  if (me) { $('#un').textContent = me.name; $('#ur').textContent = roleOf(me).name; { const dp = me.dname ? (me.dun ? '@' + me.dun : me.dname) : ''; $('#ud').textContent = dp; $('#ud').hidden = !dp; } { const av = me.discordId && me.avatar ? `https://cdn.discordapp.com/avatars/${me.discordId}/${me.avatar}.png?size=64` : ''; $('#uav').style.backgroundImage = av ? `url(${av})` : ''; $('#uav').textContent = av ? '' : me.name.slice(0, 2); } $('#ucard').classList.toggle('adm', admin); $('#rn').textContent = roleOf(me).name; $('#rl').textContent = admin ? 'accès total' : `${roleOf(me).tabs.length} onglet(s) · ${(roleOf(me).perms || []).length} permission(s)`; }
  setTopH();
  $('#pw').hidden = !pwdOn;
  $('#bk').hidden = !can('dataBackup'); $('#rz').hidden = $('#rs').parentElement.hidden = !can('dataReset');
}
function setKpi() {
  const kw = [...S.weeks.keys()].reverse().find(j => actv().some(a => a.w[j] > 0)) ?? S.weeks.length - 1;
  const hs = actv().map(a => a.w[kw]).filter(x => x != null), act = hs.filter(x => x > 0), tt = hs.reduce((x, y) => x + y, 0);
  $('#kpi').innerHTML = !tab ? '' : [[actv().length, 'Agents'], [F(tt), `Heures · sem. du ${S.weeks[kw]}`], [act.length, 'Agents actifs'], [F(act.length ? Math.round(tt / act.length) : 0), 'Moyenne / actif']]
    .map(([b, l], i) => `<div class="kpi k${i}"><span>${l}</span><b>${b}</b></div>`).join('');
}
function setTopH() { const t = $('.top'), m = $('.main'); if (t && m) m.style.setProperty('--toph', t.offsetHeight - 22 + 'px'); const h = $('.cer thead tr'); if (h && m) m.style.setProperty('--h1', h.offsetHeight + 'px'); } // hauteur de l'en-tête collant (les en-têtes de tableau se placent dessous)
addEventListener('resize', setTopH);
const upd = () => { save(); render(); };

// ---------- actions ----------
const ICONS = { edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4m0 3v.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.01"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>' };
// dlg({title, msg, input, ok, cancel, danger, icon}) -> confirmation : true/null · saisie : texte/null · cancel:null = simple message
function dlg({ title = '', msg = '', input = null, password = false, ok = 'OK', cancel = 'Annuler', danger = false, icon } = {}) {
  return new Promise(res => {
    const m = $('#dm'), f = $('#df'), inp = $('#di');
    $('#dt').textContent = title; $('#dp').textContent = msg;
    $('#dic').innerHTML = ICONS[icon || (danger ? 'warn' : input != null ? 'edit' : 'info')];
    inp.type = password ? 'password' : 'text'; inp.hidden = input == null; if (input != null) inp.value = input;
    $('#dok').textContent = ok; $('#dok').className = 'btn ' + (danger ? 'danger' : 'gold');
    $('#dc').hidden = cancel === null; $('#dc').textContent = cancel ?? '';
    f.classList.toggle('dng', danger); m.hidden = false;
    if (input != null) { inp.focus(); inp.select(); } else $('#dok').focus();
    const esc = e => { if (e.key === 'Escape') done(null); };
    const done = v => { m.hidden = true; f.onsubmit = $('#dc').onclick = m.onmousedown = null; document.removeEventListener('keydown', esc); res(v); };
    document.addEventListener('keydown', esc);
    f.onsubmit = e => { e.preventDefault(); done(input != null ? inp.value : true); };
    $('#dc').onclick = () => done(null);
    m.onmousedown = e => { if (e.target === m) done(null); };
  });
}
const mvBtns = (k, i, n) => `<button class="btn ghost" data-a="${k}up" data-i="${i}" ${i ? '' : 'disabled'}>▲</button><button class="btn ghost" data-a="${k}dn" data-i="${i}" ${i < n - 1 ? '' : 'disabled'}>▼</button>`;
const swap = (L, i, d) => { [L[i], L[i + d]] = [L[i + d], L[i]]; };
async function addWeek() {
  const [d, m] = S.weeks.at(-1).split("/").map(Number), t = new Date(Math.floor(weekKey(S.weeks.at(-1)) / 10000), m - 1, d + 7);
  const def = String(t.getDate()).padStart(2, '0') + '/' + String(t.getMonth() + 1).padStart(2, '0');
  const v = await dlg({ title: 'Nouvelle semaine', msg: 'Début de la semaine (jj/mm)', input: def, ok: 'Ajouter', icon: 'cal' });
  if (!v || !/^\d{1,2}\/\d{1,2}$/.test(v.trim())) return;
  if (S.weeks.includes(v.trim())) { await dlg({ title: 'Semaine existante', msg: `La semaine du ${v.trim()} existe déjà.`, cancel: null, icon: 'warn' }); return; }
  S.weeks.push(v.trim()); S.agents.forEach(a => a.w.push(null)); sortWeeks(S); cw = hw = S.weeks.indexOf(v.trim()); upd();
}
// Lecture d'une ligne collée : colonnes (tabulations ou « ; ») « Nom ⇥ Rang ⇥ Part employé ⇥ Heures » (copie d'un tableau),
// ou texte libre « Prénom Nom 43h30min ». Renvoie { name, grade, mins } ou null (en-tête, ligne TOTAL, ligne sans durée).
const isDur = c => /^\d+h(\d{1,2})?(min)?$/i.test(c) || /^\d+:\d{2}$/.test(c);
function parseLine(line) {
  const cols = line.split(/\t|;/).map(c => c.trim());
  if (cols.length >= 2) {
    const name = cols[0].replace(/\s+/g, ' '), di = cols.findLastIndex(c => isDur(c.replace(/\s+/g, '')));
    if (!name || /^(total|nom|name|agent)$/i.test(norm(name)) || di < 1) return null;
    const g = cols[1] && !isDur(cols[1]) && !/^\d+([.,]\d+)?$/.test(cols[1]) && cols[1] !== '-' && di > 1 ? cols[1] : '';
    return { name, grade: g, mins: tparse(cols[di].replace(/\s+/g, ''), true) };
  }
  const mins = tparse(line); if (mins == null || /^\s*total\b/i.test(line)) return null;
  const name = line.replace(/\d+h(\d{1,2})?(min)?/gi, ' ').replace(/\b\d+:\d{2}\b/g, ' ').replace(/(^|\s)\d+([.,]\d+)?(?=\s|$)/g, ' ').replace(/[;\t,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { name, grade: '', mins };
}
function doImport() {
  const wi = +$('#iw').value, upG = $('#ig')?.checked; let ok = 0, cr = 0, gch = 0; const unk = [], badG = new Set();
  const findG = g => g ? S.grades.find(x => norm(x) === norm(g)) : null;
  const newG = [], archHit = [], ignored = [], low = [...S.grades].reverse().find(g => !ignR(g)) || S.grades.at(-1); // grade par défaut des agents créés sans rang connu
  if ($('#icg')?.checked && can('gradeEdit')) { // créer les rangs inconnus, placés selon l'ordre du tableau collé (trié du plus haut au plus bas)
    const seq = []; for (const line of $('#it').value.split('\n')) { const L = line.trim() && parseLine(line); if (L && L.grade && !seq.some(x => norm(x) === norm(L.grade))) seq.push(L.grade); }
    seq.forEach((g, i) => {
      if (findG(g) || ignR(g)) return;
      const nxt = seq.slice(i + 1).map(findG).find(Boolean), prv = seq.slice(0, i).reverse().map(findG).find(Boolean);
      const at = nxt ? S.grades.indexOf(nxt) : prv ? S.grades.indexOf(prv) + 1 : S.grades.length;
      S.grades.splice(at, 0, g); newG.push(g);
    });
  }
  for (const line of $('#it').value.split('\n')) {
    if (!line.trim()) continue;
    const L = parseLine(line); if (!L || L.mins == null) continue;
    const nl = norm(L.name); let b = S.agents.find(a => norm(full(a)) === nl) || null; // nom exact d'abord
    if (!b) for (const a of S.agents) { const n = norm(full(a)); if (n && nl.includes(n) && (!b || n.length > norm(full(b)).length)) b = a; }
    if (ignR(L.grade) && !(b && b.man)) { ignored.push(L.name); continue; } // Patron, Sheriff… : jamais importés (sauf agent ajouté à la main)
    const g = findG(L.grade); if (L.grade && !g) badG.add(L.grade);
    if (b) {
      b.w[wi] = L.mins; ok++; if (b.arch) archHit.push(full(b));
      if (upG && g && g !== b.grade) { logGrade(b, b.grade, g, 'import'); b.grade = g; gch++; }
      continue;
    }
    if ($('#ic').checked && L.name) {
      const [pre, ...rest] = L.name.split(' '), w = S.weeks.map(() => null); w[wi] = L.mins;
      const na = { id: uid(), mat: '-', prenom: pre, nom: rest.join(' '), grade: g || low, w }; S.agents.push(na); logGrade(na, null, na.grade, 'création'); cr++;
    } else unk.push(L.name || line.trim());
  }
  save();
  $('#ir').innerHTML = `<b>${ok}</b> mis à jour (semaine du ${S.weeks[wi]})${cr ? `, <b>${cr}</b> créé(s)` : ''}${gch ? `, <b>${gch}</b> grade(s) modifié(s)` : ''}.` + (ignored.length ? `<br>Ignorés (rang ${(S.ignRanks || []).map(esc).join(' / ')}) : ${ignored.map(esc).join(', ')}` : '') + (archHit.length ? `<br>Agent(s) archivé(s) présents dans la liste (heures enregistrées, toujours archivés) : ${archHit.map(esc).join(', ')}` : '') + (newG.length ? `<br>Grade(s) créé(s) : <b>${newG.map(esc).join(', ')}</b> — vérifie leur place dans Administration › Personnalisation.` : '') +
    (unk.length ? `<br>Non reconnus (coche « Créer les agents inconnus » pour les ajouter) : ${unk.map(esc).join(', ')}` : '') +
    (badG.size ? `<br>Rangs absents de la liste des grades (ignorés${$('#ic').checked ? ` ; agents créés en ${esc(low)}` : ''}) : ${[...badG].map(esc).join(', ')} — ajoute-les dans Administration › Personnalisation si besoin.` : '');
}
function unlock(a) { // admin : annule l'application d'une décision déjà validée
  const d = (S.ceremonies[S.weeks[cw]] || {})[a.id];
  if (d?.done) { a.grade = d.from; d.done = false; }
}
function logGrade(a, from, to, src) { (S.glog ||= []).push({ id: uid() + uid(), agent: a.id, t: Date.now(), w: S.weeks.length - 1, from, to, src }); } // création / modification manuelle (les cérémonies ont leur propre historique)
function ent(id) { return ((S.ceremonies[S.weeks[cw]] ||= {})[id] ||= {}); } // fiche cérémonie d'un agent (décision, infos, notes)
function decide(id, patch) {
  const wk = S.weeks[cw], a = S.agents.find(x => x.id === id);
  const D = (S.ceremonies[wk] ||= {}), d = (D[id] ||= {});
  if (d.done && ('a' in patch || 'g' in patch)) unlock(a);
  Object.assign(d, patch);
  return { a, d };
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const act = el.dataset.a, id = el.dataset.id;
  if (['radd', 'rdel', 'rall', 'rup', 'rdn'].includes(act) && !admin) return;
  if (['udel', 'uadd', 'upw'].includes(act) && !mgr()) return;
  if (['del', 'arch', 'unarch'].includes(act) && !can('agentDel')) return;
  if (act === 'add' && !can('agentAdd')) return;
  if (act === 'cell' && !can('hoursEdit')) return;
  if (act === 'import' && !can('hoursImport')) return;
  if (act === 'week' && !can('weekAdd')) return;
  if (act === 'apply' && !can('cerValidate')) return;
  if (['gadd', 'gdel', 'gup', 'gdn', 'gcolr', 'iradd', 'irdel'].includes(act) && !can('gradeEdit')) return;
  if (['aadd', 'adel', 'aup', 'adn'].includes(act) && !can('actionEdit')) return;
  if (['sadd', 'sdel', 'sup', 'sdn'].includes(act) && !can('sanctionEdit')) return;
  if (act === 'add') {
    const nom = $('#n-nom').value.trim(), pre = $('#n-pre').value.trim(); if (!nom && !pre) return;
    { const na = { id: uid(), mat: $('#n-mat').value.trim() || '-', prenom: pre, nom, grade: $('#n-gr').value, w: S.weeks.map(() => null), man: true }; S.agents.push(na); logGrade(na, null, na.grade, 'création'); } upd();
  } else if (act === 'del') {
    const a = S.agents.find(x => x.id === id);
    if (a && await dlg({ title: 'Supprimer définitivement', msg: `Supprimer ${full(a)} (${a.mat}) avec toutes ses heures et son historique ? Cette action est irréversible.`, ok: 'Supprimer', danger: true })) { S.agents = S.agents.filter(x => x !== a); upd(); }
  } else if (act === 'arch') {
    const a = S.agents.find(x => x.id === id); if (!a) return;
    const why = await dlg({ title: 'Archiver l’agent', msg: `${full(a)} sera retiré de l’effectif, des heures et de la cérémonie. Ses statistiques restent consultables et tu pourras le réintégrer.\n\nRaison (facultatif) :`, input: '', ok: 'Archiver' });
    if (why === null) return;
    a.arch = { t: Date.now(), w: lastW(), why: why.trim() }; upd();
  } else if (act === 'unarch') {
    const a = S.agents.find(x => x.id === id); if (a) { delete a.arch; upd(); }
  } else if (act === 'sharch') { flt.arch = !flt.arch; render(); }
  else if (act === 'starch') { st.arch = !st.arch; render(); } else if (act === 'week') addWeek();
  else if (act === 'cell') {
    const a = S.agents.find(x => x.id === id), j = +el.dataset.j;
    const v = await dlg({ title: full(a), msg: `Semaine du ${S.weeks[j]} · heures (ex : 12h30 — vide = aucune donnée)`, input: a.w[j] == null ? '' : F(a.w[j]), ok: 'Enregistrer' });
    if (v === null) return;
    if (!v.trim()) a.w[j] = null; else { const n = tparse(v, true); if (n == null) return; a.w[j] = n; }
    upd();
  } else if (act === 'import') doImport();
  else if (act === 'all') { hall = !hall; render(); }
  else if (act === 'hmode') { hall = el.dataset.v === '1'; render(); }
  else if (act === 'hprev' || act === 'hnext') { hw = Math.max(0, Math.min(S.weeks.length - 1, hw + (act === 'hprev' ? -1 : 1))); render(); }
  else if (act === 'aup' || act === 'adn') { swap(S.actions, +el.dataset.i, act === 'aup' ? -1 : 1); upd(); }
  else if (act === 'sup' || act === 'sdn') { swap(S.sanctions, +el.dataset.i, act === 'sup' ? -1 : 1); upd(); }
  else if (act === 'uadd') {
    if (await adminCall('POST', '/api/users', { name: $('#nu').value.trim(), password: $('#np')?.value || '', discordId: $('#nd').value.trim(), role: $('#nr').value })) render();
  } else if (act === 'udel') {
    const u = users.find(x => x.id === id); if (!u || u.id === me.id) return;
    if (await dlg({ title: 'Retirer le compte', msg: `Supprimer le compte « ${u.name} » ?`, ok: 'Retirer', danger: true }) && await adminCall('DELETE', `/api/users/${id}`)) render();
  } else if (act === 'upw') {
    const u = users.find(x => x.id === id), p = await dlg({ title: 'Nouveau mot de passe', msg: `Compte « ${u.name} » · 4 caractères minimum`, input: '', password: true, ok: 'Enregistrer' });
    if (p === null) return;
    if (await adminCall('POST', `/api/users/${id}/password`, { password: p })) await dlg({ title: 'Mot de passe modifié', msg: `Le mot de passe de « ${u.name} » a été mis à jour.`, cancel: null, icon: 'info' });
  }
  else if (act === 'radd') {
    const v = $('#rnew').value.trim();
    if (!v) { await dlg({ title: 'Création impossible', msg: 'Donne un nom au rôle.', cancel: null, icon: 'warn' }); return; }
    if (await adminCall('PUT', '/api/roles', { roles: [...clone(roles), { id: uid() + uid(), name: v, tabs: ['eff', 'hrs'], perms: [] }] })) render();
  } else if (act === 'rdel') {
    const r = roles.find(x => x.id === id); if (!r || r.builtin) return;
    const n = users.filter(u => u.role === r.id).length;
    if (n) await dlg({ title: 'Rôle utilisé', msg: `${n} compte(s) ont encore ce rôle : change leur rôle avant de le retirer.`, cancel: null, icon: 'warn' });
    else if (await dlg({ title: 'Retirer le rôle', msg: `Retirer le rôle « ${r.name} » ?`, ok: 'Retirer', danger: true }) && await adminCall('PUT', '/api/roles', { roles: clone(roles).filter(x => x.id !== id) })) render();
  }
  else if (act === 'rup' || act === 'rdn') { // ordre des rôles (enregistré sur le serveur)
    const next = clone(roles), i = next.findIndex(x => x.id === id), k = act === 'rup' ? i - 1 : i + 1; if (i < 0 || k < 0 || k >= next.length) return;
    [next[i], next[k]] = [next[k], next[i]]; if (await adminCall('PUT', '/api/roles', { roles: next })) render();
  }
  else if (act === 'rall') {
    const next = clone(roles), r = next.find(x => x.id === id); if (!r || r.admin) return;
    r.perms = PERMS.every(([k]) => (r.perms || []).includes(k)) ? [] : PERMS.map(([k]) => k);
    if (await adminCall('PUT', '/api/roles', { roles: next })) render();
  }
  else if (act === 'sagent') { st.id = id; render(); }
  else if (act === 'sper') { st.f = +el.dataset.n ? Math.max(0, lastW() - +el.dataset.n + 1) : 0; st.t = null; render(); }
  else if (act === 'iradd') { const n = $('#irn').value.trim(); if (n && !ignR(n)) { (S.ignRanks ||= []).push(n); upd(); } }
  else if (act === 'irdel') { S.ignRanks.splice(+el.dataset.i, 1); upd(); }
  else if (act === 'gcolr') { delete S.gcol[S.grades[+el.dataset.i]]; upd(); }
  else if (act === 'sadd') { const n = $('#sn').value.trim(); if (n && !S.sanctions.includes(n)) { S.sanctions.push(n); upd(); } }
  else if (act === 'sdel') { const i = +el.dataset.i; if (await dlg({ title: 'Retirer la sanction', msg: `Retirer « ${S.sanctions[i]} » du menu déroulant ?`, ok: 'Retirer', danger: true })) { S.sanctions.splice(i, 1); upd(); } }
  else if (act === 'gadd') { const n = $('#gn').value.trim(); if (n && !S.grades.includes(n)) { S.grades.push(n); upd(); } }
  else if (act === 'gup' || act === 'gdn') { const i = +el.dataset.i, k = act === 'gup' ? i - 1 : i + 1; [S.grades[i], S.grades[k]] = [S.grades[k], S.grades[i]]; upd(); }
  else if (act === 'gdel') {
    const i = +el.dataset.i, g = S.grades[i];
    if (S.agents.some(a => a.grade === g) || S.actions.some(x => x.to === g)) await dlg({ title: 'Grade utilisé', msg: 'Des agents ou des options utilisent encore ce grade : change-les avant de le retirer.', cancel: null, icon: 'warn' });
    else if (await dlg({ title: 'Retirer le grade', msg: `Retirer le grade « ${g} » ?`, ok: 'Retirer', danger: true })) { S.grades.splice(i, 1); delete S.gcol[g]; upd(); }
  } else if (act === 'aadd') { const n = $('#an2').value.trim(); if (n) { { const ef = $('#ae').value; S.actions.push({ id: uid(), label: n, mv: ef === 'fix' ? 0 : +ef, ...(ef === 'fix' ? { to: $('#at').value } : {}) }); } upd(); } }
  else if (act === 'adel') {
    if (Object.values(S.ceremonies).some(c => Object.values(c).some(x => x.a === id))) await dlg({ title: 'Option utilisée', msg: 'Cette option est utilisée dans une cérémonie : impossible de la retirer.', cancel: null, icon: 'warn' });
    else if (await dlg({ title: 'Retirer l’option', msg: 'Retirer cette option de décision ?', ok: 'Retirer', danger: true })) { S.actions = S.actions.filter(x => x.id !== id); upd(); }
  }
  else if (act === 'copy') { await navigator.clipboard.writeText(recap()); el.textContent = 'Copié ✓'; }
  else if (act === 'apply') {
    const D = S.ceremonies[S.weeks[cw]] || {}, todo = actv().filter(a => D[a.id]?.a && !D[a.id].done);
    if (todo.length && await dlg({ title: 'Valider la cérémonie', msg: `Appliquer ${todo.length} changement(s) de grade aux agents concernés ?`, ok: 'Appliquer', icon: 'warn' })) {
      todo.forEach(a => { D[a.id].from = D[a.id].from || a.grade; a.grade = D[a.id].g || a.grade; D[a.id].done = true; }); upd();
    }
  }
});
document.addEventListener('change', e => {
  const el = e.target, act = el.dataset.a;
  if (['act', 'ng', 'why', 'inf'].includes(act) && !can('cerEdit')) return;
  if (act === 'hin' && !can('hoursEdit')) return;
  if (['gname', 'gcol'].includes(act) && !can('gradeEdit')) return;
  if (['aname', 'aeff', 'ato'].includes(act) && !can('actionEdit')) return;
  if (act === 'sname' && !can('sanctionEdit')) return;
  if (['udid', 'urole'].includes(act) && !mgr()) return;
  if (el.id === 'cw') { cw = +el.value; render(); }
  else if (el.id === 'fg') { flt.g = el.value; $('#list').innerHTML = listHtml(); }
  else if (el.id === 'hw') { hw = +el.value; render(); }
  else if (el.id === 'hg') { hg = el.value; render(); }
  else if (act === 'hmin') { if (!can('hoursEdit')) return; const v = parseFloat(String(el.value).replace(',', '.')); if (v >= 0) { S.minH = v; upd(); } }
  else if (el.id === 'pf') { st.f = +el.value; if (st.t != null && st.t < st.f) st.t = st.f; render(); }
  else if (el.id === 'pe') { st.t = +el.value; if (st.f > st.t) st.f = st.t; render(); }
  else if (el.id === 'ew') { flt.w = +el.value; $('#list').innerHTML = listHtml(); }
  else if (act === 'udid') { // admin : associer / modifier l'ID Discord d'un compte
    adminCall('PATCH', `/api/users/${el.dataset.id}`, { discordId: el.value.trim() }).then(() => softRender());
  }
  else if (act === 'urole') {
    adminCall('PATCH', `/api/users/${el.dataset.id}`, { role: el.value }).then(() => softRender());
  }
  else if (act === 'rname') { if (!admin) return; const next = clone(roles), r = next.find(x => x.id === el.dataset.id); r.name = el.value.trim(); adminCall('PUT', '/api/roles', { roles: next }).then(() => softRender()); }
  else if (act === 'rtab' || act === 'rperm') {
    if (!admin) return;
    const next = clone(roles), r = next.find(x => x.id === el.dataset.id); if (!r || r.admin) return;
    const key = act === 'rtab' ? 'tabs' : 'perms', k = el.dataset.k;
    r[key] = el.checked ? [...new Set([...(r[key] || []), k])] : (r[key] || []).filter(x => x !== k);
    adminCall('PUT', '/api/roles', { roles: next }).then(ok => { if (!ok) softRender(); });
  }
  else if (act === 'inf') { ent(el.dataset.id)[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; save(); }
  else if (act === 'egr') { if (!can('agentEdit')) return; const a = S.agents.find(x => x.id === el.dataset.id), old = a.grade; a.grade = el.value; if (old !== a.grade) { logGrade(a, old, a.grade, 'modification manuelle'); a.man = true; } save(); }
  else if (act === 'gcol') { S.gcol[S.grades[+el.dataset.i]] = el.value; upd(); }
  else if (act === 'emat' || act === 'epre' || act === 'enom') { // modifier matricule / prénom / nom
    if (!can('agentEdit')) return;
    const a = S.agents.find(x => x.id === el.dataset.id), k = { emat: 'mat', epre: 'prenom', enom: 'nom' }[act], v = el.value.trim();
    if (act === 'emat' ? !v : (!v && !a[act === 'epre' ? 'nom' : 'prenom'])) { el.value = a[k]; return; }
    a[k] = v; save();
  } else if (act === 'hin') {
    const a = S.agents.find(x => x.id === el.dataset.id), v = el.value.trim(), n = v ? tparse(v, true) : null;
    if (v && n == null) { el.value = a.w[hw] == null ? '' : F(a.w[hw]); return; }
    a.w[hw] = n; el.value = n == null ? '' : F(n); save();
    const tr = el.closest('tr[data-row]'); if (tr) { const t = document.createElement('tbody'); t.innerHTML = hRow(a); const nr = t.firstElementChild; ['hbar', 'hd'].forEach(c => { const o = tr.querySelector('.' + c)?.closest('td'), x = nr.querySelector('.' + c)?.closest('td'); if (o && x) o.replaceWith(x); }); tr.className = nr.className; }
    if ($('#hcards')) $('#hcards').innerHTML = hCards(); setKpi();
  } else if (act === 'gname') {
    const i = +el.dataset.i, old = S.grades[i], nv = el.value.trim();
    if (!nv || (nv !== old && S.grades.includes(nv))) { el.value = old; return; }
    S.agents.forEach(a => { if (a.grade === old) a.grade = nv; });
    S.actions.forEach(x => { if (x.to === old) x.to = nv; });
    Object.values(S.ceremonies).forEach(c => Object.values(c).forEach(x => { if (x.from === old) x.from = nv; if (x.g === old) x.g = nv; }));
    if (S.gcol[old]) { S.gcol[nv] = S.gcol[old]; delete S.gcol[old]; }
    S.grades[i] = nv; upd();
  } else if (act === 'aname') { const x = S.actions.find(y => y.id === el.dataset.id); if (el.value.trim()) x.label = el.value.trim(); upd(); }
  else if (act === 'aeff') { const x = S.actions.find(y => y.id === el.dataset.id); if (el.value === 'fix') { x.to = x.to ?? S.grades[0]; x.mv = 0; } else { x.mv = +el.value; delete x.to; } upd(); }
  else if (act === 'ato') { S.actions.find(y => y.id === el.dataset.id).to = el.value; upd(); }
  else if (el.id === 'ae') { $('#at').hidden = el.value !== 'fix'; }
  else if (act === 'sname') {
    const i = +el.dataset.i, old = S.sanctions[i], nv = el.value.trim();
    if (!nv || (nv !== old && S.sanctions.includes(nv))) { el.value = old; return; }
    Object.values(S.ceremonies).forEach(c => Object.values(c).forEach(x => { if (x.sanction === old) x.sanction = nv; }));
    S.sanctions[i] = nv; upd();
  }
  else if (act === 'act') {
    const a = S.agents.find(x => x.id === el.dataset.id); unlock(a);
    const ac = S.actions.find(x => x.id === el.value), i = S.grades.indexOf(a.grade);
    const g = !ac ? a.grade : ac.to !== undefined ? ac.to : i < 0 ? a.grade : S.grades[Math.max(0, Math.min(S.grades.length - 1, i + ac.mv))];
    decide(a.id, { a: el.value, from: a.grade, g }); upd();
  } else if (act === 'ng') { // nouveau grade choisi directement : on en déduit la décision si besoin
    const a = S.agents.find(x => x.id === el.dataset.id), d = ent(a.id);
    if (!d.a) {
      const i = S.grades.indexOf(a.grade), k = S.grades.indexOf(el.value);
      if (k === i) return;
      const ac = S.actions.find(x => x.to === undefined && (k < i ? x.mv < 0 : x.mv > 0)) || S.actions[0];
      decide(a.id, { a: ac.id, from: a.grade, g: el.value });
    } else decide(a.id, { g: el.value });
    upd();
  }
  else if (act === 'why') { decide(el.dataset.id, { r: el.value }); save(); $('#rc').textContent = recap(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { flt.q = e.target.value; $('#list').innerHTML = listHtml(); }
  else if (e.target.id === 'hq') { hq = e.target.value; render(); const i = $('#hq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  else if (e.target.id === 'sas') { st.q = e.target.value; $('#alist').innerHTML = aListHtml(); }
});
$('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b && canTab(b.dataset.t)) { tab = b.dataset.t; render(); } });
document.addEventListener('click', e => { const h = e.target.closest('.sh'); if (h) h.parentElement.classList.toggle('closed'); }); // sections repliables
$('#sq').addEventListener('input', e => { const q = norm(e.target.value); document.querySelectorAll('#nav button[data-t]').forEach(b => b.classList.toggle('nf', !!q && !norm(b.textContent).includes(q))); }); // recherche de page

// sauvegarde / restauration / reset
$('#bk').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
  a.download = 'samp-sandy-shore-sauvegarde.json'; a.click();
};
$('#rs').onchange = async e => {
  if (!can('dataReset')) return;
  try { const d = JSON.parse(await e.target.files[0].text()); if (d.weeks && d.agents) { S = migrate(d); upd(); } } catch (err) { await dlg({ title: 'Restauration impossible', msg: 'Ce fichier de sauvegarde est invalide.', cancel: null, icon: 'warn' }); }
};
$('#rz').onclick = async () => { if (can('dataReset') && await dlg({ title: 'Réinitialiser', msg: 'Tout réinitialiser avec les données de départ ? Les modifications actuelles seront perdues.', ok: 'Réinitialiser', danger: true })) { S = migrate(seed()); upd(); } };
// ---------- connexion & synchronisation avec le serveur (server.js) ----------
const TABS = ['eff', 'hrs', 'imp', 'cer', 'sta', 'med', 'set', 'acc', 'mda'];
const PERM_GROUPS = [
  ['Agents', [['agentAdd', 'Créer'], ['agentEdit', 'Modifier'], ['agentDel', 'Archiver / suppr.']]],
  ['Heures', [['hoursEdit', 'Saisir'], ['hoursImport', 'Importer'], ['weekAdd', 'Ajouter semaine']]],
  ['Cérémonie', [['cerEdit', 'Préparer'], ['cerValidate', 'Valider'], ['cerEditDone', 'Modifier validée']]],
  ['Paramètres', [['gradeEdit', 'Grades'], ['actionEdit', 'Options décision'], ['sanctionEdit', 'Sanctions'], ['usersManage', 'Gérer comptes']]],
  ['Médailles', [['medalEdit', 'Gérer / remettre'], ['sheetSync', 'Synchro Google Sheet']]],
  ['Données', [['dataBackup', 'Sauvegarde'], ['dataReset', 'Restaurer / réinit.']]]];
const PERMS = PERM_GROUPS.flatMap(g => g[1]);
let pwdOn = true, roles = [], users = [], firstRun = false, discordOn = false, redirUrl = '', dcMsg = '';
let SV = 0, VV = 0, S0 = null, saving = false, dirty = false, saveTimer = null, needRender = false;
const roleOf = u => roles.find(r => r.id === u.role) || roles.find(r => r.id === 'user') || { name: '?', tabs: [], perms: [] };
const canTab = t => !!me && !!t && (t === 'acc' ? admin || can('usersManage') : t === 'mda' ? can('medalEdit') || can('sheetSync') : admin || (roleOf(me).tabs || []).includes(t)); // acc / mda : selon les permissions
const can = p => !!me && (admin || (roleOf(me).perms || []).includes(p)); // permissions fines (voir « Rôles et accès »)
const clone = x => JSON.parse(JSON.stringify(x));
const setSync = (s, tip) => { const l = $('#syled'); if (l) { l.dataset.s = s; l.title = tip; } };
const apiUrl = (method, url) => { const [p, q] = url.replace(/^\/api\//, '').split('?'); return `api.php?r=${p}${method === 'GET' || method === 'POST' ? '' : '&_m=' + method}${q ? '&' + q : ''}`; };
async function api(method, url, body) {
  const r = await fetch(apiUrl(method, url), { method: method === 'GET' ? 'GET' : 'POST', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, json: j };
}

// fusion à 3 voies (base = dernier état connu du serveur, mine = mes changements, theirs = état actuel du serveur) : évite d'écraser le travail des autres
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idList = x => x.every(i => i && typeof i === 'object' && typeof i.id === 'string') && new Set(x.map(i => i.id)).size === x.length;
function merge(b, m, t) {
  if (eq(m, b)) return t;
  if (eq(t, b)) return m;
  if (Array.isArray(m) && Array.isArray(t) && Array.isArray(b)) {
    if (idList(m) && idList(t) && idList(b)) {
      const B = new Map(b.map(x => [x.id, x])), T = new Map(t.map(x => [x.id, x])), M = new Map(m.map(x => [x.id, x])), out = [];
      for (const x of t) { if (M.has(x.id)) out.push(merge(B.get(x.id), M.get(x.id), x)); else if (!B.has(x.id) || !eq(B.get(x.id), x)) out.push(x); }
      for (const x of m) if (!T.has(x.id) && (!B.has(x.id) || !eq(B.get(x.id), x))) out.push(x);
      return out;
    }
    return m.length === t.length && m.length === b.length ? m.map((x, i) => merge(b[i], x, t[i])) : m;
  }
  if (m && t && b && typeof m === 'object' && typeof t === 'object' && typeof b === 'object' && !Array.isArray(m) && !Array.isArray(t) && !Array.isArray(b)) {
    const o = {};
    for (const k of new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(b)])) { const v = merge(b[k], m[k], t[k]); if (v !== undefined) o[k] = v; }
    return o;
  }
  return m;
}
const editing = () => { const a = document.activeElement; return !!(csPop || !$('#dm').hidden || (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.closest('#view'))); };
const softRender = () => editing() ? (needRender = true) : render();

function save() { if (!me) return; dirty = true; setSync('busy', 'Enregistrement…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); }
let fails = 0; const retryMs = () => Math.min(60000, 4000 * 2 ** Math.min(4, fails++)); // nouvelles tentatives de plus en plus espacées (4 s → 60 s)
async function flush() {
  if (!me) return;
  if (saving) { saveTimer = setTimeout(flush, 250); return; }
  if (!dirty) return;
  saving = true; dirty = false; const snap = clone(S);
  try {
    const r = await api('PUT', '/api/state', { base: SV, state: snap });
    if (r.status === 409) { const R = migrate(r.json.state); S = merge(S0 || R, S, R); S0 = clone(R); SV = r.json.sv; VV = r.json.v; dirty = true; setTimeout(flush, 30); softRender(); }
    else if (r.ok) { fails = 0; SV = r.json.sv; VV = r.json.v; S0 = snap; setSync(dirty ? 'busy' : 'ok', dirty ? 'Enregistrement…' : 'Synchronisé avec le serveur'); }
    else if (r.status === 403) { setSync('off', 'Droits insuffisants pour enregistrer'); }
    else { dirty = true; setSync('off', r.json?.error || 'Enregistrement refusé'); saveTimer = setTimeout(flush, retryMs()); }
  } catch (e) { dirty = true; setSync('off', 'Serveur injoignable — nouvelle tentative…'); saveTimer = setTimeout(flush, retryMs()); }
  saving = false;
}
function applyPayload(j) {
  VV = j.v; if (j.roles) roles = j.roles; if (j.users) users = j.users;
  if (j.me) { me = j.me; admin = !!roleOf(me).admin; }
  if (j.state === null) { S = migrate(seed()); S0 = clone(S); SV = j.sv; save(); } // serveur vide : on crée la 1re version
  else if (j.state && j.sv !== SV && !dirty && !saving) { S = migrate(j.state); S0 = clone(S); SV = j.sv; }
}
async function sync() { // toutes les 4 s : récupère les changements des autres ordinateurs
  if (!me || document.hidden || saving || dirty) return;
  try {
    const r = await api('GET', '/api/sync?v=' + VV);
    if (r.status === 401) { me = null; admin = false; render(); showLogin(); return; }
    setSync('ok', 'Synchronisé avec le serveur');
    if (!r.json || r.json.same) return;
    applyPayload(r.json); softRender();
  } catch (e) { setSync('off', 'Serveur injoignable — nouvelle tentative…'); }
}
{ const Q = new URLSearchParams(location.search), q = Q.get('dc'), why = Q.get('why'); if (q) { history.replaceState(null, '', location.pathname); dcMsg = { denied: 'Connexion Discord annulée ou refusée.', state: 'Connexion Discord invalide : réessaie.', error: 'Connexion Discord impossible : réessaie.', conf: 'Discord n’est pas configuré sur le serveur (voir LISEZ-MOI).' }[q] || ''; if (dcMsg && why) dcMsg += ' (' + why + ')'; } }
async function load() {
  let j; try { j = (await api('GET', '/api/boot')).json; } catch (e) { j = null; }
  if (!j) { setSync('off', 'Serveur injoignable'); firstRun = false; showLogin(); $('#le').textContent = 'Serveur injoignable : vérifie que api.php est bien en ligne (hébergement PHP) ou lance « node server.js ».'; return; }
  firstRun = !!j.firstRun; discordOn = !!j.discord; pwdOn = j.pwd !== false; redirUrl = j.redirect || '';
  if (!j.me) { me = null; admin = false; users = []; roles = []; render(); showLogin(); if (dcMsg) $('#le').textContent = dcMsg; return; }
  applyPayload(j); setSync('ok', 'Synchronisé avec le serveur'); $('#login').hidden = true; tab = TABS.find(canTab) || null; render();
}
function showLogin() {
  $('#lt').textContent = firstRun ? 'Création du compte administrateur' : 'Connexion';
  $('#ls').textContent = firstRun ? 'Aucun compte n’existe encore : le premier compte sera administrateur (identifiant ou Discord).' : 'Accès réservé aux membres enregistrés.';
  $('#lc').hidden = !firstRun || !pwdOn; $('#lb').textContent = firstRun ? 'Créer le compte' : 'Se connecter';
  document.querySelectorAll('#lf .fld:not(#lc), #lf .lrem, #lb, #lf .lsep').forEach(e => e.hidden = !pwdOn); // Discord uniquement
  if (!pwdOn) $('#ls').textContent = firstRun ? 'Aucun compte n’existe encore : le premier compte connecté avec Discord sera administrateur.' : 'Connecte-toi avec ton compte Discord.';
  $('#lu').value = $('#lp').value = $('#lp2').value = ''; $('#le').textContent = ''; $('#login').hidden = false; if (pwdOn) $('#lu').focus();
}
$('#lf').onsubmit = async e => {
  e.preventDefault();
  const name = $('#lu').value.trim(), pwd = $('#lp').value, c = $('#lf');
  const fail = m => { $('#le').textContent = m; c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); };
  if (firstRun && pwd !== $('#lp2').value) return fail('Les deux mots de passe sont différents.');
  try {
    const r = await api('POST', firstRun ? '/api/setup' : '/api/login', { name, password: pwd, remember: $('#lr').checked });
    if (!r.ok) return fail(r.json?.error || 'Connexion impossible');
    await load();
  } catch (err) { fail('Serveur injoignable : réessaie dans quelques secondes.'); }
};
$('#lo').onclick = async () => {
  try { await api('POST', '/api/logout'); } catch (e) {}
  me = null; admin = false; users = []; S0 = null; dirty = false; S = migrate(seed()); render(); firstRun = false; showLogin();
};
$('#pw').onclick = async () => {
  let old = '';
  if (me.hasPwd) {
    old = await dlg({ title: 'Mon mot de passe', msg: 'Saisis ton mot de passe actuel.', input: '', password: true, ok: 'Suivant' });
    if (old === null) return;
  }
  const n = await dlg({ title: me.hasPwd ? 'Nouveau mot de passe' : 'Définir un mot de passe', msg: '4 caractères minimum.', input: '', password: true, ok: 'Enregistrer' });
  if (n === null) return;
  const r = await api('POST', '/api/me/password', { old, password: n });
  if (!r.ok) { await dlg({ title: 'Mot de passe non modifié', msg: r.json?.error || 'Erreur serveur.', cancel: null, icon: 'warn' }); return; }
  me.hasPwd = true; await dlg({ title: 'Mot de passe enregistré', msg: 'Ton mot de passe a été mis à jour.', cancel: null, icon: 'info' });
};
$('#ld').onclick = async () => {
  if (!discordOn) { await dlg({ title: 'Discord non configuré', msg: `Renseigne discordClientId et discordClientSecret dans config.php (hébergement PHP) ou config.json (node server.js) — voir LISEZ-MOI.\n\nURL de redirection à enregistrer dans le portail Discord :\n${redirUrl || new URL('discord.php', location.href).href}`, cancel: null, icon: 'warn' }); return; }
  location.href = 'discord.php';
};
async function adminCall(method, url, body) { // action d'administration : le serveur renvoie la liste à jour des comptes et des rôles
  let r; try { r = await api(method, url, body); } catch (e) { await dlg({ title: 'Serveur injoignable', msg: 'Impossible de joindre le serveur.', cancel: null, icon: 'warn' }); return false; }
  if (!r.ok) { await dlg({ title: 'Action impossible', msg: r.json?.error || 'Erreur serveur.', cancel: null, icon: 'warn' }); return false; }
  if (r.json.users) users = r.json.users; if (r.json.roles) roles = r.json.roles;
  me = users.find(u => u.id === me.id) || me; admin = !!roleOf(me).admin;
  return true;
}
const dpseudo = u => u.dname ? (u.dun && u.dun !== u.dname ? `${u.dname} (@${u.dun})` : u.dname) : '';
function rolesPanel() {
  const T = [['eff', 'Effectifs'], ['hrs', 'Heures'], ['imp', 'Importer'], ['cer', 'Cérémonie'], ['sta', 'Statistiques'], ['med', 'Médailles'], ['set', 'Personnalisation']];
  const box = (attrs, on, dis) => `<td class="ck"><label class="chk"><input type="checkbox" ${attrs} ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}><span></span></label></td>`;
  const nUsers = r => users.filter(u => u.role === r.id).length;
  return `<section class="panel"><h2>Rôles et accès</h2><p class="note">Pour chaque rôle : les onglets visibles, puis les actions autorisées. « Gérer comptes » permet de valider les comptes en attente et de gérer les comptes non administrateurs (sans toucher aux rôles). Le panneau « Rôles et accès » reste réservé aux administrateurs.</p>
  <h3 class="sub">Onglets accessibles</h3><div class="wrapt"><table><thead><tr><th>Rôle</th>${T.map(c => `<th style="text-align:center">${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>` +
    roles.map((r, i) => `<tr><td><span class="rmv"><button class="btn ghost" data-a="rup" data-id="${r.id}" ${i ? '' : 'disabled'} title="Monter">▲</button><button class="btn ghost" data-a="rdn" data-id="${r.id}" ${i < roles.length - 1 ? '' : 'disabled'} title="Descendre">▼</button></span><input class="cin" style="width:200px" data-a="rname" data-id="${r.id}" value="${esc(r.name)}"><small class="note">${nUsers(r)} compte(s)</small></td>` + T.map(([k]) => box(`data-a="rtab" data-id="${r.id}" data-k="${k}"`, r.admin || (r.tabs || []).includes(k), r.admin)).join('') +
      `<td>${r.builtin ? '' : `<button class="btn del" data-a="rdel" data-id="${r.id}">Retirer</button>`}</td></tr>`).join('') +
    `</tbody></table></div>
  <h3 class="sub">Permissions (actions)</h3><div class="wrapt"><table class="ptab2"><thead><tr><th>Permission</th>${roles.map(r => `<th class="rc">${esc(r.name)}${r.admin ? '' : `<button class="btn ghost mini-b" data-a="rall" data-id="${r.id}" title="Tout cocher / tout décocher">tout</button>`}</th>`).join('')}</tr></thead><tbody>` +
    PERM_GROUPS.map(([g, L]) => `<tr class="pgr"><td colspan="${roles.length + 1}">${g}</td></tr>` + L.map(([k, l]) => `<tr><td class="pl">${l}</td>` + roles.map(r => box(`data-a="rperm" data-id="${r.id}" data-k="${k}"`, r.admin || (r.perms || []).includes(k), r.admin)).join('') + '</tr>').join('')).join('') +
    `</tbody></table></div><div class="frm" style="margin-top:12px"><input id="rnew" placeholder="Nom du nouveau rôle (ex : Superviseur)"><button class="btn gold" data-a="radd">Ajouter le rôle</button></div></section>`;
}
const avHtml = u => u.discordId && u.avatar ? `<span class="av img" style="background-image:url(https://cdn.discordapp.com/avatars/${esc(u.discordId)}/${esc(u.avatar)}.png?size=64)"></span>` : `<span class="av">${esc(u.name.slice(0, 2))}</span>`;
function usersPanel() {
  const isA = u => !!roleOf(u).admin, okRoles = roles.filter(r => admin || !r.admin);
  const ro = sel => okRoles.map(r => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const row = u => {
    const lockU = !admin && isA(u); // un gestionnaire ne touche pas aux administrateurs
    return `<div class="frm${u.role === 'pending' ? ' pend' : ''}">${avHtml(u)}<b class="uname">${esc(u.name)}${u.id === me?.id ? ' <span class="note">(toi)</span>' : ''}${u.role === 'pending' ? ' <span class="tag">En attente</span>' : ''}</b>` +
      `<input class="ein" style="width:170px" data-a="udid" data-id="${u.id}" placeholder="ID Discord" value="${esc(u.discordId || '')}" ${lockU ? 'disabled' : ''}>` +
      `<span class="dpn${u.dname ? ' on' : ''}" title="Pseudo Discord (rempli automatiquement à la connexion avec Discord)"><svg viewBox="0 0 24 24"><path d="M7.2 6.2c1.6-.7 3.3-1 4.8-1s3.2.3 4.8 1l1.7 1.9c1.4 2.6 2 5.4 1.8 8.4-1.4 1.1-3.1 1.8-4.4 2.1l-1.1-1.7c.9-.2 1.7-.6 2.4-1.1-.2-.1-.5-.3-.7-.5-2.3 1-5.1 1-7.4 0-.2.2-.5.4-.7.5.7.5 1.5.9 2.4 1.1l-1.1 1.7c-1.3-.3-3-1-4.4-2.1-.2-3 .4-5.8 1.8-8.4z"/></svg>${u.dname ? esc(dpseudo(u)) : '<i>non connecté avec Discord</i>'}</span>` +
      (lockU ? `<span class="tag">${esc(roleOf(u).name)}</span>` : `<select class="cin" data-a="urole" data-id="${u.id}">${ro(u.role)}</select>${pwdOn ? `<button class="btn ghost" data-a="upw" data-id="${u.id}">Mot de passe</button>` : ''}${u.id === me?.id ? '' : `<button class="btn del" data-a="udel" data-id="${u.id}">${u.role === 'pending' ? 'Refuser' : 'Retirer'}</button>`}`) + `</div>`;
  };
  const pend = users.filter(u => u.role === 'pending');
  return `<section class="panel req"><h2>Demandes d’accès <span class="note">(${pend.length})</span></h2>${pend.length ? '<p class="note">Personnes connectées avec Discord en attente d’un rôle : choisis leur rôle pour leur donner accès, ou refuse la demande.</p>' + pend.map(row).join('') : '<p class="note">Aucune demande en attente.</p>'}</section>
  <section class="panel"><h2>Comptes utilisateurs <span class="note">(${users.length - pend.length})</span></h2><p class="note">Les comptes sont enregistrés sur le serveur et partagés entre tous les ordinateurs. Le rôle de chaque compte détermine les onglets et les actions autorisés (voir « Rôles et accès »).</p>
  ${admin ? `<p class="note">Connexion Discord : <b>${discordOn ? 'configurée' : 'non configurée'}</b> · URL de redirection à enregistrer dans le portail Discord : <code class="mono">${esc(redirUrl)}</code></p>` : ''}<p class="note">Quand quelqu’un se connecte avec Discord pour la première fois, son compte apparaît ci-dessous avec le rôle « En attente » et son pseudo Discord : choisis-lui simplement son rôle. Tu peux aussi créer son compte à l’avance avec son ID Discord.</p>` +
    (users.filter(u => u.role !== 'pending').map(row).join('') || '<p class="note">Aucun compte.</p>') +
    `<div class="frm"><input id="nu" placeholder="Identifiant" autocomplete="off"><input id="nd" placeholder="ID Discord${pwdOn ? ' (optionnel)' : ''}" autocomplete="off">${pwdOn ? '<input id="np" type="password" placeholder="Mot de passe (facultatif avec Discord)" autocomplete="new-password">' : ''}<select id="nr">${ro('user')}</select><button class="btn gold" data-a="uadd">Créer le compte</button></div></section>`;
}

// ---------- médailles, rubans de service & synchronisation Google Sheet ----------
const pad2 = n => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function frDate(s) { // "21/05/2023", "1/5/23", "2023-05-21" -> "2023-05-21"
  s = String(s || '').trim(); let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3], mo = +m[2], d = +m[1]; return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad2(mo)}-${pad2(d)}` : null; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const fmtD = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
function addMonths(iso, n) { const [y, m, d] = iso.split('-').map(Number), t = new Date(y, m - 1 + n, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(Math.min(d, last))}`; }
function monthsSince(iso) { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number), n = new Date(); let k = (n.getFullYear() - y) * 12 + n.getMonth() - (m - 1); if (n.getDate() < d) k--; return Math.max(0, k); }
const UNITS = { j: ['jour', 'jours', 'j'], s: ['semaine', 'semaines', 'sem.'], m: ['mois', 'mois', 'mois'], a: ['an', 'ans', 'an'] };
const durTxt = md => `${md.n} ${UNITS[md.u || 'm'][md.n > 1 ? 1 : 0]}`;
const durShort = md => (md.u || 'm') === 'm' ? String(md.n) : md.n + ({ j: 'j', s: 's', a: 'a' })[md.u];
function addDur(iso, md) { const u = md.u || 'm', n = +md.n || 0; if (u === 'm' || u === 'a') return addMonths(iso, u === 'a' ? n * 12 : n); const [y, m, d] = iso.split('-').map(Number), t = new Date(y, m - 1, d + (u === 's' ? 7 * n : n)); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; }
const daysUntil = iso => Math.ceil((new Date(iso + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 864e5);
const anc = iso => { const k = monthsSince(iso); return k == null ? '—' : k < 12 ? `${k} mois` : `${Math.floor(k / 12)} an${k >= 24 ? 's' : ''}${k % 12 ? ` ${k % 12} mois` : ''}`; };
const uOpts = sel => Object.entries(UNITS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v[1]}</option>`).join('');
function medState(a, md) { // { earned: date d'obtention ou null, due: date prévue (rubans), given: remis le (timestamp) }
  const aw = S.awards?.[a.id]?.[md.id];
  if (md.n) { const due = a.arr ? addDur(a.arr, md) : null; return { earned: due && due <= todayIso() ? due : null, due, given: aw?.given || null }; }
  return { earned: aw?.at || null, due: null, given: aw ? aw.given || aw.t || 1 : null };
}
const medIcon = (md, cls = '') => md.img ? `<img class="mic ${cls}" src="${md.img}" alt="${esc(md.name)}" title="${esc(md.name)}">`
  : `<span class="mic rib ${cls}" style="--c:${esc(md.color || '#b8a47c')}" title="${esc(md.name)}">${md.n ? `<i>${durShort(md)}</i>` : ''}</span>`;
function agentMedals(a) { return S.medals.map(md => ({ md, s: medState(a, md) })).filter(o => o.s.earned); }
const medRow = a => agentMedals(a).map(({ md, s }) => s.given ? medIcon(md) : `<span class="mpend" title="${esc(md.name)} — obtenu le ${fmtD(s.earned)}, pas encore remis">${medIcon(md)}</span>`).join('') || '<span class="note">—</span>';

// --- Google Sheet : lecture CSV, analyse, aperçu des changements ---
function csvParse(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const gkey = s => norm(s).replace(/\biii\b/g, '3').replace(/\bii\b/g, '2').replace(/\biv\b/g, '4').replace(/\bchief\b/g, 'chef').replace(/\b(du|de|des|la|le)\b/g, '').replace(/[^a-z0-9]/g, '');
const mapG = name => { const m = S.sheet.gmap || {}; if (name in m) return m[name] || null; return S.grades.find(g => gkey(g) === gkey(name)) || null; };
function sheetRecords(rows) {
  const h = rows.findIndex(r => r.some(c => norm(c) === 'matricule') && r.some(c => norm(c) === 'prenom'));
  if (h < 0) throw new Error(`Ligne d’en-tête introuvable : les colonnes « Matricule » et « Prénom » n’apparaissent pas dans les ${rows.length} ligne(s) lues. Si tes agents sont dans un autre onglet du Sheet, renseigne le gid (le nombre après « gid= » dans l’adresse quand cet onglet est ouvert).`);
  const H = rows[h].map(c => norm(c)), col = (...k) => H.findIndex(x => k.includes(x));
  const C = { mat: col('matricule'), grade: col('grade'), pre: col('prenom'), nom: col('nom'), did: col('id discord', 'discord', 'id discord '), dis: col('district') };
  if (C.pre < 0 || C.nom < 0) throw new Error('Colonnes « Prénom » et « Nom » introuvables.');
  const known = new Set(Object.values(C)), dcols = rows[h].map((c, j) => ({ j, name: c.trim() })).filter(o => o.name && !known.has(o.j) && (mapG(o.name) || S.grades.some(g => gkey(g) === gkey(o.name)) || /^(rookie|officier|slo|sergent|lieutenant|capitaine)/i.test(o.name)));
  const recs = [];
  for (const r of rows.slice(h + 1)) {
    const pre = (r[C.pre] || '').trim(), nom = (r[C.nom] || '').trim(); if (!pre && !nom) continue;
    const dates = {}; dcols.forEach(o => { const d = frDate(r[o.j]); if (d) dates[o.name] = d; });
    recs.push({ mat: (r[C.mat] || '').trim(), grade: (r[C.grade] || '').trim(), pre, nom, did: (r[C.did] || '').trim(), dis: C.dis >= 0 ? (r[C.dis] || '').trim() : '', dates });
  }
  return { recs, hasDistrict: C.dis >= 0, dcols: dcols.map(o => o.name) };
}
let syncP = null; // aperçu en cours { items, unknown, stats }
function buildPreview(parsed) {
  const want = norm(S.sheet.district || ''), recs = parsed.recs.filter(r => !want || !parsed.hasDistrict || norm(r.dis) === want);
  const ign = recs.filter(r => ignR(r.grade) || ignR(mapG(r.grade))), keep = recs.filter(r => !ign.includes(r));
  if (!keep.length) throw new Error(`Aucun agent avec le district « ${S.sheet.district} » dans le Sheet.`);
  const items = [], used = new Set(), unknown = new Set(), low = [...S.grades].reverse().find(g => !ignR(g)) || S.grades.at(-1);
  for (const r of keep) {
    const nm = norm(r.pre + ' ' + r.nom);
    const a = S.agents.find(x => !used.has(x.id) && norm(full(x)) === nm) || S.agents.find(x => !used.has(x.id) && r.mat && x.mat && x.mat !== '-' && x.mat === r.mat) || S.agents.find(x => !used.has(x.id) && r.did && x.did === r.did);
    const g = r.grade ? mapG(r.grade) : null; if (r.grade && !g && !(r.grade in (S.sheet.gmap || {}))) unknown.add(r.grade);
    const arr = Object.values(r.dates).sort()[0] || null;
    if (!a) { items.push({ k: 'create', r, g: g || low, arr, on: true }); continue; }
    used.add(a.id);
    if (a.arch) items.push({ k: 'unarch', a, r, on: true });
    if (g && g !== a.grade && !hiddenA(a)) items.push({ k: 'grade', a, r, from: a.grade, to: g, on: true });
    if (r.mat && r.mat !== a.mat) items.push({ k: 'mat', a, r, from: a.mat, to: r.mat, on: true });
    if (arr && arr !== a.arr) items.push({ k: 'arr', a, r, from: a.arr, to: arr, on: true });
    items.push({ k: 'quiet', a, r, on: true }); // ID Discord + dates de grade (sans affichage)
  }
  actv().filter(a => !used.has(a.id) && !ignR(a.grade)).forEach(a => items.push({ k: 'arch', a, on: true })); // Patron, Sheriff… : jamais archivés automatiquement
  syncP = { items, unknown: [...unknown], nIgn: ign.length, nRec: keep.length, dcols: parsed.dcols };
}
async function doSync() {
  { const u = ($('#murl')?.value || '').trim(); if (u && u !== S.sheet.url) { S.sheet.url = u; const g = (u.match(/[#&?]gid=(\d+)/) || [])[1]; if (g) S.sheet.gid = g; save(); } } // lien du champ, même s'il n'est pas encore enregistré
  if (!S.sheet.url) { await dlg({ title: 'Lien manquant', msg: 'Colle d’abord le lien de ton Google Sheet.', cancel: null, icon: 'warn' }); return; }
  $('#msync').disabled = true; $('#msync').textContent = 'Lecture du Sheet…';
  try {
    const r = await api('GET', '/api/sheet?url=' + encodeURIComponent(S.sheet.url) + (S.sheet.gid ? '&gid=' + encodeURIComponent(S.sheet.gid) : ''));
    if (!r.ok) throw new Error(r.json?.error || 'Erreur serveur');
    const raw = sheetRecords(csvParse(r.json.csv)); buildPreview(raw); syncP.raw = raw;
  } catch (e) { syncP = null; await dlg({ title: 'Synchronisation impossible', msg: e.message + (admin ? '\n\nPour voir le détail de chaque étape, ouvre la page diagnostic.php de ton site.' : ''), cancel: null, icon: 'warn' }); }
  render();
}
function applySync() {
  const low = [...S.grades].reverse().find(g => !ignR(g)) || S.grades.at(-1); let n = 0;
  for (const it of syncP.items) {
    if (!it.on) continue; const r = it.r;
    const gd = r ? Object.fromEntries(Object.entries(r.dates).map(([k, v]) => [mapG(k) || k, v])) : null;
    if (it.k === 'create') { const na = { id: uid(), mat: r.mat || '-', prenom: r.pre, nom: r.nom, grade: it.g, w: S.weeks.map(() => null), arr: it.arr, gdates: gd, did: r.did || undefined }; S.agents.push(na); logGrade(na, null, na.grade, 'création (Google Sheet)'); n++; }
    else if (it.k === 'unarch') { delete it.a.arch; n++; }
    else if (it.k === 'grade') { logGrade(it.a, it.a.grade, it.to, 'Google Sheet'); it.a.grade = it.to; n++; }
    else if (it.k === 'mat') { it.a.mat = it.to; n++; }
    else if (it.k === 'arr') { it.a.arr = it.to; n++; }
    else if (it.k === 'arch') { it.a.arch = { t: Date.now(), w: lastW(), why: 'Absent du Google Sheet (district ' + S.sheet.district + ')' }; n++; }
    else if (it.k === 'quiet') { if (r.did) it.a.did = r.did; if (gd && Object.keys(gd).length) it.a.gdates = gd; }
  }
  S.sheet.last = Date.now(); syncP = null; upd();
  return n;
}
const SYNC_L = { create: ['Nouveaux agents', 'up'], unarch: ['Réintégrés (de retour dans le Sheet)', 'up'], grade: ['Changements de grade', ''], mat: ['Matricules', ''], arr: ['Dates d’arrivée', ''], arch: ['À archiver (absents du Sheet ou plus dans le district)', 'down'] };
function previewHtml() {
  const P = syncP, groups = Object.keys(SYNC_L).map(k => [k, P.items.map((it, i) => ({ it, i })).filter(o => o.it.k === k)]).filter(([, L]) => L.length);
  const line = ({ it, i }) => {
    const who = it.a ? esc(full(it.a)) : `${esc(it.r.pre)} ${esc(it.r.nom)}`, d = it.k === 'create' ? `${badge(it.g)} · ${esc(it.r.mat || '-')}${it.arr ? ' · arrivé le ' + fmtD(it.arr) : ''}`
      : it.k === 'grade' ? `${badge(it.from)} → ${badge(it.to)}` : it.k === 'mat' ? `${esc(it.from)} → <b>${esc(it.to)}</b>` : it.k === 'arr' ? `${fmtD(it.from)} → <b>${fmtD(it.to)}</b>` : it.k === 'arch' ? badge(it.a.grade) : '';
    return `<label class="spi"><input type="checkbox" data-a="mchk" data-i="${i}" ${it.on ? 'checked' : ''}><span class="spn">${who}</span><span class="spd">${d}</span></label>`;
  };
  return `<div class="sprev"><div class="ph"><h2>Aperçu de la synchronisation</h2><span class="note">${P.nRec} agent(s) du district dans le Sheet${P.nIgn ? ` · ${P.nIgn} ignoré(s) (rang masqué)` : ''}${P.dcols.length ? ` · dates lues : ${P.dcols.map(esc).join(', ')}` : ''}</span></div>` +
    (P.unknown.length ? `<div class="spg warn"><h3 class="sub">Grades du Sheet inconnus du site</h3>${P.unknown.map(g => `<div class="frm"><span class="tag">${esc(g)}</span><span class="note">→</span><select data-a="mgmap" data-g="${esc(g)}"><option value="">Choisir le grade du site…</option>${S.grades.map(x => `<option>${esc(x)}</option>`).join('')}<option value="__new">➕ Créer « ${esc(g)} »</option><option value="__ign">Ignorer ce grade</option></select></div>`).join('')}</div>` : '') +
    (groups.length ? groups.map(([k, L]) => `<div class="spg ${SYNC_L[k][1]}"><h3 class="sub">${SYNC_L[k][0]} <span class="note">(${L.length})</span></h3>${L.map(line).join('')}</div>`).join('') : '<p class="note">Tout est déjà à jour.</p>') +
    `<div class="frm"><button class="btn gold" data-a="mapply">Appliquer les changements cochés</button><button class="btn ghost" data-a="mcancel">Annuler</button></div></div>`;
}
let mq = '';
function vMed(part) {
  const ed = can('medalEdit'), list = byGrade(actv()).filter(a => !mq || norm(full(a) + ' ' + a.mat + ' ' + a.grade).includes(norm(mq)));
  const due = []; actv().forEach(a => S.medals.forEach(md => { const s = medState(a, md); if (md.n && s.earned && !s.given) due.push({ a, md, s }); }));
  due.sort((p, q) => p.s.earned.localeCompare(q.s.earned));
  const manual = S.medals.filter(m => !m.n);
  const syncPanel = can('sheetSync') ? `<section class="panel"><div class="ph"><h2>Synchronisation Google Sheet</h2><span class="note">${S.sheet.last ? 'Dernière synchro : ' + new Date(S.sheet.last).toLocaleString('fr-FR') : 'Jamais synchronisé'}</span></div>
    <p class="note">Met à jour les agents (création, grade, matricule, date d’arrivée) et archive ceux qui ne sont plus dans le district. Un aperçu s’affiche avant d’appliquer. Le Sheet doit être partagé « Tous les utilisateurs disposant du lien ».</p>
    <div class="frm"><input id="murl" data-a="murl" style="flex:1" placeholder="Lien du Google Sheet (https://docs.google.com/spreadsheets/d/…)" value="${esc(S.sheet.url || '')}"><input data-a="mgid" style="width:150px" placeholder="gid de l’onglet (option.)" value="${esc(S.sheet.gid || '')}" title="Numéro après « gid= » dans l’adresse quand l’onglet est ouvert"><input data-a="mdist" style="width:170px" placeholder="District" value="${esc(S.sheet.district || '')}" title="Seuls les agents de ce district sont pris en compte"><button class="btn gold" id="msync" data-a="msync">Synchroniser</button></div>
    ${syncP?.items ? previewHtml() : ''}</section>` : '';
  const dueP = `<section class="panel"><div class="ph"><h2>Rubans à remettre <span class="note">(${due.length})</span></h2>${ed && due.length ? '<button class="btn ghost" data-a="mgiveall">Tout marquer comme remis</button>' : ''}</div>` + (due.length ? `<div class="wrapt"><table><thead><tr><th>Agent</th><th>Ruban</th><th>Obtenu le</th><th></th></tr></thead><tbody>` +
    due.map(({ a, md, s }) => `<tr><td>${esc(full(a))} ${badge(a.grade)}</td><td><span class="mrow">${medIcon(md)} ${esc(md.name)}</span></td><td class="mono">${fmtD(s.earned)}</td><td class="acts">${ed ? `<button class="btn ghost" data-a="mgive" data-id="${a.id}" data-m="${md.id}">Remis ✓</button>` : ''}</td></tr>`).join('') + `</tbody></table></div>` : '<p class="note">Aucun ruban en attente de remise.</p>') + `</section>`;
  const cat = `<section class="panel"><div class="ph"><h2>Médailles & rubans</h2><span class="note">Rubans : attribués automatiquement selon l’ancienneté (date d’arrivée). Médailles : attribuées à la main.</span></div><div class="mcat">` +
    S.medals.map(md => { const n = actv().filter(a => medState(a, md).earned).length; return `<div class="mcard2">${medIcon(md, 'big')}<div class="mci">${ed ? `<input data-a="mname" data-id="${md.id}" value="${esc(md.name)}">` : `<b>${esc(md.name)}</b>`}
      <div class="frm">${ed ? `<select data-a="mauto" data-id="${md.id}"><option value="0" ${md.n ? '' : 'selected'}>Attribution manuelle</option><option value="1" ${md.n ? 'selected' : ''}>Ancienneté</option></select>${md.n ? `<input type="number" min="1" class="mdn" data-a="mn" data-id="${md.id}" value="${md.n}"><select data-a="mu" data-id="${md.id}">${uOpts(md.u || 'm')}</select>` : ''}` : `<span class="note">${md.n ? `Ancienneté ${durTxt(md)}` : 'Attribution manuelle'}</span>`}<span class="note">${n} agent(s)</span></div>
      ${ed ? `<div class="frm">${md.img ? '' : `<input type="color" class="col" data-a="mcolor" data-id="${md.id}" value="${md.color || '#b8a47c'}" title="Couleur (sans image)">`}<label class="btn ghost">${md.img ? 'Changer l’image' : 'Image…'}<input type="file" accept="image/*" data-a="mimg" data-id="${md.id}" hidden></label>${md.img ? `<button class="btn ghost" data-a="mimgdel" data-id="${md.id}">Retirer l’image</button>` : ''}<button class="btn del" data-a="mdel" data-id="${md.id}">Supprimer</button></div>` : ''}</div></div>`; }).join('') + `</div>` +
    (ed ? `<div class="frm" style="margin-top:12px"><input id="mnn" placeholder="Nouvelle médaille (ex : Médaille du mérite)"><select id="mnt"><option value="0">Attribution manuelle</option><option value="1">Ancienneté</option></select><input id="mnn2" type="number" min="1" class="mdn" placeholder="Durée" title="Durée d’ancienneté"><select id="mnu">${uOpts('m')}</select><button class="btn gold" data-a="madd">Ajouter</button></div>` : '') + `</section>`;
  const tbl = `<section class="panel"><div class="ph"><h2>Agents</h2><input id="mq" placeholder="Rechercher…" value="${esc(mq)}" style="width:260px"></div><div class="wrapt"><table><thead><tr><th>Agent</th><th>Arrivée</th><th>Ancienneté</th><th>Médailles & rubans</th><th>Prochain ruban</th>${ed && manual.length ? '<th>Attribuer</th>' : ''}</tr></thead><tbody id="mtb">` +
    list.map(a => { const nx = S.medals.filter(m => m.n).map(md => ({ md, s: medState(a, md) })).filter(o => o.s.due && !o.s.earned).sort((p, q) => p.s.due.localeCompare(q.s.due))[0];
      return `<tr><td>${esc(full(a))} ${badge(a.grade)}</td><td>${ed ? `<input type="date" class="cin" data-a="marr" data-id="${a.id}" value="${a.arr || ''}">` : fmtD(a.arr)}</td><td class="mono">${anc(a.arr)}</td><td><span class="mrow">${medRow(a)}${ed ? agentMedals(a).filter(o => !o.md.n).map(o => `<button class="mx" data-a="munaward" data-id="${a.id}" data-m="${o.md.id}" title="Retirer « ${esc(o.md.name)} »">✕</button>`).join('') : ''}</span></td>
        <td>${nx ? `<span class="mrow">${medIcon(nx.md, 'sm')} <span class="note">dans ${daysUntil(nx.s.due)} j (${fmtD(nx.s.due)})</span></span>` : a.arr ? '<span class="note">tous obtenus</span>' : '<span class="note">date d’arrivée inconnue</span>'}</td>
        ${ed && manual.length ? `<td><select class="cin" data-a="maward" data-id="${a.id}"><option value="">+ Médaille…</option>${manual.filter(m => !medState(a, m).earned).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></td>` : ''}</tr>`; }).join('') + `</tbody></table></div>${list.length ? '' : '<p class="note">Aucun agent.</p>'}</section>`;
  return part === 'admin' ? syncPanel + cat : dueP + tbl;
}
function vMda() { return vMed('admin'); }
function vMedMain() {
  return vMed('main') + (can('medalEdit') || can('sheetSync') ? '<p class="note">Catalogue des médailles et synchronisation Google Sheet : Administration › Gestion des médailles.</p>' : '');
}
function medImg(file) { // image redimensionnée (96 px max) pour rester légère dans la base
  return new Promise((ok, no) => { const fr = new FileReader(); fr.onerror = no; fr.onload = () => { const im = new Image(); im.onerror = no; im.onload = () => {
    const k = Math.min(1, 96 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); const w = c.toDataURL('image/webp', .9); ok(w.startsWith('data:image/webp') ? w : c.toDataURL('image/png')); }; im.src = fr.result; }; fr.readAsDataURL(file); });
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el) return; const act = el.dataset.a, id = el.dataset.id;
  if (['msync', 'mapply', 'mcancel'].includes(act) && !can('sheetSync')) return;
  if (['mgive', 'mgiveall', 'madd', 'mdel', 'mimgdel', 'munaward'].includes(act) && !can('medalEdit')) return;
  const aw = (aid, mid) => (((S.awards ||= {})[aid] ||= {})[mid] ||= {});
  if (act === 'msync') doSync();
  else if (act === 'mcancel') { syncP = null; render(); }
  else if (act === 'mapply') { const n = syncP.items.filter(i => i.on && i.k !== 'quiet').length; if (await dlg({ title: 'Appliquer la synchronisation', msg: `Appliquer ${n} changement(s) ?`, ok: 'Appliquer', icon: 'warn' })) { applySync(); await dlg({ title: 'Synchronisation terminée', msg: `${n} changement(s) appliqué(s).`, cancel: null, icon: 'info' }); } }
  else if (act === 'mgive') { aw(id, el.dataset.m).given = Date.now(); upd(); }
  else if (act === 'mgiveall') { if (await dlg({ title: 'Rubans remis', msg: 'Marquer tous les rubans en attente comme remis ?', ok: 'Confirmer' })) { actv().forEach(a => S.medals.forEach(md => { const s = medState(a, md); if (md.n && s.earned && !s.given) aw(a.id, md.id).given = Date.now(); })); upd(); } }
  else if (act === 'madd') { const n = $('#mnn').value.trim(); if (!n) return; const auto = $('#mnt').value === '1', dn = Math.round(+$('#mnn2').value); if (auto && !(dn > 0)) { await dlg({ title: 'Durée manquante', msg: 'Indique la durée d’ancienneté (nombre supérieur à 0).', cancel: null, icon: 'warn' }); return; } S.medals.push({ id: uid() + uid(), name: n, ...(auto ? { n: dn, u: $('#mnu').value } : {}), color: RIB_COLORS[S.medals.length % RIB_COLORS.length], img: '' }); upd(); }
  else if (act === 'mdel') { const md = S.medals.find(x => x.id === id); if (md && await dlg({ title: 'Supprimer', msg: `Supprimer « ${md.name} » ? Les attributions de cette médaille seront perdues.`, ok: 'Supprimer', danger: true })) { S.medals = S.medals.filter(x => x !== md); Object.values(S.awards || {}).forEach(o => delete o[id]); upd(); } }
  else if (act === 'mimgdel') { S.medals.find(x => x.id === id).img = ''; upd(); }
  else if (act === 'munaward') { const md = S.medals.find(x => x.id === el.dataset.m); if (await dlg({ title: 'Retirer la médaille', msg: `Retirer « ${md?.name} » à cet agent ?`, ok: 'Retirer', danger: true })) { delete S.awards?.[id]?.[el.dataset.m]; upd(); } }
});
document.addEventListener('change', async e => {
  const el = e.target, act = el.dataset.a, id = el.dataset.id; if (!act || !/^m/.test(act)) return;
  if (['murl', 'mgid', 'mdist', 'mgmap', 'mchk'].includes(act) && !can('sheetSync')) return;
  if (['mname', 'mauto', 'mn', 'mu', 'mcolor', 'mimg', 'marr', 'maward'].includes(act) && !can('medalEdit')) return;
  if (act === 'murl') { S.sheet.url = el.value.trim(); const g = (S.sheet.url.match(/[#&?]gid=(\d+)/) || [])[1]; if (g) S.sheet.gid = g; upd(); }
  else if (act === 'mgid') { S.sheet.gid = el.value.trim().replace(/\D/g, ''); save(); }
  else if (act === 'mdist') { S.sheet.district = el.value.trim(); save(); }
  else if (act === 'mchk') { syncP.items[+el.dataset.i].on = el.checked; }
  else if (act === 'mgmap') {
    const g = el.dataset.g, v = el.value; if (!v) return;
    if (v === '__new') { if (!S.grades.includes(g)) S.grades.push(g); (S.sheet.gmap ||= {})[g] = g; }
    else (S.sheet.gmap ||= {})[g] = v === '__ign' ? '' : v;
    save(); try { buildPreview(syncP.raw); } catch (x) {} render();
  }
  else if (act === 'mname') { const md = S.medals.find(x => x.id === id); if (el.value.trim()) md.name = el.value.trim(); upd(); }
  else if (act === 'mauto') { const md = S.medals.find(x => x.id === id); if (el.value === '1') { md.n = md.n || 1; md.u = md.u || 'm'; } else { delete md.n; delete md.u; } upd(); }
  else if (act === 'mn') { const v = Math.round(+el.value); if (v > 0) { S.medals.find(x => x.id === id).n = v; upd(); } else render(); }
  else if (act === 'mu') { S.medals.find(x => x.id === id).u = el.value; upd(); }
  else if (act === 'mcolor') { S.medals.find(x => x.id === id).color = el.value; upd(); }
  else if (act === 'mimg') { const f = el.files[0]; if (!f) return; try { S.medals.find(x => x.id === id).img = await medImg(f); upd(); } catch (x) { await dlg({ title: 'Image illisible', msg: 'Ce fichier n’est pas une image valide.', cancel: null, icon: 'warn' }); } }
  else if (act === 'marr') { const a = S.agents.find(x => x.id === id); a.arr = el.value || undefined; upd(); }
  else if (act === 'maward') { if (!el.value) return; ((S.awards ||= {})[id] ||= {})[el.value] = { at: todayIso(), given: Date.now() }; upd(); }
});
document.addEventListener('input', e => { if (e.target.id === 'mq') { mq = e.target.value; const t = $('#mtb'); if (t) { render(); const i = $('#mq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } });

// ---------- statistiques agent ----------
let st = { id: null, f: 0, t: null, q: '' };
const lastW = () => S.weeks.length - 1;
const aSt = (a, f, t) => { const v = a.w.slice(f, t + 1), k = v.filter(x => x != null), sum = k.reduce((x, y) => x + y, 0); return { v, k, n: k.length, sum, avg: k.length ? sum / k.length : 0, act: k.filter(x => x > 0).length, best: k.length ? Math.max(...k) : null, low: k.length ? Math.min(...k) : null, last: k.length ? k.at(-1) : null }; };
const initials = a => ((a.prenom || '')[0] || '') + ((a.nom || '')[0] || '');
const Fd = m => (m < 0 ? '−' : '+') + F(Math.abs(Math.round(m)));
function aListHtml() {
  const q = norm(st.q), L = byGrade(st.arch ? S.agents.filter(a => a.arch) : actv()).filter(a => !q || norm(full(a) + ' ' + a.mat + ' ' + a.grade).includes(q)), lw = lastW();
  return L.map(a => `<button type="button" class="ai${a.id === st.id ? ' on' : ''}" data-a="sagent" data-id="${a.id}" style="--c:${gradeColor(a.grade)}"><span class="av">${esc(initials(a))}</span><span class="ai-n"><b>${esc(full(a))}</b><span>${badge(a.grade)}${a.mat && a.mat !== '-' ? `<small class="mono">${esc(a.mat)}</small>` : ''}</span></span>${a.arch ? '<span class="tag">archivé</span>' : ''}<span class="ai-h mono" title="Semaine du ${S.weeks[lw]}">${F(a.w[lw])}</span></button>`).join('') || '<p class="note">Aucun agent.</p>';
}
function chartSvg(a, f, t, avg) {
  const n = t - f + 1, W = Math.max(1000, n * 46 + 70), H = 280, L = 52, R = 16, B = 34, T = 26, pw = W - L - R, ph = H - B - T, slot = pw / n, bw = Math.min(46, slot * .56);
  const vals = a.w.slice(f, t + 1), mx = Math.max(60, ...vals.map(v => v || 0), avg || 0) / 60;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find(x => mx / x <= 5) || 100, top = Math.ceil(mx / step) * step || step, y = h => T + ph - (h / top) * ph;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Heures par semaine"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--acc2)"/><stop offset="1" stop-color="var(--acc)" stop-opacity=".75"/></linearGradient></defs>`;
  for (let h = 0; h <= top; h += step) { const yy = y(h); s += `<line class="ch-g${h ? '' : ' z'}" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="ch-t" x="${L - 10}" y="${yy + 4}" text-anchor="end">${h}h</text>`; }
  vals.forEach((v, i) => {
    const cx = L + slot * i + slot / 2, wk = S.weeks[f + i];
    if (v == null) s += `<circle class="ch-n" cx="${cx}" cy="${y(0) - 4}" r="3"><title>${wk} : pas de donnée</title></circle>`;
    else { const hh = Math.max(v > 0 ? 3 : 0, y(0) - y(v / 60)); s += `<rect class="ch-b" x="${cx - bw / 2}" y="${y(0) - hh}" width="${bw}" height="${hh}" rx="6"><title>${wk} : ${F(v)}</title></rect>`;
      if (n <= 20) s += `<text class="ch-v" x="${cx}" y="${y(0) - hh - 7}" text-anchor="middle">${F(v)}</text>`; }
    if (n <= 20 || i % Math.ceil(n / 20) === 0) s += `<text class="ch-t" x="${cx}" y="${H - 10}" text-anchor="middle">${wk}</text>`;
  });
  if (avg != null) { const ya = y(avg / 60); s += `<line class="ch-a" x1="${L}" x2="${W - R}" y1="${ya}" y2="${ya}"/><rect class="ch-ab" x="${W - R - 104}" y="${ya - 22}" width="104" height="18" rx="9"/><text class="ch-at" x="${W - R - 52}" y="${ya - 9}" text-anchor="middle">moy. ${F(Math.round(avg))}</text>`; }
  return s + '</svg>';
}
function gradeHistory(a) { // changements de grade : création / modifications manuelles (journal) + décisions de cérémonie
  const it = (S.glog || []).filter(g => g.agent === a.id).map(g => ({ w: g.w, t: g.t, from: g.from, to: g.to, src: g.src, why: '', st: 'ok' }));
  S.weeks.forEach((wk, j) => { const d = S.ceremonies[wk]?.[a.id]; if (d?.a) { const x = S.actions.find(y => y.id === d.a); it.push({ w: j, t: 0, from: d.from || a.grade, to: d.g || a.grade, src: x ? x.label : 'Cérémonie', why: d.r || '', st: d.done ? 'ok' : 'prevu' }); } });
  return it.sort((p, q) => p.w - q.w || (p.src === 'création' ? -1 : 0) - (q.src === 'création' ? -1 : 0));
}
function staDetail(a) {
  const last = lastW(), f = Math.min(st.f ?? 0, last), t = Math.min(st.t ?? last, last), s = aSt(a, f, t), all = aSt(a, 0, last);
  const pool = actv().map(x => ({ x, s: aSt(x, f, t) })).filter(o => o.s.n).sort((p, q) => q.s.avg - p.s.avg);
  const rank = a.arch ? 0 : pool.findIndex(o => o.x.id === a.id) + 1, davg = pool.length ? pool.reduce((x, o) => x + o.s.avg, 0) / pool.length : 0, first = a.w.findIndex(x => x != null);
  const k = s.k, trend = k.length >= 6 ? k.slice(-3).reduce((x, y) => x + y, 0) / 3 - k.slice(-6, -3).reduce((x, y) => x + y, 0) / 3 : null;
  const big = (l, v, sub, cls = '') => `<div class="sk big ${cls}"><span>${l}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const card = (l, v, cls = '') => `<div class="sk ${cls}" title="${esc(l)}"><span>${l}</span><b>${v}</b></div>`;
  const hist = gradeHistory(a), n0 = t - f + 1;
  const cer = S.weeks.map((wk, j) => ({ wk, j, d: S.ceremonies[wk]?.[a.id] })).filter(o => o.d && (o.d.a || o.d.sanction || o.d.casiers || o.d.fps || o.d.f1020 || o.d.fus || o.d.abs || o.d.r || o.d.notes));
  const yes = v => v ? '<span class="ok">✓</span>' : '<span class="note">—</span>', nS = cer.filter(o => o.d.sanction).length, nA = cer.filter(o => o.d.abs).length;
  const wk = [...Array(n0).keys()].map(i => f + i).reverse();
  const preset = [[0, 'Tout'], [4, '4 sem.'], [8, '8 sem.'], [12, '12 sem.']].map(([nn, l]) => { const on = nn ? f === Math.max(0, last - nn + 1) && t === last && last - nn + 1 >= 0 : f === 0 && t === last; return `<button class="seg${on ? ' on' : ''}" data-a="sper" data-n="${nn}">${l}</button>`; }).join('');
  const chip = (l, v) => `<span class="chip"><small>${l}</small>${v}</span>`;
  return `<section class="panel hero" style="--c:${gradeColor(a.grade)}"><div class="hero-l"><span class="av big">${esc(initials(a))}</span><div class="hero-id"><h2>${esc(full(a))}</h2><div class="sub-l">${badge(a.grade)}${a.arch ? `<span class="tag">Archivé le ${archDate(a)}${a.arch.why ? ' · ' + esc(a.arch.why) : ''}</span>` : ''}${a.mat && a.mat !== '-' ? `<span class="mono note">Matricule ${esc(a.mat)}</span>` : ''}</div>
    <div class="chips">${a.arr ? chip('Arrivée', fmtD(a.arr) + ' · ' + anc(a.arr)) : ''}${chip('Premières heures', first < 0 ? '—' : 'sem. du ' + S.weeks[first])}${chip('Semaines suivies', all.n)}${chip('Total global', F(all.sum))}${chip('Moyenne globale', F(Math.round(all.avg)))}</div>${agentMedals(a).length ? `<div class="mrow hero-med">${medRow(a)}</div>` : ''}${a.gdates && Object.keys(a.gdates).length ? `<div class="note gdl">${Object.entries(a.gdates).sort((p, q) => p[1].localeCompare(q[1])).map(([g, d]) => `${esc(g)} : ${fmtD(d)}`).join(' · ')}</div>` : ''}</div></div>
    <div class="hero-r"><small class="lbl">Période analysée</small><div class="segs">${preset}</div><div class="per"><select id="pf">${wopts(f)}</select><span class="note">→</span><select id="pe">${wopts(t)}</select></div></div></section>
  <div class="skg big3">${big('Total sur la période', F(s.sum), `${s.n} semaine(s) avec données`, 'hi')}${big('Moyenne / semaine', F(Math.round(s.avg)), s.n ? `district : ${F(Math.round(davg))}` : '', 'hi')}${big('Classement', rank ? `${rank}<small> / ${pool.length}</small>` : '–', 'à la moyenne sur la période')}</div>
  <div class="skg">${card('Semaines actives', `${s.act}<small> / ${s.n}</small>`)}${card('Meilleure semaine', F(s.best))}${card('Plus faible', F(s.low))}${card('Dernière semaine', F(s.last))}${card('Tendance 3 sem.', trend == null ? '–' : Fd(trend), trend == null ? '' : trend >= 0 ? 'up' : 'down')}${card('Écart au district', s.n ? Fd(s.avg - davg) : '–', s.n ? (s.avg >= davg ? 'up' : 'down') : '')}</div>
  <section class="panel"><div class="ph"><h2>Heures par semaine</h2><span class="note">${S.weeks[f]} → ${S.weeks[t]}</span></div><div class="chartw">${chartSvg(a, f, t, s.n ? s.avg : null)}</div></section>
  <div class="s2">
  <section class="panel"><div class="ph"><h2>Historique des grades</h2><span class="note">actuel : ${badge(a.grade)}</span></div>${hist.length ? `<div class="tl">` + hist.map(h => `<div class="tli${h.st === 'prevu' ? ' pv' : ''}"><i></i><div><b>${h.from ? `${badge(h.from)} <span class="note">→</span> ${badge(h.to)}` : badge(h.to)}</b><span>${esc(h.src)}${h.st === 'prevu' ? ' · décision non appliquée' : ''} · sem. du ${S.weeks[h.w] ?? '?'}${h.t ? ' · ' + new Date(h.t).toLocaleDateString('fr-FR') : ''}</span>${h.why ? `<em>${esc(h.why)}</em>` : ''}</div></div>`).join('') + `</div>` : '<p class="note">Aucun changement de grade enregistré.</p>'}</section>
  <section class="panel"><div class="ph"><h2>Détail par semaine</h2></div><div class="wrapt"><table><thead><tr><th>Semaine</th><th>Heures</th><th>Écart moy.</th><th></th></tr></thead><tbody>` +
    wk.map(i => { const v = a.w[i], d = v == null || !s.n ? null : v - s.avg; return `<tr><td>${S.weeks[i]}</td><td class="hcell">${F(v)}</td><td class="hcell ${d == null ? '' : d >= 0 ? 'pos' : 'neg'}">${d == null ? '—' : Fd(d)}</td><td><span class="mini"><i style="width:${Math.min(100, (v || 0) / BAR_MAX * 100)}%"></i></span></td></tr>`; }).join('') + `</tbody></table></div></section>
  </div>
  <section class="panel"><div class="ph"><h2>Cérémonies & suivi</h2><span class="note">${cer.length} cérémonie(s) · ${nS} sanction(s) · ${nA} absence(s)</span></div>${cer.length ? `<div class="wrapt"><table><thead><tr><th>Semaine</th><th>Décision</th><th>Sanction</th><th>Casiers</th><th>Forma PS</th><th>Forma 10-20</th><th>Fusillade</th><th>Absence</th><th>Explication</th><th>Notes</th></tr></thead><tbody>` +
    cer.map(o => { const d = o.d, x = S.actions.find(y => y.id === d.a); return `<tr><td>${o.wk}</td><td>${x ? `${sym(x)} ${esc(x.label)}${d.g ? ` → ${esc(d.g)}` : ''}${d.done ? '' : ' <span class="note">(prévu)</span>'}` : '—'}</td><td>${esc(d.sanction || '—')}</td><td>${esc(d.casiers ?? '—')}</td><td>${yes(d.fps)}</td><td>${yes(d.f1020)}</td><td>${yes(d.fus)}</td><td>${yes(d.abs)}</td><td>${esc(d.r || '—')}</td><td>${esc(d.notes || '—')}</td></tr>`; }).join('') + `</tbody></table></div>` : '<p class="note">Aucune cérémonie avec des données pour cet agent.</p>'}</section>`;
}
function vSta() {
  if (st.id && !S.agents.some(a => a.id === st.id && !hiddenA(a))) st.id = null;
  const a = S.agents.find(x => x.id === st.id);
  return `<div class="sgrid"><section class="panel sl"><div class="ph"><h2>Agents</h2><span class="note">${(st.arch ? S.agents.filter(a => a.arch) : actv()).length} · h. sem. ${S.weeks[lastW()]}</span></div>${S.agents.some(a => a.arch) ? `<div class="segs" style="margin-bottom:10px"><button class="seg${st.arch ? '' : ' on'}" data-a="starch">En service</button><button class="seg${st.arch ? ' on' : ''}" data-a="starch">Archivés</button></div>` : ''}<input id="sas" placeholder="Rechercher (nom, grade, matricule)…" value="${esc(st.q)}" autocomplete="off"><div class="alist" id="alist">${aListHtml()}</div></section>
  <div class="sd">${a ? staDetail(a) : '<section class="panel"><h2>Sélectionne un agent</h2><p class="note">Choisis un agent dans la liste : tu verras toutes ses statistiques depuis le début du site — heures, moyennes sur la période de ton choix, changements de grade, sanctions et cérémonies.</p></section>'}</div></div>`;
}

// ---------- menus déroulants personnalisés : remplacent la liste native des <select> (le <select> reste en coulisses : valeur + événement change) ----------
const CHEV = '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>', CHECK = '<svg class="cs-chk" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
let csPop = null, csCur = null, csHl = -1;
function csClose() { if (csPop) { csPop.remove(); csPop = null; } if (csCur) { csCur.wrap.classList.remove('open'); csCur = null; } }
function csMark() { if (!csPop) return; [...csPop.children].forEach((o, i) => o.classList.toggle('hl', i === csHl)); csPop.children[csHl]?.scrollIntoView?.({ block: 'nearest' }); }
function csOpen(sel, wrap) {
  csClose(); csCur = { sel, wrap }; wrap.classList.add('open');
  const pop = csPop = document.createElement('div'); pop.className = 'cs-pop'; pop.setAttribute('role', 'listbox');
  pop.innerHTML = [...sel.options].map((o, i) => `<div class="cs-opt${i === sel.selectedIndex ? ' sel' : ''}${o.value === '' ? ' cs-ph' : ''}" role="option" data-i="${i}"><span>${esc(o.textContent)}</span>${CHECK}</div>`).join('');
  document.body.appendChild(pop);
  const r = wrap.getBoundingClientRect(); pop.style.minWidth = r.width + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  const below = innerHeight - r.bottom - 14, above = r.top - 14, h = Math.min(pop.scrollHeight + 2, 320);
  if (h > below && above > below) { pop.style.maxHeight = Math.min(320, above) + 'px'; pop.style.top = Math.max(8, r.top - Math.min(h, above) - 6) + 'px'; }
  else { pop.style.maxHeight = Math.min(320, below) + 'px'; pop.style.top = (r.bottom + 6) + 'px'; }
  csHl = sel.selectedIndex; csMark();
}
function csPick(i) {
  const { sel } = csCur; if (i < 0 || i >= sel.options.length) return;
  const changed = i !== sel.selectedIndex; sel.selectedIndex = i; sel._cs(); csClose();
  if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
}
function csBuild(sel, w) {
  sel.dataset.cs = '1'; sel.tabIndex = -1; sel.classList.add('cs-n');
  const wrap = document.createElement('div'); wrap.className = 'cs' + (/\b(cin|ein|hin)\b/.test(sel.className) ? ' cs-sm' : '');
  if (w > 0) wrap.style.width = w + 'px';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cs-btn'; btn.innerHTML = `<span class="cs-val"></span>${CHEV}`;
  if (sel.title) btn.title = sel.title;
  wrap.appendChild(btn); sel.after(wrap);
  const update = () => { const o = sel.options[sel.selectedIndex], v = btn.firstChild; v.textContent = o ? o.textContent : ''; v.classList.toggle('cs-ph', !!o && o.value === ''); };
  sel._cs = update; update();
  const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value'); // value = ... depuis le code met aussi l'affichage à jour
  Object.defineProperty(sel, 'value', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); update(); } });
  btn.addEventListener('click', () => (csCur && csCur.sel === sel) ? csClose() : csOpen(sel, wrap));
  btn.addEventListener('keydown', e => {
    const k = e.key, open = csCur && csCur.sel === sel, n = sel.options.length;
    if (k === 'Tab') return csClose();
    if (k === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); return csClose(); }
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(k)) {
      e.preventDefault();
      if (!open) return csOpen(sel, wrap);
      if (k === 'Enter' || k === ' ') return csPick(csHl);
      csHl = Math.max(0, Math.min(n - 1, csHl + (k === 'ArrowDown' ? 1 : -1))); csMark();
    } else if (open && (k === 'Home' || k === 'End')) { e.preventDefault(); csHl = k === 'Home' ? 0 : n - 1; csMark(); }
    else if (open && k.length === 1) { const q = norm(k), i = [...sel.options].findIndex((o, j) => j > csHl && norm(o.textContent.replace(/^[^\p{L}\p{N}]+/u, '')).startsWith(q)); if (i >= 0) { csHl = i; csMark(); } }
  });
}
function csEnhance() {
  const L = [...document.querySelectorAll('select:not([data-cs])')]; if (!L.length) return;
  const W = L.map(s => s.offsetWidth); L.forEach((s, i) => csBuild(s, W[i])); // mesures groupées puis construction (évite les reflows)
}
document.addEventListener('click', e => { const o = e.target.closest('.cs-opt'); if (o && csPop) csPick(+o.dataset.i); });
document.addEventListener('mousedown', e => { if (csPop && !e.target.closest('.cs-pop') && !e.target.closest('.cs')) csClose(); });
addEventListener('scroll', e => { if (csPop && !csPop.contains(e.target)) csClose(); }, true);
addEventListener('resize', csClose);
new MutationObserver(() => { csEnhance(); if (csCur && !document.contains(csCur.sel)) csClose(); }).observe(document.body, { childList: true, subtree: true });
csEnhance();
(() => { // écran de démarrage MathOS (non ignorable)
  const b = $('#boot'); if (!b) return;
  const L = ['Initialisation du noyau MathOS', 'Chargement du terminal MDT-07', 'Connexion au réseau SAMP', 'Synchronisation des effectifs', 'Vérification des accès', 'Terminal prêt'];
  const log = $('#blog'), bar = $('#bbar'); let i = 0, t;
  const lock = [...document.querySelectorAll('.app, #login, #dm')]; lock.forEach(x => x.inert = true); // rien n'est accessible pendant le chargement
  const finish = () => { lock.forEach(x => x.inert = false); b.classList.add('out'); setTimeout(() => b.remove(), 600); if (!$('#login').hidden) $('#lu').focus(); };
  const step = () => {
    if (i >= L.length) { t = setTimeout(finish, 350); return; }
    log.insertAdjacentHTML('beforeend', `<div><span class="ok">[ OK ]</span>${L[i]}</div>`);
    bar.style.width = (++i / L.length * 100) + '%'; t = setTimeout(step, 340);
  };
  t = setTimeout(step, 450);
})();
// mode clair / sombre (classe « light » sur <html>, mémorisée ; le script du <head> l'applique avant l'affichage)
const MKEY = KEY + '-mode'; let mode = 'dark'; try { mode = localStorage.getItem(MKEY) === 'light' ? 'light' : 'dark'; } catch (e) {}
const applyMode = () => { document.documentElement.classList.toggle('light', mode === 'light'); $('#mode').title = mode === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'; };
$('#mode').onclick = () => { mode = mode === 'light' ? 'dark' : 'light'; try { localStorage.setItem(MKEY, mode); } catch (e) {} applyMode(); };
applyMode();
const tick = () => { const d = new Date(); $('#clk').innerHTML = `<b>${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}<small>:${String(d.getSeconds()).padStart(2, '0')}</small></b><span>${d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span>`; };
tick(); setInterval(tick, 1000);
render();
document.addEventListener('focusout', () => { if (needRender) setTimeout(() => { if (needRender && !editing()) { needRender = false; render(); } }, 150); });
// Synchronisation économe (hébergement gratuit : nombre de requêtes limité) :
// toutes les 15 s quand on utilise le site, toutes les 60 s après 5 min sans activité, rien quand l'onglet est masqué.
let lastAct = Date.now(), lastSync = 0;
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { const was = Date.now() - lastAct > 3e5; lastAct = Date.now(); if (was) sync(); }, { passive: true }));
setInterval(() => { if (document.hidden) return; const gap = Date.now() - lastAct > 3e5 ? 60000 : 15000; if (Date.now() - lastSync >= gap) { lastSync = Date.now(); sync(); } }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastSync > 15000) { lastSync = Date.now(); sync(); } });
load();
