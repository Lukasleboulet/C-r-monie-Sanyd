<?php
// Page d'accueil pour l'hébergement PHP : sert index.html en ajoutant la date de modification aux fichiers
// (app.js?v=…, style.css?v=…) pour que les navigateurs prennent toujours la dernière version après une mise à jour.
header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-cache, must-revalidate');
$h = file_get_contents(__DIR__ . '/index.html');
echo preg_replace_callback('#(src|href)="((?:app|seed)\.js|style\.css)"#', function ($m) {
  $f = __DIR__ . '/' . $m[2]; return $m[1] . '="' . $m[2] . '?v=' . (is_file($f) ? filemtime($f) : time()) . '"';
}, $h);
