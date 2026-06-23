/**
 * Centralized query keys + fetcher functions for TanStack Query.
 * Each `keys.x()` returns a stable tuple that callers pass to useQuery.
 */
import { api } from './api';
import type {
  ApiKey,
  Container,
  ContainerMetadata,
  ContainerNewBootstrap,
  EffectiveResources,
  ExternalDomain,
  Group,
  Job,
  JobStatusRow,
  Node,
  AppSettings,
  ResourceRequest,
  Site,
  User,
} from './types';

export const keys = {
  sites: () => ['sites'] as const,
  site: (id: number | string) => ['sites', String(id)] as const,
  nodes: (siteId: number | string) => ['sites', String(siteId), 'nodes'] as const,
  node: (siteId: number | string, id: number | string) =>
    ['sites', String(siteId), 'nodes', String(id)] as const,
  containers: (siteId: number | string) => ['sites', String(siteId), 'containers'] as const,
  containersAll: (siteId: number | string, params?: Record<string, string | undefined>) =>
    ['sites', String(siteId), 'containers', 'all', params ?? {}] as const,
  container: (siteId: number | string, id: number | string) =>
    ['sites', String(siteId), 'containers', String(id)] as const,
  containerBootstrap: (siteId: number | string) =>
    ['sites', String(siteId), 'containers', 'new'] as const,
  containerMetadata: (image: string) => ['container-metadata', image] as const,
  externalDomains: () => ['external-domains'] as const,
  externalDomain: (id: number | string) => ['external-domains', String(id)] as const,
  users: () => ['users'] as const,
  user: (uid: number | string) => ['users', String(uid)] as const,
  groups: () => ['groups'] as const,
  group: (id: number | string) => ['groups', String(id)] as const,
  apikeys: () => ['apikeys'] as const,
  settings: () => ['settings'] as const,
  job: (id: number | string) => ['jobs', String(id)] as const,
  jobStatuses: (id: number | string) => ['jobs', String(id), 'statuses'] as const,
  resourceRequests: (status?: string) => ['resource-requests', status || 'all'] as const,
  resourceRequestCount: () => ['resource-requests', 'count'] as const,
  effectiveResources: (siteId: number | string, hostname: string, username: string) =>
    ['resource-requests', 'effective', String(siteId), hostname, username] as const,
};

export const queries = {
  // Sites
  listSites: () => api.get<Site[]>('/api/v1/sites'),
  getSite: (id: number | string) => api.get<Site>(`/api/v1/sites/${id}`),

  // Nodes
  listNodes: (siteId: number | string) =>
    api.get<Node[]>(`/api/v1/sites/${siteId}/nodes`),
  getNode: (siteId: number | string, id: number | string) =>
    api.get<Node>(`/api/v1/sites/${siteId}/nodes/${id}`),

  // Containers
  listContainers: (siteId: number | string) =>
    api.get<Container[]>(`/api/v1/sites/${siteId}/containers`),
  listAllContainers: (
    siteId: number | string,
    params?: { nodeId?: string; hostname?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params?.nodeId) qs.set('nodeId', params.nodeId);
    if (params?.hostname) qs.set('hostname', params.hostname);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<Container[]>(`/api/v1/sites/${siteId}/containers/all${suffix}`);
  },
  getContainer: (siteId: number | string, id: number | string) =>
    api.get<Container>(`/api/v1/sites/${siteId}/containers/${id}`),
  containerBootstrap: (siteId: number | string) =>
    api.get<ContainerNewBootstrap>(`/api/v1/sites/${siteId}/containers/new`),
  containerMetadata: (siteId: number | string, image: string) =>
    api.get<ContainerMetadata>(
      `/api/v1/sites/${siteId}/containers/metadata?image=${encodeURIComponent(image)}`,
    ),

  // External domains
  listExternalDomains: () => api.get<ExternalDomain[]>('/api/v1/external-domains'),
  getExternalDomain: (id: number | string) =>
    api.get<ExternalDomain>(`/api/v1/external-domains/${id}`),

  // Users
  listUsers: () => api.get<User[]>('/api/v1/users'),
  getUser: (uid: number | string) => api.get<User>(`/api/v1/users/${uid}`),

  // Groups
  listGroups: () => api.get<Group[]>('/api/v1/groups'),
  getGroup: (id: number | string) => api.get<Group>(`/api/v1/groups/${id}`),

  // API keys
  listApiKeys: () => api.get<ApiKey[]>('/api/v1/apikeys'),

  // Settings
  getSettings: () => api.get<AppSettings>('/api/v1/settings'),

  // Jobs
  getJob: (id: number | string) => api.get<Job>(`/api/v1/jobs/${id}`),
  getJobStatuses: (id: number | string, offset = 0, limit = 1000) =>
    api.get<JobStatusRow[]>(`/api/v1/jobs/${id}/status?offset=${offset}&limit=${limit}`),

  // Resource Requests
  listResourceRequests: (status?: string) =>
    api.get<ResourceRequest[]>(
      `/api/v1/resource-requests${status ? `?status=${status}` : ''}`,
    ),
  getResourceRequestCount: () =>
    api.get<{ count: number }>('/api/v1/resource-requests/count'),
  getEffectiveResources: (siteId: number | string, hostname: string, username: string) =>
    api.get<EffectiveResources>(
      `/api/v1/resource-requests/effective/${siteId}/${encodeURIComponent(hostname)}/${encodeURIComponent(username)}`,
    ),
};
