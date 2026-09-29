import { describe, expect, it } from 'vitest';
import { extractUrls, isPrivateAddress, parseOg } from './og.js';

describe('extractUrls', () => {
  it('finds http(s) links, trims punctuation, skips code and dedupes', () => {
    expect(extractUrls('see https://example.com/a, and (https://x.io/b). `https://code.dev` https://example.com/a')).toEqual([
      'https://example.com/a',
      'https://x.io/b',
    ]);
    expect(extractUrls('```\nhttps://in.block\n```')).toEqual([]);
    expect(extractUrls('ftp://nope javascript:alert(1)')).toEqual([]);
    expect(extractUrls('a https://1.co b https://2.co c https://3.co d https://4.co')).toHaveLength(3);
  });
});

describe('parseOg', () => {
  it('reads Open Graph tags with fallbacks', () => {
    const html = `<html><head><title>Fallback &amp; Co</title>
      <meta property="og:title" content="Flack &amp; friends">
      <meta name="description" content="A team chat">
      <meta property="og:image" content="/img/card.png">
      <meta property="og:site_name" content="Flack Docs"></head></html>`;
    expect(parseOg(html, 'https://docs.flack.dev/page')).toEqual({
      title: 'Flack & friends',
      description: 'A team chat',
      image: 'https://docs.flack.dev/img/card.png',
      siteName: 'Flack Docs',
    });
  });

  it('falls back to <title> and hostname, and rejects non-http images', () => {
    const p = parseOg('<title> Plain page </title><meta property="og:image" content="javascript:alert(1)">', 'https://www.plain.org/x');
    expect(p).toEqual({ title: 'Plain page', description: '', image: null, siteName: 'plain.org' });
  });
});

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])(
    'blocks %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '151.101.1.69', '2606:4700::1111'])('allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});
