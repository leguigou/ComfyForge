const MODULE_RELOAD_KEY = 'comfyforge.module-reload-at';
const MODULE_RELOAD_COOLDOWN_MS = 60_000;

let inMemoryReloadAt = 0;

export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload (?:CSS|dependency)/i.test(message);
}

export function reloadStaleClient(now = Date.now()): boolean {
  let previousReloadAt = inMemoryReloadAt;

  try {
    const storedReloadAt = Number(window.sessionStorage.getItem(MODULE_RELOAD_KEY));
    if (Number.isFinite(storedReloadAt)) previousReloadAt = Math.max(previousReloadAt, storedReloadAt);
  } catch {
    // sessionStorage can be unavailable in restrictive browser modes.
  }

  if (previousReloadAt > 0 && now - previousReloadAt < MODULE_RELOAD_COOLDOWN_MS) {
    return false;
  }

  inMemoryReloadAt = now;
  try {
    window.sessionStorage.setItem(MODULE_RELOAD_KEY, String(now));
  } catch {
    // The in-memory guard still prevents a reload loop for this document.
  }

  window.location.reload();
  return true;
}

export async function importWithRecovery<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isModuleLoadError(error) && reloadStaleClient()) {
      // Navigation normally interrupts this promise. Keeping it pending avoids a
      // transient error screen while the fresh document is loading.
      return await new Promise<T>(() => undefined);
    }
    throw error;
  }
}
