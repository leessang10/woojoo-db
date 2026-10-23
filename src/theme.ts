export type Theme = 'dark' | 'light';
/** What the user picked; 'system' follows the operating system and resolves to a Theme. */
export type ThemePreference = Theme | 'system';
const storageKey = 'woojoo-theme';
const systemQuery = () => typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
  } catch { /* Theme switching remains available when storage is blocked. */ }
  return 'dark';
}
export const resolveTheme = (preference: ThemePreference): Theme => preference === 'system' ? (systemQuery()?.matches === false ? 'light' : 'dark') : preference;
export const readTheme = (): Theme => resolveTheme(readThemePreference());

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141720' : '#f5f6fa');
}

/** Stores the preference and applies its resolved theme; returns that theme. */
export function saveTheme(preference: ThemePreference): Theme {
  const theme = resolveTheme(preference);
  applyTheme(theme);
  try { localStorage.setItem(storageKey, preference); } catch { /* Keep the current session usable. */ }
  return theme;
}

/** Calls back with the new theme whenever the operating system switches between light and dark. */
export function watchSystemTheme(callback: (theme: Theme) => void) {
  const query = systemQuery();
  if (!query) return () => {};
  const listener = () => callback(query.matches ? 'dark' : 'light');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
