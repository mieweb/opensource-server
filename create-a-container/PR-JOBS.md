# Job Runner & Jobs API — PR Notes

This PR adds an async job system for the `create-a-container` service. It includes Sequelize models and migrations, a background `job-runner` service, API endpoints to query jobs/status, and a systemd unit for the runner.

## Summary of changes
- **Models & migrations**
  - `models/job.js` — `Job` model with `command` and `status` (enum: `pending`, `running`, `success`, `failure`, `cancelled`).
  - `models/job.js` — `Job` model with `command`, `status`, and `createdBy` (owner) to scope access.
  - `models/jobstatus.js` — `JobStatus` model storing `jobId` and `output` (text). Timestamps are used to order output.
  - `migrations/20251117120000-create-jobs.js`
  - `migrations/20251117120001-create-jobstatuses.js`
  - `migrations/20251117120002-add-job-createdby.js` — adds nullable `createdBy` column and index to `Jobs` for ownership lookups.

- **Job runner**
  - `job-runner.js` — Node process that polls the `Jobs` table for pending jobs, claims them transactionally, spawns the job command (`shell`), streams stdout/stderr into `JobStatuses`, and updates job `status` on exit.
  - `job-runner.service` — example systemd unit (repo path `create-a-container/job-runner.service`) that runs the runner from `/opt/container-creator`.

- **API**
  - `routers/jobs.js` — new endpoints mounted at `/jobs` (see API section). Note: authenticated users may create jobs; jobs are owned by their creator (`createdBy`). Only the owner or admins may view job metadata and status rows.
  - `server.js` mounts the router at `/jobs`.

## Rationale
- Long-running container creation and provisioning tasks should be executed outside HTTP request lifecycles to avoid timeouts and to report progress reliably.

## API Endpoints
- `POST /jobs` — enqueue a job (authenticated users)
  - Body: `{ "command": "<shell command>" }`
  - Response: `201 { id, status }`

Behavior: the creating user's username (from session) is recorded in the `createdBy` column. Jobs created before the migration will have `createdBy = NULL` and remain viewable only to admins.

- `GET /jobs/:id` — job metadata

-- `GET /jobs/:id/status` — job output rows
  - Query params: `offset` (optional, default 0), `limit` (optional, max 1000)

## Systemd unit & env file
- Unit (example) `job-runner.service` in repo. Install on target host as `/etc/systemd/system/job-runner.service`.
- Recommended: create `/etc/default/container-creator` with DB env vars and add `EnvironmentFile=/etc/default/container-creator` to the unit.

## Environment variables used
- DB: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`.
- Optional runner config:
  - `JOB_RUNNER_POLL_MS` — poll interval (ms), default `2000`.
  - `JOB_RUNNER_CWD` — working directory for spawned commands (defaults to the service working directory).

## Security considerations
- The runner executes shell commands. Do NOT expose `POST /jobs` to untrusted users. The route allows authenticated users to create jobs, but job viewing is scoped: only the job owner or an admin can read job metadata and statuses. Ensure admin accounts are tightly controlled.

## Testing & verification steps (manual)
1. Run migrations:
   ```bash
   cd create-a-container
   npm run db:migrate
   ```
2. Start job-runner locally for testing:
   ```bash
   cd create-a-container
   npm run job-runner
   ```
3. Enqueue a safe job (admin user):
  ```bash
  curl -X POST -H "Content-Type: application/json" -b cookiejar.txt -d '{"command":"/bin/echo hello && sleep 1 && /bin/echo done"}' https://your-host/jobs
  ```

Note: run migrations before testing so the `createdBy` column exists. Existing jobs (pre-migration) will have `createdBy = NULL` and are only visible to admins.

## DB inspection examples
- Pending jobs:
  ```sql
  SELECT id, command, status, createdAt FROM Jobs WHERE status='pending' ORDER BY createdAt;
  ```
- Job output:
  ```sql
  SELECT id, output, createdAt FROM JobStatuses WHERE jobId = 123 ORDER BY createdAt ASC;
  ```

## Deployment checklist for production
1. Apply DB migrations in your target environment.
2. Deploy code and place `job-runner.service` at `/etc/systemd/system/`.
3. Create `/etc/default/container-creator` with DB credentials and desired runner env vars.
4. Reload systemd: `sudo systemctl daemon-reload`.
5. Enable & start services:
   ```bash
   sudo systemctl enable --now container-creator.service
   sudo systemctl enable --now job-runner.service
   ```

## Follow-ups (optional)
- Replace raw `command` API with safe task names and parameter mapping.
- Add SSE or WebSocket streaming endpoint (`/jobs/:id/stream`) to push log lines to the frontend.
- Add batching or file-based logs for high-volume output to reduce DB pressure.