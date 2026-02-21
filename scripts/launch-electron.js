#!/usr/bin/env node
/**
 * Launcher script that ensures ELECTRON_RUN_AS_NODE is unset
 * before starting the Electron main process.
 */
const { spawn } = require('child_process');
const path = require('path');

// Get the electron binary path
const electronPath = require('electron');

// Clone env and remove the problematic variable
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Forward any extra CLI args
const args = ['.'].concat(process.argv.slice(2));

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env,
  cwd: path.resolve(__dirname, '..'),
  windowsHide: false,
});

child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error('Failed to start Electron:', err);
  process.exit(1);
});
