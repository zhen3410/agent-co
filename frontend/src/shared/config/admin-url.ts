import type { RuntimeConfig } from './runtime-config';

interface LocationLike {
  href?: string;
  origin?: string;
  protocol?: string;
  hostname?: string;
  port?: string;
}

export interface ResolveAdminPageUrlOptions {
  config?: Pick<RuntimeConfig, 'adminBaseUrl' | 'authAdminBaseUrl'> | null;
  location?: LocationLike | null;
  adminPagePath?: string;
}

const DEFAULT_ADMIN_PAGE_PATH = 'admin.html';
const DEFAULT_CHAT_PORT = '3002';
const DEFAULT_AUTH_ADMIN_PORT = '3003';

function normalizeAdminPagePath(pathname: string): string {
  const normalized = pathname.trim().replace(/^\/+/, '');
  return normalized || DEFAULT_ADMIN_PAGE_PATH;
}

function normalizeConfiguredBaseUrl(config?: Pick<RuntimeConfig, 'adminBaseUrl' | 'authAdminBaseUrl'> | null): string {
  const explicit = typeof config?.adminBaseUrl === 'string'
    ? config.adminBaseUrl.trim()
    : '';
  if (explicit) {
    return explicit;
  }

  return typeof config?.authAdminBaseUrl === 'string'
    ? config.authAdminBaseUrl.trim()
    : '';
}

function normalizeLocalOrigin(location?: LocationLike | null): string {
  if (!location) {
    return '';
  }

  if (typeof location.origin === 'string' && location.origin.trim()) {
    return location.origin.trim();
  }

  const protocol = typeof location.protocol === 'string' && location.protocol ? location.protocol : 'http:';
  const hostname = typeof location.hostname === 'string' && location.hostname ? location.hostname : '127.0.0.1';
  const port = typeof location.port === 'string' && location.port ? `:${location.port}` : '';
  return `${protocol}//${hostname}${port}`;
}

function isLocalHostname(hostname: string | undefined): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
}

function shouldUseDefaultAuthAdminPort(location?: LocationLike | null): boolean {
  if (!location) {
    return false;
  }

  return isLocalHostname(location.hostname) && location.port === DEFAULT_CHAT_PORT;
}

function appendAdminPagePath(pathname: string, adminPagePath: string): string {
  if (!pathname || pathname === '/') {
    return `/${adminPagePath}`;
  }

  if (pathname.endsWith(`/${adminPagePath}`) || pathname.endsWith(adminPagePath)) {
    return pathname;
  }

  const normalizedBase = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return `${normalizedBase}/${adminPagePath}`;
}

function resolveAbsoluteAdminUrl(baseUrl: string, adminPagePath: string): string {
  const resolved = new URL(baseUrl);
  resolved.pathname = appendAdminPagePath(resolved.pathname, adminPagePath);
  return resolved.toString();
}

function resolveRelativeAdminUrl(basePath: string, adminPagePath: string): string {
  return appendAdminPagePath(basePath, adminPagePath);
}

function resolveFallbackBaseUrl(location?: LocationLike | null): string {
  if (!location) {
    return '';
  }

  if (shouldUseDefaultAuthAdminPort(location)) {
    const protocol = typeof location.protocol === 'string' && location.protocol ? location.protocol : 'http:';
    return `${protocol}//${location.hostname}:${DEFAULT_AUTH_ADMIN_PORT}`;
  }

  return normalizeLocalOrigin(location);
}

export function resolveAdminPageUrl(options: ResolveAdminPageUrlOptions = {}): string {
  const adminPagePath = normalizeAdminPagePath(options.adminPagePath ?? DEFAULT_ADMIN_PAGE_PATH);
  const configuredBaseUrl = normalizeConfiguredBaseUrl(options.config);

  if (configuredBaseUrl) {
    if (/^https?:\/\//i.test(configuredBaseUrl)) {
      return resolveAbsoluteAdminUrl(configuredBaseUrl, adminPagePath);
    }
    return resolveRelativeAdminUrl(configuredBaseUrl, adminPagePath);
  }

  const fallbackBaseUrl = resolveFallbackBaseUrl(options.location);
  if (fallbackBaseUrl) {
    return /^https?:\/\//i.test(fallbackBaseUrl)
      ? resolveAbsoluteAdminUrl(fallbackBaseUrl, adminPagePath)
      : resolveRelativeAdminUrl(fallbackBaseUrl, adminPagePath);
  }

  return `/${adminPagePath}`;
}
