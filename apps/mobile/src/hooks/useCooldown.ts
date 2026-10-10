import { useCallback, useEffect, useState } from 'react';

/** Countdown for "resend code" buttons; restarted with the server's retryAfterSeconds when rate-limited. */
export function useCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);

  const start = useCallback((seconds: number) => {
    setNow(Date.now());
    setUntil(Date.now() + seconds * 1000);
  }, []);

  return { remaining: Math.max(0, Math.ceil((until - now) / 1000)), start };
}

/** Default resend cooldown when the server has not told us one; the server still enforces its own limit. */
export const DEFAULT_RESEND_COOLDOWN_SECONDS = 30;
