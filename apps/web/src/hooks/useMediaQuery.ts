import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}

/** Matches Tailwind's `md` breakpoint complement (screens below 768px). */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
