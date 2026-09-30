/**
 * Manager API types, derived from the Manager's own OpenAPI spec
 * (`create-a-container/openapi.v1.yaml`, regenerated with `pnpm gen:types`).
 * Aliases only — the provider never hand-writes a Manager response shape.
 */

import type { components } from './generated/manager-api.ts';

type Schemas = components['schemas'];

export type Container = Schemas['Container'];
export type ContainerService = Schemas['ContainerService'];
export type ServiceInput = Schemas['ServiceInput'];
export type ServiceUpdate = Schemas['ServiceUpdate'];
export type EnvVar = Schemas['EnvVar'];
export type VolumeAttach = Schemas['VolumeAttach'];
export type Volume = Schemas['Volume'];

/** `Job.status` as returned by `get_job`. */
export type JobStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled';

export interface Job {
  id: number;
  status: JobStatus;
  command?: string;
  createdBy?: string;
}

export interface JobLogRow {
  id: number;
  output: string;
  createdAt?: string;
}

/** `get_new_container_form` payload. */
export interface NewContainerForm {
  siteId: number;
  externalDomains: { id: number; name: string; siteId?: number | null }[];
  nvidiaAvailable: boolean;
}

/** `create_container` 201 payload (`containerId` is the Manager DB id). */
export interface CreateContainerResult {
  containerId: number;
  jobId: number;
  hostname: string;
  status: string;
}

/** `update_container` 200 payload. */
export interface UpdateContainerResult {
  containerId: number;
  jobId?: number | null;
  dnsWarnings?: string[];
  pendingRestart?: boolean;
  message?: string;
}

export interface DeleteContainerResult {
  deleted: boolean;
  dnsWarnings?: string[];
}

export interface SessionInfo {
  user: string;
  isAdmin: boolean;
}

export interface CreatedApiKey {
  id: string;
  key: string;
}
