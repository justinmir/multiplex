import { useEffect } from "react";

/**
 * Gap-filler for the data layer. Electron IPC is in-process so there's no
 * socket to "reconnect", but events can still be missed while the window is
 * backgrounded or the machine sleeps. Refetch authoritative state when the
 * window regains focus or the network comes back, so the UI self-heals.
 */
export function useReconnect(refetch: () => void): void {
  useEffect(() => {
    const onFocus = () => refetch();
    const onOnline = () => refetch();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [refetch]);
}
