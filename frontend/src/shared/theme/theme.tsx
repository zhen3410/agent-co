import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type AppliedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'agent-co.theme-choice';

interface ThemeDocumentTarget {
  documentElement: {
    dataset: Record<string, string | undefined>;
  };
}

interface StorageLike {
  getItem?(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ThemeContextValue {
  choice: ThemeChoice;
  theme: AppliedTheme;
  setChoice: (choice: ThemeChoice) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  choice: 'system',
  theme: 'light',
  setChoice: () => {},
  toggleTheme: () => {}
});

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }

  return window.matchMedia('(prefers-color-scheme: dark)');
}

function readStoredThemeChoice(storage?: StorageLike | null): ThemeChoice {
  if (!storage?.getItem) {
    return 'system';
  }

  try {
    return resolveThemeChoice(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function readSystemPrefersDark(): boolean {
  return Boolean(getMediaQueryList()?.matches);
}

export function resolveThemeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : 'system';
}

export function resolveAppliedTheme(choice: ThemeChoice, prefersDark: boolean): AppliedTheme {
  if (choice === 'system') {
    return prefersDark ? 'dark' : 'light';
  }

  return choice;
}

export function getNextThemeChoice(choice: ThemeChoice): ThemeChoice {
  if (choice === 'system') {
    return 'light';
  }
  if (choice === 'light') {
    return 'dark';
  }
  return 'system';
}

export function applyThemeToDocument(target: ThemeDocumentTarget, value: { choice: ThemeChoice; theme: AppliedTheme }): void {
  target.documentElement.dataset.theme = value.theme;
  target.documentElement.dataset.themeChoice = value.choice;
}

export function persistThemeChoice(storage: StorageLike, choice: ThemeChoice): void {
  if (choice === 'system') {
    storage.removeItem(THEME_STORAGE_KEY);
    return;
  }

  storage.setItem(THEME_STORAGE_KEY, choice);
}

export function ThemeProvider({ children }: { children?: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => {
    if (typeof window === 'undefined') {
      return 'system';
    }

    try {
      return readStoredThemeChoice(window.localStorage);
    } catch {
      return 'system';
    }
  });
  const [prefersDark, setPrefersDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return readSystemPrefersDark();
  });

  const theme = resolveAppliedTheme(choice, prefersDark);

  useEffect(() => {
    const mediaQueryList = getMediaQueryList();
    if (!mediaQueryList) {
      return undefined;
    }

    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setPrefersDark(Boolean(event.matches));
    };

    handleChange(mediaQueryList);

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange);
      return () => mediaQueryList.removeEventListener('change', handleChange);
    }

    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      applyThemeToDocument({ documentElement: document.documentElement }, { choice, theme });
    }

    if (typeof window !== 'undefined') {
      try {
        persistThemeChoice(window.localStorage, choice);
      } catch {
        // Ignore storage failures so theming still works in privacy-restricted contexts.
      }
    }
  }, [choice, theme]);

  const setChoice = useCallback((nextChoice: ThemeChoice) => {
    setChoiceState(resolveThemeChoice(nextChoice));
  }, []);

  const toggleTheme = useCallback(() => {
    setChoiceState((currentChoice) => getNextThemeChoice(currentChoice));
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    choice,
    theme,
    setChoice,
    toggleTheme
  }), [choice, setChoice, theme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { choice, setChoice } = useTheme();
  const nextChoice = getNextThemeChoice(choice);
  const labelMap: Record<ThemeChoice, string> = {
    system: '自动',
    light: '浅色',
    dark: '深色'
  };
  const iconMap: Record<ThemeChoice, string> = {
    system: '◐',
    light: '☼',
    dark: '☾'
  };

  return (
    <button
      type="button"
      aria-label={`主题：${labelMap[choice]}，点击切换到${labelMap[nextChoice]}`}
      title={`主题：${labelMap[choice]}`}
      data-theme-toggle="button"
      data-theme-choice={choice}
      className={['theme-toggle', className].filter(Boolean).join(' ')}
      onClick={() => setChoice(nextChoice)}
    >
      <span className="theme-toggle__icon" aria-hidden="true">{iconMap[choice]}</span>
    </button>
  );
}
