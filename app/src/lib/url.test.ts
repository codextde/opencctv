/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { hostnameOf, hostOf, joinUrl, mediaUrl, normalizeBaseUrl, parsePairLink, siteBaseUrl, withQuery, wsUrl } from './url';

describe('normalizeBaseUrl', () => {
  test('adds https for public hosts and http for LAN', () => {
    expect(normalizeBaseUrl('cams.example.com')).toBe('https://cams.example.com');
    expect(normalizeBaseUrl('192.168.1.20:8190')).toBe('http://192.168.1.20:8190');
    expect(normalizeBaseUrl('localhost:8190/')).toBe('http://localhost:8190');
    expect(normalizeBaseUrl('nvr.local')).toBe('http://nvr.local');
    expect(normalizeBaseUrl('homeserver:8190')).toBe('http://homeserver:8190');
  });
  test('strips trailing slashes, api suffix and query', () => {
    expect(normalizeBaseUrl(' HTTPS://Demo.Example.com/api/ ')).toBe('https://demo.example.com');
    expect(normalizeBaseUrl('https://gw.example.com/s/abc123/?x=1')).toBe('https://gw.example.com/s/abc123');
  });
  test('empty stays empty', () => {
    expect(normalizeBaseUrl('   ')).toBe('');
  });
});

describe('joinUrl', () => {
  test('joins plain base', () => {
    expect(joinUrl('http://a:1', '/api/cameras')).toBe('http://a:1/api/cameras');
    expect(joinUrl('http://a:1', 'api/cameras')).toBe('http://a:1/api/cameras');
  });
  test('keeps site prefix and avoids doubling it', () => {
    expect(joinUrl('https://gw/s/x1', '/api/cameras')).toBe('https://gw/s/x1/api/cameras');
    expect(joinUrl('https://gw/s/x1', '/s/x1/api/recordings/r/video.mp4')).toBe('https://gw/s/x1/api/recordings/r/video.mp4');
  });
  test('absolute urls pass through', () => {
    expect(joinUrl('https://gw/s/x1', 'https://cdn/x.jpg')).toBe('https://cdn/x.jpg');
  });
});

describe('query + media', () => {
  test('withQuery appends and skips empty values', () => {
    expect(withQuery('http://a/b', { a: 1, b: undefined, c: '' })).toBe('http://a/b?a=1');
    expect(withQuery('http://a/b?x=1', { y: 'a b' })).toBe('http://a/b?x=1&y=a%20b');
  });
  test('mediaUrl adds token once', () => {
    expect(mediaUrl('http://a', '/api/cameras/c1/live.m3u8', 'tok', { quality: 'sd' })).toBe('http://a/api/cameras/c1/live.m3u8?quality=sd&token=tok');
    expect(mediaUrl('http://a', '/api/x.jpg?token=old', 'tok')).toBe('http://a/api/x.jpg?token=old');
  });
  test('wsUrl switches scheme', () => {
    expect(wsUrl('https://gw/s/x', 't')).toBe('wss://gw/s/x/api/ws?token=t');
    expect(wsUrl('http://h:1', 't')).toBe('ws://h:1/api/ws?token=t');
  });
  test('siteBaseUrl', () => {
    expect(siteBaseUrl('https://gw.example.com/', 'abc')).toBe('https://gw.example.com/s/abc');
  });
  test('hostOf', () => {
    expect(hostOf('https://gw.example.com/s/abc')).toBe('gw.example.com/s/abc');
    expect(hostOf('http://10.0.0.2:8190')).toBe('10.0.0.2:8190');
  });
});

describe('parsePairLink', () => {
  test('parses app scheme', () => {
    expect(parsePairLink('opencctv://pair?server=https%3A%2F%2Fhome.example.com&code=AB12-CD')).toEqual({ server: 'https://home.example.com', code: 'AB12-CD' });
  });
  test('parses unencoded LAN server', () => {
    expect(parsePairLink('opencctv://pair?server=http://192.168.0.5:8190&code=xyz')).toEqual({ server: 'http://192.168.0.5:8190', code: 'xyz' });
  });
  test('rejects other content', () => {
    expect(parsePairLink('https://example.com')).toBeNull();
    expect(parsePairLink('opencctv://pair?server=&code=1')).toBeNull();
    expect(parsePairLink('opencctv://pair?code=1')).toBeNull();
  });
});

describe('hostnameOf', () => {
  test('ignores scheme, port, path, credentials and case', () => {
    expect(hostnameOf('https://OpenCCTV-Demo.codext.de')).toBe('opencctv-demo.codext.de');
    expect(hostnameOf('http://opencctv-demo.codext.de:443/s/abc')).toBe('opencctv-demo.codext.de');
    expect(hostnameOf('opencctv-demo.codext.de.')).toBe('opencctv-demo.codext.de');
    expect(hostnameOf('https://user:pw@cams.example.com/x')).toBe('cams.example.com');
    expect(hostnameOf('192.168.1.20:8190')).toBe('192.168.1.20');
    expect(hostnameOf('http://[fe80::1]:8190')).toBe('[fe80::1]');
  });
});
