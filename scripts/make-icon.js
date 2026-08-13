'use strict';

/** Ikonkani yasash uchun Electron'ni toza muhitda chaqiradi. */

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, 'icon-main.js')], { env, stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 0));
