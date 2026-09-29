/** Pure reaction helpers (unit-tested). Messages store reactions as { uid: [emoji, ...] }. */

export const DEFAULT_QUICK_REACTIONS = ['👍', '✅', '👀'];

export interface ReactionSummary {
  emoji: string;
  uids: string[];
}

/** Aggregates per-person reactions into chips: most used first, then by first appearance. */
export function summarizeReactions(reactions: Record<string, string[]> | undefined): ReactionSummary[] {
  const byEmoji = new Map<string, string[]>();
  for (const [uid, emojis] of Object.entries(reactions ?? {})) {
    for (const e of emojis ?? []) byEmoji.set(e, [...(byEmoji.get(e) ?? []), uid]);
  }
  const order = [...byEmoji.keys()];
  return [...byEmoji.entries()]
    .map(([emoji, uids]) => ({ emoji, uids: [...new Set(uids)].sort() }))
    .sort((a, b) => b.uids.length - a.uids.length || order.indexOf(a.emoji) - order.indexOf(b.emoji));
}

export function hasReacted(reactions: Record<string, string[]> | undefined, uid: string, emoji: string): boolean {
  return !!reactions?.[uid]?.includes(emoji);
}

/** "Ana, Tomás and 2 others" for a chip tooltip. */
export function reactorNames(uids: string[], nameOf: (uid: string) => string, meId: string): string {
  const names = uids.map((u) => (u === meId ? 'You' : nameOf(u)));
  if (names.length <= 3) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

/** Curated picker set (name is used for search and screen readers). */
export const EMOJI: [string, string][] = [
  ['👍', 'thumbs up'], ['👎', 'thumbs down'], ['✅', 'check'], ['👀', 'eyes'], ['🙌', 'raised hands'], ['👏', 'clap'],
  ['🙏', 'thanks'], ['❤️', 'heart'], ['🔥', 'fire'], ['🎉', 'party'], ['🚀', 'rocket'], ['💯', 'hundred'],
  ['😂', 'joy'], ['😄', 'smile'], ['🙂', 'slight smile'], ['😅', 'sweat smile'], ['😍', 'heart eyes'], ['🤔', 'thinking'],
  ['😮', 'wow'], ['😢', 'sad'], ['😡', 'angry'], ['🤯', 'mind blown'], ['😎', 'cool'], ['🥳', 'celebrate'],
  ['👌', 'ok'], ['✌️', 'peace'], ['🤝', 'handshake'], ['💪', 'strong'], ['👋', 'wave'], ['🫡', 'salute'],
  ['⭐', 'star'], ['⚡', 'zap'], ['💡', 'idea'], ['📌', 'pin'], ['📝', 'memo'], ['📎', 'paperclip'],
  ['❗', 'exclamation'], ['❓', 'question'], ['⚠️', 'warning'], ['❌', 'x'], ['⏳', 'hourglass'], ['🕒', 'clock'],
  ['🐛', 'bug'], ['🛠️', 'tools'], ['🧪', 'test'], ['📦', 'package'], ['🚢', 'ship'], ['🎯', 'target'],
  ['☕', 'coffee'], ['🍕', 'pizza'], ['🍻', 'cheers'], ['🌮', 'taco'], ['🏖️', 'beach'], ['🌴', 'palm'],
];
