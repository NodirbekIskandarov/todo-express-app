'use strict';

/**
 * Dastur ikonkasini yasaydi: canvas'da chizib, ko'p o'lchamli .ico faylga yig'adi.
 * Ishga tushirish: node scripts/make-icon.js
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUT = path.join(__dirname, '..', 'build', 'icon.ico');

// Diqqat: o'q-funksiya qavs ichida bo'lishi shart, aks holda chaqirilmaydi va
// executeJavaScript funksiyani qaytarib, "could not be cloned" xatosi chiqadi.
const DRAW = `((sizes) => sizes.map((s) => {
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const r = s * 0.22;

  // Fon: binafsha gradient, yumaloq burchakli kvadrat
  const g = x.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#7c7ff5');
  g.addColorStop(1, '#4f52c9');
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(r, 0);
  x.arcTo(s, 0, s, s, r);
  x.arcTo(s, s, 0, s, r);
  x.arcTo(0, s, 0, 0, r);
  x.arcTo(0, 0, s, 0, r);
  x.closePath();
  x.fill();

  // Belgi: katta oq "galochka"
  x.strokeStyle = '#ffffff';
  x.lineWidth = Math.max(1.6, s * 0.115);
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(s * 0.26, s * 0.52);
  x.lineTo(s * 0.44, s * 0.70);
  x.lineTo(s * 0.76, s * 0.31);
  x.stroke();

  return c.toDataURL('image/png').split(',')[1];
}))(${JSON.stringify(SIZES)})`;

/** PNG bloklaridan Windows .ico konteynerini yig'adi. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // rezerv
  header.writeUInt16LE(1, 2);              // tur: ikonka
  header.writeUInt16LE(images.length, 4);  // nechta rasm

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  const parts = [];

  images.forEach(({ size, data }, i) => {
    const p = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, p);      // eni (256 → 0)
    dir.writeUInt8(size >= 256 ? 0 : size, p + 1);  // bo'yi
    dir.writeUInt8(0, p + 2);                       // palitra
    dir.writeUInt8(0, p + 3);                       // rezerv
    dir.writeUInt16LE(1, p + 4);                    // rang tekisliklari
    dir.writeUInt16LE(32, p + 6);                   // bit/piksel
    dir.writeUInt32LE(data.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += data.length;
    parts.push(data);
  });

  return Buffer.concat([header, dir, ...parts]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('data:text/html,<body></body>');

  const b64 = await win.webContents.executeJavaScript(DRAW);
  const images = b64.map((d, i) => ({ size: SIZES[i], data: Buffer.from(d, 'base64') }));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buildIco(images));

  // Do'kon/README uchun 512px PNG ham qulay.
  const png = await win.webContents.executeJavaScript(DRAW.replace(JSON.stringify(SIZES), '[512]'));
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), Buffer.from(png[0], 'base64'));

  console.log(`ICON OK ${OUT} (${fs.statSync(OUT).size} bayt, ${images.length} o‘lcham)`);
  app.quit();
});
