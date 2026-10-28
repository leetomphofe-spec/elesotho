import { createContext, useContext, useEffect, useState } from 'react';

const PrefsContext = createContext(null);

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem('gs-prefs')) || {};
  } catch {
    return {};
  }
}

/** Per-device display preferences: text size and high contrast. */
export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(() => ({ textSize: 'normal', contrast: 'standard', ...readPrefs() }));

  useEffect(() => {
    document.documentElement.dataset.textSize = prefs.textSize;
    document.documentElement.dataset.contrast = prefs.contrast;
    try { localStorage.setItem('gs-prefs', JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  }, [prefs]);

  const update = (patch) => setPrefs((p) => ({ ...p, ...patch }));
  return <PrefsContext.Provider value={{ prefs, update }}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);
