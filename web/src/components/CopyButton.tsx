import { useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (http/older browsers): fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button type="button" className="btn" onClick={copy} data-copy-text={text}>
      {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
      {copied ? 'Copied' : label}
    </button>
  );
}
