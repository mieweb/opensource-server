import { useSyncExternalStore } from 'react';

/**
 * Per-user (per-device) preference for what the Containers list shows by
 * default: only your own containers ('own', the default) or everything you may
 * see including shared ('all'). Persisted to localStorage and backed by a tiny
 * external store so the Settings toggle and the containers grid stay in sync.
 */
export type ContainerViewDefault = 'own' | 'all';

const STORAGE_KEY = 'containers:defaultView';
const DEFAULT: ContainerViewDefault = 'own';

const listeners = new Set<() => void>();

function read(): ContainerViewDefault {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'all' ? 'all' : 'own';
  } catch {
    return DEFAULT;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function setContainerViewDefault(value: ContainerViewDefault) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
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

/** Reactive accessor for the container view default. */
export function useContainerViewDefault(): ContainerViewDefault {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}
