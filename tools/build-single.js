#!/usr/bin/env node
/* Bundles index.html + css + vendor/three + js/* into one self-contained file.
 *   node tools/build-single.js              -> dist/knockout-arena.html           (complete document)
 *   node tools/build-single.js --fragment   -> dist/knockout-arena.fragment.html  (<title> + <style> + body markup + scripts,
 *                                                                                  for hosts that supply their own <html>/<head>/<body>) */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const fragment = process.argv.includes('--fragment');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const css = (href) => '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8') + '\n</style>';
const js = (src) => '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script>/gi, '<\\/script>') + '\n</script>';

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (m, href) => css(href));
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => js(src));

let out = path.join(root, 'dist', 'knockout-arena.html');
if (fragment) {
  const title = (html.match(/<title>[\s\S]*?<\/title>/) || ['<title>Knockout Arena</title>'])[0];
  const fonts = (html.match(/<link[^>]+fonts\.googleapis[^>]*>/g) || []).join('\n');
  const styles = (html.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  html = [title, fonts, styles, body].join('\n');
  out = path.join(root, 'dist', 'knockout-arena.fragment.html');
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote', path.relative(root, out), (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
