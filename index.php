<?php
// Page d'accueil pour l'hébergement PHP : sert index.html en ajoutant la date de modification aux fichiers
// (app.js?v=…, style.css?v=…) pour que les navigateurs prennent toujours la dernière version après une mise à jour.
header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-cache, must-revalidate');
header("Content-Security-Policy: frame-ancestors 'self' https://*.fbfa.fr https://fbfa.fr https://cfx-nui-external-iframe nui://game nui:");
$h = file_get_contents(__DIR__ . '/index.html');
$h = preg_replace_callback('#(src|href)="((?:app|seed)\.js|style\.css)"#', function ($m) {
  $f = __DIR__ . '/' . $m[2]; return $m[1] . '="' . $m[2] . '?v=' . (is_file($f) ? filemtime($f) : time()) . '"';
}, $h);
// SDK du jeu (clavier, Échap, barre d'adresse) si l'hôte FolkOS est renseigné dans config.php ('folkosHost')
$cfg = is_file(__DIR__ . '/config.php') ? (include __DIR__ . '/config.php') : []; $fh = is_array($cfg) ? rtrim((string)($cfg['folkosHost'] ?? ''), '/') : '';
if ($fh && preg_match('#^https://[\w.-]+$#', $fh)) $h = str_replace('</head>', "<script src=\"$fh/fbfa-game.js\"></script>\n<script>window.FBFAGame && FBFAGame.init({ typing: { mode: 'field' }, escape: (location.ancestorOrigins || [])[0] !== " . json_encode($fh) . " });</script>\n<script src=\"$fh/fbfa-bridge.js\" async></script>\n</head>", $h);
echo $h;
