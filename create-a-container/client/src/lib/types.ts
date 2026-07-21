/**
 * Typed resource models matching /api/v1 response shapes.
 * Keep in sync with the serializers in routers/api/v1/*.
 */

export interface Site {
  id: number;
  name: string;
  internalDomain: string;
  dhcpRange: string | null;
  subnetMask: string | null;
  gateway: string | null;
  dnsForwarders: string | null;
  externalIp: string | null;
  nodeCount?: number;
}

export interface Node {
  id: number;
  name: string;
  siteId: number;
  ipv4Address: string | null;
  apiUrl: string | null;
  tokenId: string | null;
  tlsVerify: boolean | null;
  imageStorage: string;
  volumeStorage: string;
  networkBridge: string;
  nvidiaAvailable: boolean;
  hasSecret: boolean;
}

export interface AgentServiceStatus {
  /** systemd ActiveState: active, inactive, failed, ... */
  state: string;
  /** Outcome of the agent's last config apply for this service. */
  lastApply: 'success' | 'failure' | 'unknown';
}

export interface Agent {
  id: number;
  siteId: number;
  siteName: string | null;
  hostname: string;
  ipv4Address: string | null;
  services: Record<string, AgentServiceStatus> | null;
  lastCheckinAt: string | null;
  /** Server-computed, so it is immune to client clock drift. */
  secondsSinceCheckin: number | null;
}

export interface ExternalDomain {
  id: number;
  name: string;
  acmeEmail: string | null;
  acmeDirectoryUrl: string | null;
  cloudflareApiEmail: string | null;
  siteId: number | null;
  site: { id: number; name: string } | null;
  authServer: string | null;
  hasCloudflareApiKey: boolean;
}

export interface ServiceHttp {
  id: number;
  externalHostname: string;
  externalDomainId: number;
  backendProtocol: 'http' | 'https';
  authRequired: boolean;
  domain?: string;
}
export interface ServiceTransport {
  id: number;
  protocol: 'tcp' | 'udp';
  externalPort: number;
}
export interface ServiceDns {
  id: number;
  recordType: string;
  dnsName: string;
}
export interface ContainerService {
  id: number;
  type: 'http' | 'transport' | 'dns';
  internalPort: number;
  httpService: ServiceHttp | null;
  transportService: ServiceTransport | null;
  dnsService: ServiceDns | null;
}

export interface Container {
  id: number;
  containerId: number | null;
  hostname: string;
  owner: string;
  /** Usernames this container is shared with (collaborators). */
  collaborators: string[];
  ipv4Address: string | null;
  macAddress: string | null;
  status: ContainerStatus;
  template: string | null;
  creationJobId: number | null;
  entrypoint: string | null;
  environmentVars: Record<string, string>;
  nvidiaRequested: boolean;
  sshPort: number | null;
  sshHost: string | null;
  httpEntries: { port: number; externalUrl: string | null }[];
  nodeName: string | null;
  nodeApiUrl: string | null;
  services: ContainerService[];
  createdAt: string;
}

/**
 * Live container status resolved from Proxmox run-state + create-job state.
 * Embedded on each Container returned by the list/show/create endpoints.
 */
export type ContainerStatus =
  | 'running'
  | 'offline'
  | 'creating'
  | 'failed'
  | 'missing'
  | 'unknown';

export interface ContainerCreateResult {
  containerId: number;
  jobId: number;
  hostname: string;
  status: ContainerStatus;
}

export interface ContainerNewBootstrap {
  siteId: number;
  externalDomains: { id: number; name: string }[];
  nvidiaAvailable: boolean;
}

export interface ContainerMetadata {
  ports?: { port: number; protocol: string }[];
  httpServices?: { port: number; hostnameSuffix?: string; requireAuth?: boolean }[];
  entrypoint?: string;
  env?: Record<string, string>;
}

export interface Job {
  id: number;
  command: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface JobStatusRow {
  id: number;
  jobId: number;
  output: string;
  createdAt: string;
}

export interface User {
  uidNumber: number;
  uid: string;
  givenName: string;
  sn: string;
  cn: string;
  mail: string;
  status: 'pending' | 'active' | 'disabled';
  groups?: { gidNumber: number; cn: string; isAdmin: boolean }[];
  isAdmin: boolean;
}

export interface Group {
  gidNumber: number;
  cn: string;
  isAdmin: boolean;
  userCount?: number;
}

export interface ApiKey {
  id: number;
  keyPrefix: string;
  description: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyCreated extends ApiKey {
  key: string;
  warning: string;
}

export interface AppSettings {
  smtpUrl: string;
  smtpNoreplyAddress: string;
  netboxUrl: string;
  netboxToken: string;
  defaultContainerEnvVars: { key: string; value: string; description?: string }[];
}

export type ResourceType = 'memory' | 'swap' | 'cpus' | 'rootfs';

export interface ResourceRequest {
  id: number;
  siteId: number;
  hostname: string;
  username: string;
  requestedBy?: never;
  resourceType: ResourceType;
  value: number;
  status: 'pending' | 'approved' | 'denied';
  comment: string | null;
  adminComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  site?: { id: number; name: string };
}

export interface EffectiveResources {
  memory: number;
  swap: number;
  cpus: number;
  rootfs: number;
}
