/**
 * setup.js
 * Create necessary folders and starter files for Seb-Unblocker V8
 *
 * Run: node setup.js
 *
 * This script:
 *  - creates logs/, public/, public/css, public/js, public/fonts, views/, proxy/
 *  - creates placeholder files (index.html skeleton, styles, waves, tabs.js)
 *  - creates empty logs/proxy.log
 */

const fs = require('fs');
const path = require('path');

const folders = [
  'logs',
  'public',
  'public/css',
  'public/js',
  'public/fonts',
  'views',
  'proxy'
];

const placeholders = [
  { file: 'logs/proxy.log', content: '# Proxy log\n' },
  { file: 'views/error.html', content:
`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proxy Error</title></head>
<body style="background:#010a0a;color:#00ff7f;display:flex;align-items:center;justify-content:center;height:100vh;">
  <div style="text-align:center"><h1>Proxy Error</h1><p>Something went wrong. Try again later.</p><a href="/" style="color:#010a0a;background:#00ff7f;padding:8px 12px;border-radius:6px;text-decoration:none">Home</a></div>
</body>
</html>` },
  { file: 'public/css/styles.css', content: '/* base styles - replace with your design */\nbody{font-family:Segoe UI, sans-serif;background:#010a0a;color:#00ff7f}\n' },
  { file: 'public/css/waves.css', content: '/* waves css placeholder */\n.wave{position:absolute}\n' },
  { file: 'public/js/tabs.js', content: '// tabs.js placeholder - replace with full implementation\n' },
  { file: 'public/js/search.js', content: '// search.js placeholder\n' },
  { file: 'public/js/iframeHandler.js', content: '// iframeHandler.js placeholder\n' },
  { file: 'public/index.html', content:
`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seb Unblocker</title>
<link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/waves.css"></head>
<body>
  <div class="wave"></div><div class="wave"></div><div class="wave"></div>
  <div id="tabBar"><button id="newTabBtn">+</button></div>
  <div class="container" id="tabContainer"></div>
  <script src="/js/tabs.js"></script>
  <script src="/js/search.js"></script>
  <script src="/js/iframeHandler.js"></script>
</body>
</html>` }
];

function ensureFolder(f) {
  if (!fs.existsSync(f)) {
    fs.mkdirSync(f, { recursive: true });
    console.log('Created folder:', f);
  }
}

function writeIfMissing(file, content) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, content, { encoding: 'utf8' });
    console.log('Created file:', file);
  } else {
    console.log('Exists:', file);
  }
}

async function runSetup() {
  console.log('Running setup for Seb-Unblocker V8...');
  for (const f of folders) ensureFolder(path.join(__dirname, f));
  for (const p of placeholders) writeIfMissing(p.file, p.content);

  // friendly reminder about fonts
  const fontNote = path.join(__dirname, 'public', 'fonts', 'README.txt');
  if (!fs.existsSync(fontNote)) {
    fs.writeFileSync(fontNote, 'Place seguisb.ttf here to use the Segoe UI Bold font.\n', 'utf8');
    console.log('Created public/fonts/README.txt - add seguisb.ttf here if you have it.');
  }

  console.log('Setup finished. Run `npm install` to install dependencies and `npm start` to run the server.');
}

if (require.main === module) runSetup();

module.exports = { runSetup };

