import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { logoFromFile, saveBranding, setDefaultChannels, useBranding } from '../data/branding';
import {
  ACCENT_PRESETS,
  DEFAULT_NAME,
  DEFAULT_TAGLINE,
  NAME_MAX,
  SIDEBAR_PRESETS,
  TAGLINE_MAX,
  accentVars,
  accentWarning,
  isHex,
  sidebarVars,
  type Branding,
} from '../lib/branding';
import { friendlyError } from '../lib/errors';
import { Modal } from './Modal';
import { Logo } from './icons';
import styles from './WorkspaceSettings.module.css';

const DEFAULT_ACCENT = '#1f5fc4';
const DEFAULT_SIDEBAR = '#1e2b2f';

/** Admins: name, logo, sign-in message, colors and default channels, with a live preview. */
export function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const { branding } = useBranding();
  const [draft, setDraft] = useState<Branding>(() => ({ ...branding }));
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [defaults, setDefaults] = useState<string[] | null>(null);
  const initialDefaults = useRef<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getDocs(query(collection(db, 'channels'), where('type', '==', 'public')))
      .then((snap) =>
        setChannels(
          snap.docs
            .filter((d) => !d.get('archived'))
            .map((d) => ({ id: d.id, name: d.get('name') as string }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch((err) => setError(friendlyError(err)));
    return onSnapshot(doc(db, 'config', 'app'), (snap) => {
      const ids = (snap.get('defaultChannelIds') as string[] | undefined) ?? [];
      if (initialDefaults.current === null) {
        initialDefaults.current = ids;
        setDefaults(ids);
      }
    });
  }, []);

  const set = (patch: Partial<Branding>) => setDraft((d) => ({ ...d, ...patch }));
  const accent = isHex(draft.accent) ? draft.accent : DEFAULT_ACCENT;
  const sidebar = isHex(draft.sidebar) ? draft.sidebar : DEFAULT_SIDEBAR;
  const warning = isHex(draft.accent) ? accentWarning(draft.accent) : null;
  const previewStyle = useMemo(() => ({ ...accentVars(accent).light, ...sidebarVars(sidebar, accent) }) as CSSProperties, [accent, sidebar]);
  const name = draft.name?.trim() || DEFAULT_NAME;

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      set({ logo: await logoFromFile(f) });
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveBranding(me.id, draft);
      if (defaults && JSON.stringify(defaults) !== JSON.stringify(initialDefaults.current)) await setDefaultChannels(defaults);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  const reset = () => setDraft({ name: '', tagline: '', logo: null, accent: null, sidebar: null });

  return (
    <Modal
      title="Customize workspace"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={reset} style={{ marginRight: 'auto' }}>
            Reset to Flack defaults
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <div className={styles.layout}>
        <div className={styles.form}>
          <label className="field">
            Workspace name
            <input className="input" value={draft.name ?? ''} maxLength={NAME_MAX} placeholder={DEFAULT_NAME} onChange={(e) => set({ name: e.target.value })} />
          </label>

          <label className="field">
            Sign-in message
            <input className="input" value={draft.tagline ?? ''} maxLength={TAGLINE_MAX} placeholder={DEFAULT_TAGLINE} onChange={(e) => set({ tagline: e.target.value })} />
          </label>

          <div className="field">
            <span>Logo</span>
            <div className={styles.logoRow}>
              {draft.logo ? <img src={draft.logo} alt="Logo preview" className={styles.logo} /> : <Logo size={48} />}
              <button type="button" className="btn" onClick={() => file.current?.click()}>
                Upload logo
              </button>
              {draft.logo && (
                <button type="button" className="btn btn-ghost" onClick={() => set({ logo: null })}>
                  Remove
                </button>
              )}
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="logo-input" onChange={(e) => void upload(e.target.files?.[0])} />
            </div>
            <span className={styles.hint}>Square works best. PNG, JPG or WebP; it's resized to 256px.</span>
          </div>

          <ColorField label="Accent color" value={draft.accent ?? null} fallback={DEFAULT_ACCENT} presets={ACCENT_PRESETS} onChange={(c) => set({ accent: c })} />
          {warning && <p className={styles.warning}>{warning}</p>}
          <ColorField label="Sidebar color" value={draft.sidebar ?? null} fallback={DEFAULT_SIDEBAR} presets={SIDEBAR_PRESETS} onChange={(c) => set({ sidebar: c })} />

          <fieldset className={styles.channels}>
            <legend>New members join</legend>
            {defaults === null && <span className={styles.hint}>Loading…</span>}
            {defaults &&
              channels.map((c) => (
                <label key={c.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={defaults.includes(c.id)}
                    onChange={(e) => setDefaults((d) => (e.target.checked ? [...(d ?? []), c.id] : (d ?? []).filter((x) => x !== c.id)))}
                  />
                  #{c.name}
                </label>
              ))}
          </fieldset>
        </div>

        <div className={styles.preview} style={previewStyle} aria-label="Preview" data-testid="branding-preview">
          <div className={styles.side}>
            <div className={styles.sideHead}>
              {draft.logo && <img src={draft.logo} alt="" className={styles.sideLogo} />}
              <span>{name}</span>
            </div>
            <span className={styles.sideItem}># general</span>
            <span className={`${styles.sideItem} ${styles.sideActive}`}># engineering</span>
            <span className={styles.sideItem}># random</span>
          </div>
          <div className={styles.loginCard}>
            {draft.logo ? <img src={draft.logo} alt="" className={styles.loginLogo} /> : <Logo size={32} />}
            <strong>Sign in to {name}</strong>
            <span>{draft.tagline?.trim() || DEFAULT_TAGLINE}</span>
            <span className={styles.fakeBtn}>Continue</span>
          </div>
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

function ColorField(props: { label: string; value: string | null; fallback: string; presets: string[]; onChange: (c: string | null) => void }) {
  const [text, setText] = useState(props.value ?? '');
  useEffect(() => setText(props.value ?? ''), [props.value]);
  const current = props.value ?? props.fallback;
  return (
    <div className="field">
      <span>{props.label}</span>
      <div className={styles.swatches} role="group" aria-label={props.label}>
        {props.presets.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.swatch}
            style={{ background: c }}
            aria-label={`${props.label} ${c}`}
            aria-pressed={current.toLowerCase() === c.toLowerCase()}
            onClick={() => props.onChange(c === props.fallback ? null : c)}
          />
        ))}
        <input
          className={`input ${styles.hex}`}
          aria-label={`${props.label} hex`}
          value={text}
          placeholder={props.fallback}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (v === '') props.onChange(null);
            else if (isHex(v)) props.onChange(v.toLowerCase());
          }}
        />
      </div>
    </div>
  );
}
