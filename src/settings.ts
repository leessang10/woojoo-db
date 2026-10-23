import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

/** App-wide preferences from the Settings dialog. Theme and language keep their own storage. */
export type Settings = {
  /** Rows a query or table view loads before marking the result as truncated. */
  resultLimit: number;
  editorFontSize: number;
  /** Shows AWS change actions; the backend refuses to prepare them while off. */
  awsActions: boolean;
  /** Comma-separated words that mark an AWS profile as production. */
  productionPattern: string;
};
export const RESULT_LIMITS = [100, 500, 1000, 5000, 10000];
export const EDITOR_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20];
export const DEFAULT_SETTINGS: Settings = { resultLimit: 500, editorFontSize: 13, awsActions: false, productionPattern: 'prod, production, prd, live' };
const KEY = 'woojoo-settings-v1';

function read(): Settings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      resultLimit: RESULT_LIMITS.includes(value.resultLimit) ? value.resultLimit : DEFAULT_SETTINGS.resultLimit,
      editorFontSize: EDITOR_FONT_SIZES.includes(value.editorFontSize) ? value.editorFontSize : DEFAULT_SETTINGS.editorFontSize,
      awsActions: typeof value.awsActions === 'boolean' ? value.awsActions : DEFAULT_SETTINGS.awsActions,
      productionPattern: typeof value.productionPattern === 'string' ? value.productionPattern.slice(0, 200) : DEFAULT_SETTINGS.productionPattern,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
let settings = read();
const listeners = new Set<() => void>();
export const readSettings = () => settings;

/** Pushes settings to the document and the backend; safe to call repeatedly. */
export function applySettings(value = settings) {
  document.documentElement.style.setProperty('--editor-font-size', `${value.editorFontSize}px`);
  if (!isTauri()) return;
  void invoke('set_result_limit', { limit: value.resultLimit }).catch(() => {});
  void invoke('aws_set_actions_enabled', { enabled: value.awsActions }).catch(() => {});
}
export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Session-only preference. */ }
  applySettings();
  listeners.forEach(listener => listener());
}
export function useSettings() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => settings);
}

/** Words from the production pattern, lowercased; empty entries are ignored. */
export const productionWords = (pattern: string) => pattern.split(',').map(word => word.trim().toLowerCase()).filter(Boolean);
/** True when a profile name contains a production word as a whole token (team-prod, prod_us, but not product). */
export function matchesProduction(name: string, pattern = settings.productionPattern) {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/);
  return productionWords(pattern).some(word => tokens.includes(word));
}
