import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { FlackbotPanel } from '../components/FlackbotPanel';
import { useFlackbotPane } from '../app/flackbotPane';
import { useIsMobile } from '../lib/hooks';

/** Phones: Ask Flackbot full screen. On a desktop this just opens the pane. */
export function FlackbotPage() {
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const { setOpen } = useFlackbotPane();
  useEffect(() => {
    if (!mobile) setOpen(true);
  }, [mobile, setOpen]);
  if (!mobile) return <Navigate to="/" replace />;
  return <FlackbotPanel variant="page" onClose={() => (history.length > 1 ? navigate(-1) : navigate('/'))} />;
}
