import { list, translate, uses24h, type Lang } from '@/i18n';

import { formatDuration as clockDuration, dayKey, formatClock, parseDay, shiftDay } from './timeline';

export function formatBytes(n: number | undefined, lang: Lang): string {
  if (n === undefined || !Number.isFinite(n)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  const s = v.toFixed(digits);
  return `${lang === 'de' ? s.replace('.', ',') : s} ${units[i]}`;
}

export function formatNumber(n: number, lang: Lang, digits = 0): string {
  const s = n.toFixed(digits);
  return lang === 'de' ? s.replace('.', ',') : s;
}

export function clock(t: number, seconds = false): string {
  return formatClock(t, uses24h(), seconds);
}

export function dayLabel(day: string, lang: Lang, opts: { relative?: boolean; weekday?: boolean } = {}): string {
  const { relative = true, weekday = true } = opts;
  const today = dayKey(Date.now());
  if (relative && day === today) return translate(lang, 'time.today');
  if (relative && day === shiftDay(today, -1)) return translate(lang, 'time.yesterday');
  const { y, m, d } = parseDay(day);
  const date = new Date(y, m - 1, d);
  const wd = list(lang, 'time.weekdaysShort')[date.getDay()];
  const mon = list(lang, 'time.monthsShort')[m - 1];
  const sameYear = y === new Date().getFullYear();
  const core = lang === 'de' ? `${d}. ${mon}${sameYear ? '' : ` ${y}`}` : `${mon} ${d}${sameYear ? '' : `, ${y}`}`;
  return weekday ? `${wd}${lang === 'de' ? '.,' : ','} ${core}` : core;
}

export function dateTimeLabel(t: number, lang: Lang): string {
  return `${dayLabel(dayKey(t), lang)} ${lang === 'de' ? 'um' : 'at'} ${clock(t)}`;
}

export function relativeTime(t: number, lang: Lang, now = Date.now()): string {
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return translate(lang, 'time.justNow');
  if (min < 60) return translate(lang, 'time.minutesAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24 && dayKey(t) === dayKey(now)) return translate(lang, 'time.hoursAgo', { n: h });
  return dateTimeLabel(t, lang);
}

export function uptimeLabel(sec: number, lang: Lang): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return translate(lang, 'time.daysHours', { d, h });
  if (h) return translate(lang, 'time.hoursMinutes', { h, m });
  return translate(lang, 'time.minutes', { n: m });
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  return `${clockDuration(sec)} ${sec < 3600 ? 'min' : 'h'}`;
}
