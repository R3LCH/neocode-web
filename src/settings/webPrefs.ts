/** Web-app-only preferences (appearance etc.) — stored locally, never sent to the IDE. */

export type WebTheme = "midnight" | "graphite" | "light";

export type WebPrefs = {
  theme: WebTheme;
  accent: string;
  fontScale: number; // percent, 85–120
  terminalWrap: boolean; // wrap long lines in the Terminals tab by default
};

export const ACCENT_PRESETS: Array<{ id: string; label: string; color: string }> = [
  { id: "indigo", label: "Indigo", color: "#6c8cff" },
  { id: "violet", label: "Violet", color: "#a884f3" },
  { id: "teal", label: "Teal", color: "#2fbfa5" },
  { id: "amber", label: "Amber", color: "#e5a53d" },
  { id: "rose", label: "Rose", color: "#ef7189" },
];

export const DEFAULT_PREFS: WebPrefs = {
  theme: "midnight",
  accent: ACCENT_PRESETS[0].color,
  fontScale: 100,
  terminalWrap: true,
};

const STORAGE_KEY = "claw-remote.prefs";

export function loadPrefs(): WebPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<WebPrefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: WebPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — prefs just won't persist */
  }
}

/** Push the prefs into CSS land: theme class + accent/font-size custom props. */
export function applyPrefs(prefs: WebPrefs) {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.style.setProperty("--accent", prefs.accent);
  root.style.fontSize = `${prefs.fontScale}%`;
}
