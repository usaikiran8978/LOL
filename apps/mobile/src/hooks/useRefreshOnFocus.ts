import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/** Re-fetch when the screen regains focus (e.g. back from an edit screen), but not on the initial mount. */
export function useRefreshOnFocus(reload: () => void): void {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reload();
    }, [reload]),
  );
}
