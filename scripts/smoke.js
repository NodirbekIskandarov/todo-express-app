'use strict';

/** Tekshiruv: Electron'ni ochib, interfeysni suratga oladi va DOM holatini yozadi. */

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env, VAZIFA_SMOKE: '1', VAZIFA_DEBUG: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 0));
