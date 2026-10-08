import { getCalendars, getLocales } from 'expo-localization';

import { useSettings, type LanguagePref } from '@/store/settings';

import { de, type Dict } from './de';
import { en } from './en';

export type Lang = 'de' | 'en';

const dicts: Record<Lang, Dict> = { de, en };

type Path<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends readonly string[] ? `${P}${K}` : Path<T[K], `${P}${K}.`>;
}[keyof T & string];

export type Key = Path<Dict>;
export type Vars = Record<string, string | number>;

export function systemLang(): Lang {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return code === 'de' ? 'de' : 'en';
}

export function resolveLang(pref: LanguagePref): Lang {
  return pref === 'system' ? systemLang() : pref;
}

export function currentLang(): Lang {
  return resolveLang(useSettings.getState().language);
}

function lookup(dict: Dict, key: string): unknown {
  let node: unknown = dict;
  for (const part of key.split('.')) node = (node as Record<string, unknown>)?.[part];
  return node;
}

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const node = lookup(dicts[lang], key);
  let text = typeof node === 'string' ? node : key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

export function list(lang: Lang, key: Key): readonly string[] {
  const node = lookup(dicts[lang], key);
  return Array.isArray(node) ? node : [];
}

export function t(key: Key, vars?: Vars) {
  return translate(currentLang(), key, vars);
}

export function uses24h(): boolean {
  return getCalendars()[0]?.uses24hourClock ?? true;
}

export function useT() {
  const pref = useSettings((s) => s.language);
  const lang = resolveLang(pref);
  return {
    lang,
    t: (key: Key, vars?: Vars) => translate(lang, key, vars),
    plural: (n: number, one: Key, other: Key) => translate(lang, n === 1 ? one : other, { n }),
    list: (key: Key) => list(lang, key),
  };
}
