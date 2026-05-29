import { useSyncExternalStore } from 'react';

/**
 * Tracks the user's "current" (last-selected) site, persisted to localStorage so
 * it survives reloads and navigation to non-site pages. Backed by a tiny
 * external store so all components (sidebar, pages) stay in sync.
 */
const STORAGE_KEY = 'currentSiteId';

const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function setCurrentSiteId(id: number | string | null) {
  const value = id == null ? null : String(id);
  try {
    if (value == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore storage failures (e.g. private mode)
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep multiple tabs in sync.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Reactive accessor for the current site id (string) or null. */
export function useCurrentSiteId(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
