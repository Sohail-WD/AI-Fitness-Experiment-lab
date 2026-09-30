import { useEffect, useState } from 'react';

/** Current route from the URL hash ("#/profile" → "profile"). Hash routing needs no server config. */
export function useHashRoute(defaultRoute: string): string {
  const read = () => window.location.hash.replace(/^#\/?/, '') || defaultRoute;
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  });

  return route;
}
