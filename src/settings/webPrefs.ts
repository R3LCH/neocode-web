/** Web-app-only preferences (appearance etc.) — stored locally, never sent to the IDE. */

export type WebTheme = "midnight" | "graphite" | "light";

export type WebPrefs = {
  theme: WebTheme;
  accent: string;
  fontScale: number; // percent, 85–120
  terminalWrap: boolean; // wrap long lines in the Terminals tab by default
  notifications: boolean; // system notifications for thread state changes
};

export const ACCENT_PRESETS: Array<{ id: string; label: string; color: string }> = [
  { id: "mono", label: "Mono", color: "#e4e6eb" },
  { id: "steel", label: "Steel", color: "#9aa3b2" },
  { id: "indigo", label: "Indigo", color: "#6c8cff" },
  { id: "teal", label: "Teal", color: "#2fbfa5" },
  { id: "amber", label: "Amber", color: "#e5a53d" },
];

export const DEFAULT_PREFS: WebPrefs = {
  theme: "graphite",
  accent: ACCENT_PRESETS[0].color,
  fontScale: 100,
  terminalWrap: true,
  notifications: false,
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

/** Push the prefs into CSS land: theme class + accent/font-size custom props.
 *  A light accent needs dark text on accent-filled controls and vice versa. */
export function applyPrefs(prefs: WebPrefs) {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.style.setProperty("--accent", prefs.accent);
  root.style.setProperty(
    "--accent-text",
    isLightColor(prefs.accent) ? "#101216" : "#ffffff",
  );
  root.style.fontSize = `${prefs.fontScale}%`;
}

function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
