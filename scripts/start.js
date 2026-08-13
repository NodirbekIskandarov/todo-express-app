'use strict';

/**
 * Electron'ni toza muhitda ishga tushiradi.
 * Ba'zi tizimlarda ELECTRON_RUN_AS_NODE=1 global o'rnatilgan bo'ladi —
 * u holda Electron oddiy Node kabi ishlaydi va oyna umuman ochilmaydi.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});

child.on('close', (code) => process.exit(code ?? 0));
