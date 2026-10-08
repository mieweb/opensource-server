/**
 * Manager API types, all derived from the Manager's OpenAPI spec
 * (`create-a-container/openapi.v1.yaml`, regenerated with `pnpm gen:types`).
 * Request/response shapes come straight from `paths` via the typed client;
 * these are just names for the schemas the provider passes around.
 */

import type { components, paths } from './generated/manager-api.ts';

type Schemas = components['schemas'];

export type Container = Schemas['Container'];
export type ServiceUpdate = Schemas['ServiceUpdate'];
export type EnvVar = Schemas['EnvVar'];
export type VolumeAttach = Schemas['VolumeAttach'];

/** `update_container` request body. */
export type UpdateBody = NonNullable<
  paths['/sites/{siteId}/containers/{id}']['put']['requestBody']
>['content']['application/json'];

/** `get_new_container_form` payload. */
export type NewContainerForm = NonNullable<
  paths['/sites/{siteId}/containers/new']['get']['responses']['200']['content']['application/json']['data']
>;
