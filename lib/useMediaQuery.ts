"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query and re-renders when it changes.
 *
 * useSyncExternalStore rather than useState + useEffect on purpose: the value is read during
 * render, so a client-rendered tree gets the correct answer on its FIRST paint instead of
 * flashing a wrong layout for one frame. It is also tear-free under concurrent rendering.
 *
 * `serverValue` is what the server render and the hydration pass see, since matchMedia only
 * exists in the browser. Callers pick whichever value makes their server markup correct.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    // Returns a boolean, so a fresh MediaQueryList per call costs nothing and can't tear.
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
