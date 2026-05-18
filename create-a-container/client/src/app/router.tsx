import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './AppLayout';
import { AuthLayout } from './AuthLayout';
import { PlaceholderPage } from './PlaceholderPage';
import { RequireAuth } from './RequireAuth';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { RegisterSuccessPage } from '@/pages/auth/RegisterSuccessPage';
import { ResetPasswordRequestPage } from '@/pages/auth/ResetPasswordRequestPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/register/invite/:token', element: <RegisterPage /> },
      { path: '/register/success', element: <RegisterSuccessPage /> },
      { path: '/reset-password', element: <ResetPasswordRequestPage /> },
      { path: '/reset-password/:token', element: <ResetPasswordPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [{
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/sites" replace /> },
      { path: '/sites', element: <PlaceholderPage title="Sites" /> },
      { path: '/sites/new', element: <PlaceholderPage title="New Site" /> },
      { path: '/sites/:id/edit', element: <PlaceholderPage title="Edit Site" /> },
      { path: '/sites/:siteId/containers', element: <PlaceholderPage title="Containers" /> },
      { path: '/sites/:siteId/containers/new', element: <PlaceholderPage title="New Container" /> },
      { path: '/sites/:siteId/containers/:id/edit', element: <PlaceholderPage title="Edit Container" /> },
      { path: '/sites/:siteId/nodes', element: <PlaceholderPage title="Nodes" /> },
      { path: '/sites/:siteId/nodes/new', element: <PlaceholderPage title="New Node" /> },
      { path: '/sites/:siteId/nodes/import', element: <PlaceholderPage title="Import Nodes" /> },
      { path: '/sites/:siteId/nodes/:id/edit', element: <PlaceholderPage title="Edit Node" /> },
      { path: '/external-domains', element: <PlaceholderPage title="External Domains" /> },
      { path: '/external-domains/new', element: <PlaceholderPage title="New External Domain" /> },
      { path: '/external-domains/:id/edit', element: <PlaceholderPage title="Edit External Domain" /> },
      { path: '/jobs/:id', element: <PlaceholderPage title="Job" /> },
      { path: '/users', element: <PlaceholderPage title="Users" /> },
      { path: '/users/new', element: <PlaceholderPage title="New User" /> },
      { path: '/users/invite', element: <PlaceholderPage title="Invite User" /> },
      { path: '/users/:uid/edit', element: <PlaceholderPage title="Edit User" /> },
      { path: '/groups', element: <PlaceholderPage title="Groups" /> },
      { path: '/groups/new', element: <PlaceholderPage title="New Group" /> },
      { path: '/groups/:id/edit', element: <PlaceholderPage title="Edit Group" /> },
      { path: '/apikeys', element: <PlaceholderPage title="API Keys" /> },
      { path: '/apikeys/new', element: <PlaceholderPage title="New API Key" /> },
      { path: '/apikeys/created', element: <PlaceholderPage title="API Key Created" /> },
      { path: '/apikeys/:id', element: <PlaceholderPage title="API Key" /> },
      { path: '/settings', element: <PlaceholderPage title="Settings" /> },
      { path: '*', element: <PlaceholderPage title="Not Found" /> },
    ],
  }],
  },
]);
