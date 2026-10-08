const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?[0-9a-f:]+\]?$|[^/:]+\.local\b|[^./:]+(:\d+)?$)/i;

export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (!url) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const host = url.split('/')[0];
    url = (LOCAL_HOST.test(host) ? 'http://' : 'https://') + url;
  }
  url = url.replace(/[?#].*$/, '');
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/(api|player)$/i, '');
  const m = url.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/]+)(.*)$/i);
  if (!m) return url;
  return m[1].toLowerCase() + m[2].toLowerCase() + m[3];
}

export function isValidBaseUrl(url: string): boolean {
  return /^https?:\/\/[^/\s]+(\/[^\s]*)?$/i.test(url);
}

export function hostnameOf(url: string): string {
  const m = url.trim().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)/i);
  return (m?.[1] ?? '').toLowerCase().replace(/\.$/, '');
}

export function hostOf(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)(\/.*)?$/i);
  if (!m) return url;
  return m[1] + (m[2] && m[2] !== '/' ? m[2] : '');
}

function pathOf(base: string): string {
  const m = base.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i);
  return m?.[1] ?? '';
}

function originOf(base: string): string {
  const m = base.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]+)/i);
  return m?.[1] ?? base;
}

export function joinUrl(base: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  const prefix = pathOf(base);
  if (prefix && p.startsWith(prefix + '/')) return originOf(base) + p;
  return base.replace(/\/+$/, '') + p;
}

export function withQuery(url: string, params: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  if (!parts.length) return url;
  const [head, hash] = url.split('#');
  const sep = head.includes('?') ? '&' : '?';
  return head + sep + parts.join('&') + (hash !== undefined ? `#${hash}` : '');
}

export function mediaUrl(base: string, path: string, token: string | null, params: Record<string, string | number | boolean | undefined> = {}): string {
  const url = joinUrl(base, path);
  if (/[?&]token=/.test(url)) return withQuery(url, params);
  return withQuery(url, { ...params, token: token ?? undefined });
}

export function wsUrl(base: string, token: string): string {
  return withQuery(joinUrl(base, '/api/ws').replace(/^http/i, 'ws'), { token });
}

export function siteBaseUrl(gateway: string, siteId: string): string {
  return `${normalizeBaseUrl(gateway)}/s/${encodeURIComponent(siteId)}`;
}

export function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.replace(/^[?#]/, '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    const v = i < 0 ? '' : part.slice(i + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export type PairLink = { server: string; code: string };

export function parsePairLink(raw: string): PairLink | null {
  const text = raw.trim();
  const m = text.match(/^(?:opencctv:\/\/|https?:\/\/[^/]+\/(?:app\/)?)?\/?pair\/?\?(.+)$/i);
  if (!m) return null;
  const q = parseQuery(m[1]);
  if (!q.server || !q.code) return null;
  const server = normalizeBaseUrl(q.server);
  if (!isValidBaseUrl(server)) return null;
  return { server, code: q.code.trim() };
}
