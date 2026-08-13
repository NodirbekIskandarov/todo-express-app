'use strict';

/**
 * To'liq yig'ish: ikonka -> o'rnatuvchi -> fleshkaga tayyor to'plam.
 *
 *   npm run dist
 *
 * Natija:
 *   release/Vazifalar-Setup-<versiya>.exe
 *   release/FLESHKAGA/          <- shu papkani fleshkaga ko'chirish kifoya
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\n[build] "${cmd} ${args.join(' ')}" muvaffaqiyatsiz tugadi.`);
    process.exit(r.status ?? 1);
  }
}

/* 1. Ikonka — faqat yo'q bo'lsa yasaladi. */
const icon = path.join(root, 'build', 'icon.ico');
if (!fs.existsSync(icon)) {
  console.log('[build] Ikonka yasalmoqda…');
  run('node', ['scripts/make-icon.js']);
}

/* 2. O'rnatuvchi. */
console.log('[build] O‘rnatuvchi yig‘ilmoqda…');
run('npx', ['--no-install', 'electron-builder', '--win']);

/* 3. Fleshkaga tayyor to'plam. */
const setupName = `Vazifalar-Setup-${pkg.version}.exe`;
const setup = path.join(root, 'release', setupName);
if (!fs.existsSync(setup)) {
  console.error(`[build] ${setupName} topilmadi.`);
  process.exit(1);
}

const out = path.join(root, 'release', 'FLESHKAGA');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(setup, path.join(out, setupName));

// Yo'riqnomadagi versiya raqami har doim haqiqiy fayl nomiga mos bo'lsin.
const text = fs.readFileSync(path.join(root, 'build', 'OQING.txt'), 'utf8')
  .replace(/Vazifalar-Setup-[\d.]+\.exe/g, setupName);
fs.writeFileSync(path.join(out, 'OQING.txt'), text, 'utf8');

const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(1);
console.log(`\n[build] Fleshkaga tayyor: ${out}`);
for (const f of fs.readdirSync(out)) {
  console.log(`         ${f.padEnd(30)} ${mb(path.join(out, f))} MB`);
}
console.log('\n         Shu papka ichidagi ikkala faylni fleshkaga ko‘chiring.');
