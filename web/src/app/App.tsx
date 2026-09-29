import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { BrandingProvider } from '../data/branding';
import { WorkspaceProvider } from '../data/workspace';
import { UnreadCountsProvider } from '../data/unreadCounts';
import { LoginPage } from '../pages/Login';
import { InviteLandingPage } from '../pages/InviteLanding';
import { Shell } from './Shell';
import { HomeRoute } from '../pages/Home';
import { ChannelPage } from '../pages/ChannelPage';
import { AdminPage } from '../pages/AdminPage';
import { ActivityPage } from '../pages/ActivityPage';
import { DmsPage } from '../pages/DmsPage';
import { LaterPage } from '../pages/LaterPage';
import { SearchPage } from '../pages/SearchPage';
import { NotFound } from '../pages/NotFound';

function RequireAuth() {
  const { user, profile } = useAuth();
  const location = useLocation();
  if (user === undefined || (user && !profile)) {
    return (
      <div className="center-page" aria-busy="true">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />;
  }
  return (
    <WorkspaceProvider>
      <UnreadCountsProvider>
        <Outlet />
      </UnreadCountsProvider>
    </WorkspaceProvider>
  );
}

function RequireAdmin() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/invite/:token', element: <InviteLandingPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Shell />,
        children: [
          { index: true, element: <HomeRoute /> },
          { path: 'c/:channelId', element: <ChannelPage /> },
          { path: 'c/:channelId/t/:threadId', element: <ChannelPage /> },
          { path: 'dms', element: <DmsPage /> },
          { path: 'activity', element: <ActivityPage /> },
          { path: 'later', element: <LaterPage /> },
          { path: 'saved', element: <Navigate to="/later" replace /> },
          { path: 'search', element: <SearchPage /> },
          { element: <RequireAdmin />, children: [{ path: 'admin', element: <AdminPage /> }] },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <BrandingProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </BrandingProvider>
  );
}
