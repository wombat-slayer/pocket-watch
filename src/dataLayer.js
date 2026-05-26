/**
 * dataLayer.js — Tauri file-system persistence for Pocket Watch
 *
 * All app data lives in a single JSON file whose location the user picks
 * on first run (defaults to AppData\Roaming\PocketWatch\pocket-watch.json).
 * The path is remembered in a small config store (config.json).
 */

import { invoke }                                    from '@tauri-apps/api/core';
import { save as saveDialog, open as openDialog }    from '@tauri-apps/plugin-dialog';
import { Store }                                     from '@tauri-apps/plugin-store';

const CONFIG_STORE = 'config.json';

// Lazy-load the store so it isn't created before Tauri IPC is ready
let _store = null;
const getStore = async () => {
  if (!_store) _store = await Store.load(CONFIG_STORE);
  return _store;
};

// ─── Config store helpers ─────────────────────────────────────────────────────
export const getDataPath = async () => {
  const store = await getStore();
  return store.get('dataPath');
};

export const setDataPath = async (path) => {
  const store = await getStore();
  await store.set('dataPath', path);
  await store.save();
};

// ─── Default path ─────────────────────────────────────────────────────────────
export const getDefaultDataPath = () => invoke('get_default_data_path');

// ─── File I/O ─────────────────────────────────────────────────────────────────
export const loadAppData = async (path) => {
  const raw = await invoke('load_data', { path });
  return JSON.parse(raw);
};

export const saveAppData = async (path, data) => {
  await invoke('save_data', { path, data: JSON.stringify(data, null, 2) });
};

export const dataFileExists = (path) => invoke('data_file_exists', { path });

// ─── First-run / choose file dialogs ─────────────────────────────────────────
/**
 * Ask the user to pick (or create) a location for the data file.
 * Returns the chosen path string, or null if cancelled.
 */
export const promptNewDataFile = async () => {
  const chosen = await saveDialog({
    title: 'Choose where to save Pocket Watch data',
    defaultPath: 'pocket-watch.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return chosen ?? null;
};

/**
 * Ask the user to open an existing data file.
 * Returns the chosen path string, or null if cancelled.
 */
export const promptOpenDataFile = async () => {
  const chosen = await openDialog({
    title: 'Open Pocket Watch data file',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    multiple: false,
  });
  return (Array.isArray(chosen) ? chosen[0] : chosen) ?? null;
};
