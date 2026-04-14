import { useEffect, useMemo, useState } from 'react';
import { buildAdminPath, matchAdminRoute, type AdminRoute } from './admin-routes';

export interface AdminRouterState {
  pathname: string;
  route: AdminRoute;
  navigate: (nextPath: string | Exclude<AdminRoute, { section: 'not-found' }>) => void;
}

function getCurrentPathname(initialPathname?: string): string {
  if (typeof window !== 'undefined' && window.location?.pathname) {
    return window.location.pathname;
  }
  return initialPathname || '/admin';
}

export function useAdminRouter(initialPathname?: string): AdminRouterState {
  const [pathname, setPathname] = useState(() => getCurrentPathname(initialPathname));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    function handlePopState() {
      setPathname(window.location.pathname || '/admin');
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const route = useMemo(() => matchAdminRoute(pathname), [pathname]);

  function navigate(nextPath: string | Exclude<AdminRoute, { section: 'not-found' }>) {
    const resolvedPath = typeof nextPath === 'string' ? nextPath : buildAdminPath(nextPath);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      window.history.pushState({}, '', resolvedPath);
    }
    setPathname(resolvedPath);
  }

  return { pathname, route, navigate };
}
