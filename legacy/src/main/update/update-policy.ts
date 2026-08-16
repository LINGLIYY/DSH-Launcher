export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const UPDATE_STARTUP_DELAY_MS = 15_000
export const UPDATE_STARTUP_JITTER_MS = 15_000

export function supportsAutoUpdates(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  // This fork does not publish GitHub release artifacts yet. Keep update
  // checks disabled so the packaged app never queries dataelement/dsh-desktop.
  return false
}

export function shouldCheckAfterResume(lastCheckedAt: number, now = Date.now()): boolean {
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS
}
