export type ThemeMode = 'dark' | 'light';

export function applyTheme(mode: ThemeMode) {
  document.documentElement.className = mode === 'light' ? 'theme-light' : 'theme-dark';
  localStorage.setItem('pixelmorpher-theme', mode);
}

export function loadTheme(): ThemeMode {
  const saved = localStorage.getItem('pixelmorpher-theme');
  return (saved === 'light' ? 'light' : 'dark') as ThemeMode;
}
