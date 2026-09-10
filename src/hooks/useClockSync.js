import { useEffect, useRef, useState, useCallback } from "react";
import { ClockSyncService } from "../services/clockSync.js";

/**
 * useClockSync — React hook managing NTP-style clock offset estimation with the server.
 *
 * BUG FIX: Previously returned `clockSyncRef.current` directly from the hook.
 * Because `clockSyncRef.current` is `null` on the initial render (before the
 * useEffect runs), consumers received `null` as their `clockSync` value.
 * When passed to `usePlaybackSync`, its effect had `if (!clockSync) return`,
 * so PlaybackSyncManager was never created.
 *
 * Fix: Return the ref object itself (`clockSyncRef`), which is a stable object
 * reference that never changes. Consumers access the live service via `.current`.
 */
export function useClockSync({ sendMessage }) {
  const [syncState, setSyncState] = useState({
    offset: 0,
    rtt: 0,
    sampleCount: 0,
  });

  const clockSyncRef = useRef(null);

  useEffect(() => {
    const service = new ClockSyncService({
      sendMessage,
      onSyncUpdate: (state) => setSyncState(state),
    });

    clockSyncRef.current = service;
    service.start();

    return () => {
      service.stop();
      clockSyncRef.current = null;
    };
  }, [sendMessage]);

  const handleClockSyncResponse = useCallback((data) => {
    if (clockSyncRef.current) {
      clockSyncRef.current.handleResponse(data);
    }
  }, []);

  return {
    ...syncState,
    // Return the stable ref object, NOT .current — so consumers always have the live service
    clockSyncRef,
    handleClockSyncResponse,
  };
}
