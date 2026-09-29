import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import type { UserProfile } from '../data/types';

/**
 * Message markdown: bold, italic, strikethrough, links, lists, blockquotes, inline code and
 * code blocks. Raw HTML is escaped (shown as text), headings render as plain paragraphs,
 * images render as links (no third-party image loads), and the result always goes through
 * DOMPurify with a strict allowlist.
 *
 * Mentions are stored in message text as `<@uid>` and rendered as `@Display Name` chips.
 */

const MENTION_RE = /<@([A-Za-z0-9]{1,128})>/g;
/** Broadcast mentions: `<!channel>` (everyone in the channel) and `<!here>` (everyone online). */
const BROADCAST_RE = /<!(channel|here)>/g;
export const BROADCASTS = ['channel', 'here'] as const;
export type Broadcast = (typeof BROADCASTS)[number];
// `<!channel>` would be parsed as an HTML declaration by the block tokenizer, so broadcasts
// are swapped for an invisible marker before parsing (U+2063, never typed by people).
const BCAST = '\u2063';
/** How broadcast mentions are stored in a message's `mentions` array. */
export const broadcastKey = (b: Broadcast) => `!${b}`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type Users = Map<string, UserProfile>;

function makeMarked(users: Users, meId: string | undefined) {
  const mention: TokenizerAndRendererExtension = {
    name: 'mention',
    level: 'inline',
    start: (src: string) => src.indexOf('<@'),
    tokenizer(src: string) {
      const m = /^<@([A-Za-z0-9]{1,128})>/.exec(src);
      if (m) return { type: 'mention', raw: m[0], uid: m[1] };
      return undefined;
    },
    renderer(token) {
      const uid = (token as unknown as { uid: string }).uid;
      const name = users.get(uid)?.displayName ?? 'unknown';
      const me = uid === meId ? ' data-me="true"' : '';
      return `<span class="mention" data-uid="${escapeHtml(uid)}"${me}>@${escapeHtml(name)}</span>`;
    },
  };

  const broadcast: TokenizerAndRendererExtension = {
    name: 'broadcast',
    level: 'inline',
    start: (src: string) => src.indexOf(BCAST),
    tokenizer(src: string) {
      const m = new RegExp(`^${BCAST}!(channel|here)${BCAST}`).exec(src);
      if (m) return { type: 'broadcast', raw: m[0], which: m[1] };
      return undefined;
    },
    renderer(token) {
      const which = (token as unknown as { which: string }).which;
      return `<span class="mention" data-broadcast="${which}" data-me="true">@${which}</span>`;
    },
  };

  const m = new Marked({ gfm: true, breaks: true, async: false });
  m.use({
    extensions: [mention, broadcast],
    tokenizer: {
      // No headings in chat: "# foo" stays a normal line.
      heading: () => undefined,
      lheading: () => undefined,
    },
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.text);
      },
      image(token: Tokens.Image) {
        const text = token.text || token.href;
        return `<a href="${escapeHtml(token.href)}">${escapeHtml(text)}</a>`;
      },
    },
  });
  return m;
}

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'blockquote',
  'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'input',
];
const ALLOWED_ATTR = ['href', 'class', 'data-uid', 'data-me', 'data-broadcast', 'title', 'start', 'type', 'checked', 'disabled'];

let hooked = false;
function purifier() {
  if (!hooked) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
      if (node.tagName === 'INPUT') {
        // Only GFM task-list checkboxes survive, always read-only.
        if (node.getAttribute('type') !== 'checkbox') node.remove();
        else node.setAttribute('disabled', '');
      }
      if (node.tagName === 'SPAN' && node.getAttribute('class') !== 'mention') {
        node.removeAttribute('class');
      }
    });
    hooked = true;
  }
  return DOMPurify;
}

export function renderMarkdown(text: string, users: Users, meId?: string): string {
  const prepared = text.replace(/\u2063/g, '').replace(BROADCAST_RE, `${BCAST}!$1${BCAST}`);
  const html = (makeMarked(users, meId).parse(prepared) as string)
    // Markers left inside code spans/blocks go back to the literal text.
    .replace(new RegExp(`${BCAST}!(channel|here)${BCAST}`, 'g'), '&lt;!$1&gt;');
  return purifier().sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...ALLOWED_ATTR, 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  });
}

/** Mentioned user ids in a message text (deduped). */
export function extractMentions(text: string): string[] {
  const users = [...text.matchAll(MENTION_RE)].map((m) => m[1]);
  const broadcasts = [...text.matchAll(BROADCAST_RE)].map((m) => broadcastKey(m[1] as Broadcast));
  return [...new Set([...users, ...broadcasts])];
}

/** One-line plain-text preview (sidebar, notifications). */
export function plainPreview(text: string, users: Users, max = 120): string {
  const t = text
    .replace(MENTION_RE, (_, uid: string) => `@${users.get(uid)?.displayName ?? 'unknown'}`)
    .replace(BROADCAST_RE, '@$1')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)(.+?)\1/g, '$2')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Converts `<@uid>` tokens to `@Display Name` for editing. */
export function mentionsToDisplay(text: string, users: Users): string {
  return text.replace(MENTION_RE, (_, uid: string) => `@${users.get(uid)?.displayName ?? 'unknown'}`).replace(BROADCAST_RE, '@$1');
}

/**
 * Converts `@Display Name` back to `<@uid>` for the people picked in the composer (longest
 * names first so "Ana María" wins over "Ana"). Picked broadcasts (`!channel`, `!here`) become
 * `<!channel>` / `<!here>`.
 */
export function displayToMentions(text: string, picked: Map<string, string>): string {
  const entries = [...picked.entries()].sort((a, b) => b[1].length - a[1].length);
  let out = text;
  for (const [id, name] of entries) {
    const re = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
    out = out.replace(re, id.startsWith('!') ? `<${id}>` : `<@${id}>`);
  }
  return out;
}

/** True when a message's mentions include me directly or via @channel / @here. */
export function mentionsUser(mentions: string[], uid: string): boolean {
  return mentions.includes(uid) || mentions.includes('!channel') || mentions.includes('!here');
}
