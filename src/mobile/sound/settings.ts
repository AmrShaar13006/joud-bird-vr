// The two sound switches: «المؤثرات» (effects, with vibration) and «الإيقاع» (percussion layer).
// Pure over a small key store, so the carry-over from the old single mute is tested in Node.

export interface SoundSettings {
  effects: boolean;
  percussion: boolean;
}

export interface KeyStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const KEYS = { effects: 'sound.effects', percussion: 'sound.percussion', legacyMuted: 'muted' } as const;

/**
 * Saved switches win. With none saved, the old `muted = 1` turns both off. `?mute=1`
 * starts both off for this visit without saving.
 */
export function loadSoundSettings(store: KeyStore, urlMute: boolean): SoundSettings {
  if (urlMute) return { effects: false, percussion: false };
  const legacyOn = store.get(KEYS.legacyMuted) !== '1';
  const read = (key: string): boolean => {
    const v = store.get(key);
    return v === null ? legacyOn : v === '1';
  };
  return { effects: read(KEYS.effects), percussion: read(KEYS.percussion) };
}

export function saveSoundSetting(store: KeyStore, which: keyof SoundSettings, on: boolean): void {
  store.set(KEYS[which], on ? '1' : '0');
}
