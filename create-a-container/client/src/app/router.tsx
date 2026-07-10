import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './AppLayout';
import { AuthLayout } from './AuthLayout';
import { RequireAuth } from './RequireAuth';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { RegisterSuccessPage } from '@/pages/auth/RegisterSuccessPage';
import { ResetPasswordRequestPage } from '@/pages/auth/ResetPasswordRequestPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { SitesListPage } from '@/pages/sites/SitesListPage';
import { SiteFormPage } from '@/pages/sites/SiteFormPage';
import { ContainersListPage } from '@/pages/containers/ContainersListPage';
import { ContainerFormPage } from '@/pages/containers/ContainerFormPage';
import { NodesListPage } from '@/pages/nodes/NodesListPage';
import { NodeFormPage } from '@/pages/nodes/NodeFormPage';
import { NodeImportPage } from '@/pages/nodes/NodeImportPage';
import { ExternalDomainsListPage } from '@/pages/external-domains/ExternalDomainsListPage';
import { ExternalDomainFormPage } from '@/pages/external-domains/ExternalDomainFormPage';
import { JobDetailPage } from '@/pages/jobs/JobDetailPage';
import { UsersListPage } from '@/pages/users/UsersListPage';
import { UserFormPage } from '@/pages/users/UserFormPage';
import { InviteUserPage } from '@/pages/users/InviteUserPage';
import { GroupsListPage } from '@/pages/groups/GroupsListPage';
import { GroupFormPage } from '@/pages/groups/GroupFormPage';
import { ApiKeysListPage } from '@/pages/apikeys/ApiKeysListPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { ResourceRequestsPage } from '@/pages/resource-requests/ResourceRequestsPage';
import { MyRequestsPage } from '@/pages/resource-requests/MyRequestsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

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
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/sites" replace /> },

          { path: '/sites', element: <SitesListPage /> },
          { path: '/sites/new', element: <SiteFormPage /> },
          { path: '/sites/:id/edit', element: <SiteFormPage /> },

          { path: '/sites/:siteId/containers', element: <ContainersListPage /> },
          { path: '/sites/:siteId/containers/new', element: <ContainerFormPage /> },
          { path: '/sites/:siteId/containers/:id/edit', element: <ContainerFormPage /> },

          { path: '/sites/:siteId/nodes', element: <NodesListPage /> },
          { path: '/sites/:siteId/nodes/new', element: <NodeFormPage /> },
          { path: '/sites/:siteId/nodes/import', element: <NodeImportPage /> },
          { path: '/sites/:siteId/nodes/:id/edit', element: <NodeFormPage /> },

          { path: '/external-domains', element: <ExternalDomainsListPage /> },
          { path: '/external-domains/new', element: <ExternalDomainFormPage /> },
          { path: '/external-domains/:id/edit', element: <ExternalDomainFormPage /> },

          { path: '/jobs/:id', element: <JobDetailPage /> },

          { path: '/users', element: <UsersListPage /> },
          { path: '/users/new', element: <UserFormPage /> },
          { path: '/users/invite', element: <InviteUserPage /> },
          { path: '/users/:uid/edit', element: <UserFormPage /> },

          { path: '/groups', element: <GroupsListPage /> },
          { path: '/groups/new', element: <GroupFormPage /> },
          { path: '/groups/:id/edit', element: <GroupFormPage /> },

          { path: '/apikeys', element: <ApiKeysListPage /> },

          { path: '/settings', element: <SettingsPage /> },

          { path: '/resource-requests', element: <ResourceRequestsPage /> },
          { path: '/my-requests', element: <MyRequestsPage /> },

          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
