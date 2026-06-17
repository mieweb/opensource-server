# Reusable Container API Actions

Composite GitHub Actions that wrap the [Create-a-Container API](../../create-a-container/openapi.v1.yaml). They are the single source of truth for talking to the API from CI, so downstream consumers (notably [`mieweb/launchpad`](../../launchpad.yml)) never embed raw `curl` calls that drift out of sync with API changes.

Each action is a thin, single-purpose wrapper around one API operation. Orchestration (naming containers, deciding when to recreate, gating on events) belongs to the caller.

| Action | Purpose | API call |
| --- | --- | --- |
| [`get-container`](get-container/action.yml) | Fetch a container by hostname | `GET /api/v1/sites/{siteId}/containers?hostname=` |
| [`create-container`](create-container/action.yml) | Create a container | `POST /api/v1/sites/{siteId}/containers` |
| [`delete-container`](delete-container/action.yml) | Delete a container by ID | `DELETE /api/v1/sites/{siteId}/containers/{id}` |
| [`wait-for-job`](wait-for-job/action.yml) | Poll a job until it finishes | `GET /api/v1/jobs/{id}` |

## Usage

Reference an action by its directory (GitHub resolves the `action.yml` inside it):

```yaml
- uses: mieweb/opensource-server/.github/actions/create-container@latest
  id: create
  with:
    api_url: ${{ inputs.api_url }}
    api_key: ${{ inputs.api_key }}
    site_id: "1"
    hostname: my-container
    template_name: ghcr.io/mieweb/timeharbor:latest

- uses: mieweb/opensource-server/.github/actions/wait-for-job@latest
  if: steps.create.outputs.created == 'true'
  with:
    api_url: ${{ inputs.api_url }}
    api_key: ${{ inputs.api_key }}
    job_id: ${{ steps.create.outputs.job_id }}
```

`wait-for-job` is kept separate from `create-container` so future flows (e.g. modifying an existing container) can reuse the polling logic.

## Versioning and pinning

`uses:` refs must be literal — GitHub does not let you interpolate `${{ github.action_ref }}` into a nested `uses:` value, so the ref a caller passes to `mieweb/launchpad@<ref>` cannot automatically flow through to these actions. To pin against API/cluster changes:

1. Tag releases of this repo (e.g. `v2026.6.2`).
2. Tag a matching `mieweb/launchpad` release whose `uses:` lines reference that same tag.
3. Consumers pin `mieweb/launchpad@v2026.6.2`.

Use a floating ref (`@latest` or `@main`) only when you accept breaking changes on each release.
