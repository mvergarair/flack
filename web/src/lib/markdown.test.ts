import { describe, expect, it } from 'vitest';
import { renderMarkdown, extractMentions, plainPreview, mentionsToDisplay, displayToMentions, mentionsUser } from './markdown';
import type { UserProfile } from '../data/types';

const users = new Map<string, UserProfile>([
  ['u1', { id: 'u1', displayName: 'Ana María', email: 'a@x.co', photoURL: null, role: 'member', status: 'active' }],
  ['u2', { id: 'u2', displayName: 'Ana', email: 'b@x.co', photoURL: null, role: 'member', status: 'active' }],
]);
const r = (s: string) => renderMarkdown(s, users, 'u2');

describe('renderMarkdown', () => {
  it('renders the supported formatting', () => {
    expect(r('**bold** _it_ ~~gone~~')).toContain('<strong>bold</strong> <em>it</em> <del>gone</del>');
    expect(r('- a\n- b')).toMatch(/<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/);
    expect(r('1. a\n2. b')).toMatch(/<ol>/);
    expect(r('use `x < y`')).toContain('<code>x &lt; y</code>');
    expect(r('```\nconst a = 1;\n```')).toMatch(/<pre><code[^>]*>const a = 1;\n<\/code><\/pre>/);
    expect(r('> quote')).toContain('<blockquote>');
  });

  it('turns single newlines into line breaks', () => {
    expect(r('a\nb')).toContain('a<br>b');
  });

  it('opens links in a new tab with safe rel', () => {
    const html = r('[site](https://example.com) and https://auto.link');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('href="https://auto.link"');
  });

  it('does not render headings or remote images', () => {
    expect(r('# Title')).not.toContain('<h1');
    const img = r('![alt](https://evil.example/pixel.png)');
    expect(img).not.toContain('<img');
    expect(img).toContain('href="https://evil.example/pixel.png"');
  });

  it.each([
    ['<script>alert(1)</script>'],
    ['<img src=x onerror=alert(1)>'],
    ['<a href="javascript:alert(1)">x</a>'],
    ['[click](javascript:alert(1))'],
    ['[click](data:text/html,<script>alert(1)</script>)'],
    ['<iframe src="https://evil.example"></iframe>'],
    ['<svg onload=alert(1)>'],
    ['<div style="position:fixed;inset:0">overlay</div>'],
    ['<a href="https://x.co" onclick="alert(1)">x</a>'],
    ['<<script>script>alert(1)<</script>/script>'],
    ['`<img src=x onerror=alert(1)>`'],
    ['<span class="mention" data-uid="u1">@fake</span>'],
  ])('neutralizes %s', (payload) => {
    const el = document.createElement('div');
    el.innerHTML = r(payload);
    expect(el.querySelectorAll('script,img,iframe,svg,style,div,object,embed').length).toBe(0);
    for (const node of el.querySelectorAll('*')) {
      for (const attr of node.attributes) {
        expect(attr.name).not.toMatch(/^on/i);
        if (attr.name === 'href') expect(attr.value).toMatch(/^(https?:|mailto:|#)/);
      }
    }
    // Raw HTML is shown as text, never as a forged mention chip.
    expect(el.querySelectorAll('.mention').length).toBe(0);
  });

  it('renders mentions as chips and flags mine', () => {
    const html = r('hi <@u1> and <@u2>');
    expect(html).toContain('<span class="mention" data-uid="u1">@Ana María</span>');
    expect(html).toContain('<span class="mention" data-uid="u2" data-me="true">@Ana</span>');
    expect(r('<@nobody>')).toContain('@unknown');
  });

  it('escapes names in mention chips', () => {
    const evil = new Map(users).set('u3', { ...users.get('u1')!, id: 'u3', displayName: '<img src=x onerror=alert(1)>' });
    const html = renderMarkdown('<@u3>', evil);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('does not treat mentions inside code as mentions', () => {
    expect(r('`<@u1>`')).toContain('<code>&lt;@u1&gt;</code>');
  });
});

describe('mention helpers', () => {
  it('extracts unique mention ids', () => {
    expect(extractMentions('<@u1> <@u2> <@u1>')).toEqual(['u1', 'u2']);
  });

  it('round-trips display text and tokens, preferring longer names', () => {
    const picked = new Map([
      ['u1', 'Ana María'],
      ['u2', 'Ana'],
    ]);
    const tokens = displayToMentions('@Ana María and @Ana, hi', picked);
    expect(tokens).toBe('<@u1> and <@u2>, hi');
    expect(mentionsToDisplay(tokens, users)).toBe('@Ana María and @Ana, hi');
  });

  it('leaves unpicked @names alone', () => {
    expect(displayToMentions('email me @ home', new Map())).toBe('email me @ home');
  });
});

describe('plainPreview', () => {
  it('strips markdown and resolves mentions', () => {
    expect(plainPreview('**Hey** <@u1>, see `code` and [docs](https://x.co)\n- item', users)).toBe('Hey @Ana María, see code and docs item');
    expect(plainPreview('```\nlots of code\n```', users)).toBe('[code]');
  });

  it('truncates long text', () => {
    expect(plainPreview('a'.repeat(300), users, 50)).toHaveLength(50);
  });
});

describe('@channel and @here', () => {
  it('render as highlighted broadcast chips', () => {
    expect(r('<!channel> standup')).toContain('<span class="mention" data-broadcast="channel" data-me="true">@channel</span>');
    expect(r('<!here>')).toContain('@here</span>');
    expect(r('`<!here>`')).toContain('<code>&lt;!here&gt;</code>');
  });

  it('are extracted as !channel / !here and count as mentioning everyone', () => {
    expect(extractMentions('<!channel> and <@u1> <!here>')).toEqual(['u1', '!channel', '!here']);
    expect(mentionsUser(['!here'], 'anyone')).toBe(true);
    expect(mentionsUser(['u1'], 'u2')).toBe(false);
  });

  it('round-trip through the composer text', () => {
    const picked = new Map([
      ['!channel', 'channel'],
      ['!here', 'here'],
    ]);
    expect(displayToMentions('@channel lunch? @here too, @channelx no', picked)).toBe('<!channel> lunch? <!here> too, @channelx no');
    expect(mentionsToDisplay('<!channel> hi', users)).toBe('@channel hi');
    expect(plainPreview('<!here> deploy done', users)).toBe('@here deploy done');
  });
});

