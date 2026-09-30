import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'fitness-lab.voice-enabled';

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Spoken feedback via the browser's built-in Speech Synthesis API. No external services. */
export function useVoice() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [enabled, setEnabled] = useState(readPreference);

  const toggle = useCallback(() => {
    setEnabled((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Preference just won't persist.
      }
      if (!next && supported) window.speechSynthesis.cancel();
      return next;
    });
  }, [supported]);

  /** Speak now, replacing anything still queued (corrections should be timely, not backlogged). */
  const speak = useCallback(
    (text: string) => {
      if (!supported || !enabled) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    },
    [supported, enabled],
  );

  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  return { supported, enabled, toggle, speak };
}
