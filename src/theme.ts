export type Theme = 'dark' | 'light';
const storageKey = 'woojoo-theme';

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* Theme switching remains available when storage is blocked. */ }
  return 'dark';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141720' : '#f5f6fa');
}

export function saveTheme(theme: Theme) {
  applyTheme(theme);
  try { localStorage.setItem(storageKey, theme); } catch { /* Keep the current session usable. */ }
}
