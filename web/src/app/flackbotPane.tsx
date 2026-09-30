import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Pane {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const PaneContext = createContext<Pane>({ open: false, setOpen: () => undefined, toggle: () => undefined });
const KEY = 'flack:flackbot:pane';

/** Whether the Ask Flackbot pane is open (desktop), remembered per browser. */
export function FlackbotPaneProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      // private mode
    }
  }, []);
  const value = useMemo(() => ({ open, setOpen, toggle: () => setOpen(!open) }), [open, setOpen]);
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

export const useFlackbotPane = () => useContext(PaneContext);
