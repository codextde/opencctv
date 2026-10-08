const MAX_LINES = 2000;
const ring: string[] = [];

export function redact(s: string): string {
  return s
    .replace(/(\w+:\/\/[^:/@\s]*):([^@\s/]+)@/g, "$1:***@")
    .replace(/([?&](?:token|password|pass|secret|key|access_token|refresh_token)=)[^&\s"]+/gi, "$1***")
    .replace(/("(?:password|pass|secret|token|access_token|refresh_token|client_secret)"\s*:\s*")[^"]*"/gi, '$1***"');
}

function write(level: string, scope: string, msg: string) {
  const line = `${new Date().toISOString()} ${level} [${scope}] ${redact(msg)}`;
  ring.push(line);
  if (ring.length > MAX_LINES) ring.splice(0, ring.length - MAX_LINES);
  if (level === "ERR") console.error(line);
  else if (process.env.OPENCCTV_QUIET !== "1") console.log(line);
}

export type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
};

export function logger(scope: string): Logger {
  return {
    info: (m) => write("INF", scope, m),
    warn: (m) => write("WRN", scope, m),
    error: (m) => write("ERR", scope, m),
    debug: (m) => {
      if (process.env.OPENCCTV_DEBUG === "1") write("DBG", scope, m);
    },
  };
}

export function recentLogs(lines = 200): string[] {
  return ring.slice(-Math.max(1, Math.min(lines, MAX_LINES)));
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
