export interface DependencyStatusItem {
  name: string;
  required: boolean;
  healthy: boolean;
  detail: string;
}

export interface DependencyStatusLogEntry {
  timestamp: number;
  level: 'info' | 'error';
  dependency: string;
  message: string;
}

export interface DependencyLogQuery {
  keyword: string;
  startAt: number | null;
  endAt: number | null;
  dependency: string;
  level: 'info' | 'error' | '';
  limit: number;
}

export interface DependencyLogStore {
  append(entry: DependencyStatusLogEntry): void;
  appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void;
  list(): DependencyStatusLogEntry[];
  filter(query: DependencyLogQuery): DependencyStatusLogEntry[];
}

function parseDateParamToTimestamp(value: string | null, endOfDay: boolean): number | null {
  const raw = (value || '').trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const normalized = endOfDay ? `${raw}T23:59:59.999` : `${raw}T00:00:00.000`;
    const ts = new Date(normalized).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function parseDependencyLogQuery(url: URL): DependencyLogQuery {
  const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase();
  const dependency = (url.searchParams.get('dependency') || '').trim().toLowerCase();
  const startAt = parseDateParamToTimestamp(url.searchParams.get('startDate'), false);
  const endAt = parseDateParamToTimestamp(url.searchParams.get('endDate'), true);
  const levelRaw = (url.searchParams.get('level') || '').trim().toLowerCase();
  const level: 'info' | 'error' | '' = levelRaw === 'info' || levelRaw === 'error' ? levelRaw : '';
  const limitRaw = Number(url.searchParams.get('limit') || 500);
  const limit = Number.isFinite(limitRaw) ? Math.min(2000, Math.max(1, Math.floor(limitRaw))) : 500;

  return { keyword, startAt, endAt, dependency, level, limit };
}

export function createDependencyLogStore(limit = 80): DependencyLogStore {
  const dependencyStatusLogs: DependencyStatusLogEntry[] = [];

  function append(entry: DependencyStatusLogEntry): void {
    dependencyStatusLogs.push(entry);
    if (dependencyStatusLogs.length > limit) {
      dependencyStatusLogs.splice(0, dependencyStatusLogs.length - limit);
    }
  }

  function appendOperationalLog(level: 'info' | 'error', dependency: string, message: string): void {
    append({
      timestamp: Date.now(),
      level,
      dependency,
      message
    });

    const prefix = `[Ops][${dependency}]`;
    if (level === 'error') {
      console.error(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  function list(): DependencyStatusLogEntry[] {
    return [...dependencyStatusLogs].sort((a, b) => b.timestamp - a.timestamp);
  }

  function filter(query: DependencyLogQuery): DependencyStatusLogEntry[] {
    return list().filter((log) => {
      if (query.startAt !== null && log.timestamp < query.startAt) return false;
      if (query.endAt !== null && log.timestamp > query.endAt) return false;
      if (query.dependency && log.dependency.toLowerCase() !== query.dependency) return false;
      if (query.level && log.level !== query.level) return false;
      if (!query.keyword) return true;

      const text = `${log.dependency} ${log.message} ${log.level}`.toLowerCase();
      return text.includes(query.keyword);
    }).slice(0, query.limit);
  }

  return {
    append,
    appendOperationalLog,
    list,
    filter
  };
}
