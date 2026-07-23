# The MVC Manifesto — create-a-container

Audience: every human and every coding agent that touches this app.
Status: **normative**. New code MUST follow this document. Existing code is
migrated incrementally (see [Migration Playbook](#the-migration-playbook)).

---

## 1. Why

`routers/api/v1/containers.js` is 860 lines. Its `POST /` handler is ~175
lines and does request parsing, validation, node-selection policy, eight
model writes, manual transaction commit/rollback, and error mapping — in one
function. Every route file re-declares its own `serialize()`. Business rules
(least-loaded-node selection, auto-approval policy, DNS side effects) live
inside HTTP handlers where they cannot be tested, reused by `job-runner.js`,
or reasoned about independently.

This is the "god route" pattern, and it stops here.

## 2. The layers

Code is organized **by resource, not by layer**: everything about one
resource lives together in one folder (see §3). Within a resource folder,
the layers below still apply, and **dependencies point strictly downward.**
A layer may only import from layers below it (and from `validator.js` /
`serializer.js` as noted).

```
router.js      Wiring only: paths, middleware, controller method. No logic.
controller.js  HTTP translation: validate input, call ONE service method,
               send the response. No business logic, no model imports.
service.js     Business logic. Owns transactions. Orchestrates repositories
               and integrations. Knows nothing about req/res.
repository.js  Sequelize queries only. The ONLY layer that imports models
               for query purposes. No business decisions, no HTTP concepts.
models/        Sequelize models (shared, already exists). Schema,
               associations, and intrinsic data behavior only
               (e.g. normalizeEnvVars).
utils/         External integrations (proxmox-api, netbox, cloudflare-dns,
               email, docker-registry). Called by services, never by
               controllers or routers.
```

Two supporting files per resource, callable from the layers indicated:

```
validator.js   Request-shape validation (zod schemas). Used by the router
               via the shared validate() middleware.
serializer.js  DB row -> API JSON. Used by controllers (and services when
               composing job payloads). One serializer per resource,
               declared ONCE, shared by every route that returns it.
```

### The one-sentence test

If you cannot describe a function in one sentence without the word "and",
it belongs in more than one layer.

### Hard rules

1. **Routers contain zero `async` functions.** A `router.js` is a table of
   contents: `router.post('/', validate(schema), ctrl.create)`.
2. **Controllers never import `models/`** and never open transactions.
   A controller reads `req`, calls one service method, and responds with the
   existing helpers (`ok`, `created`, `noContent` from `middlewares/api.js`).
3. **Services never touch `req`/`res`** and never `require('express')`.
   Inputs are plain objects (already validated), outputs are plain
   objects/model instances. Services own `sequelize.transaction()` — always
   the callback form, never manual `commit()`/`rollback()`.
4. **Repositories never throw `ApiError`.** They return rows or `null`.
   Deciding that a missing row is a 404 is a service/controller decision.
5. **Services may throw `ApiError`** (`middlewares/api.js:134`). It is the
   established error contract of this app; `jsonErrorHandler` already maps
   it. Do not invent a parallel error hierarchy.
6. **One serializer per resource**, in that resource's `serializer.js`.
   Never re-declare `serialize()` in a router, controller, or service. If a
   resource needs to render another resource (e.g. a container embedding
   its services), import the other resource's serializer.
7. **No `console.error`-and-continue in handlers.** Swallowing errors from
   external systems (Proxmox, NetBox, DNS) is a *service-level policy
   decision* — if a failure is genuinely non-fatal, the service catches it,
   logs it, and records the degradation explicitly; it does not silently
   proceed inside a route handler.
8. **CommonJS, Express 5, Sequelize 6.** Match the existing codebase. Do not
   introduce ESM, ORMs, or frameworks as part of this refactor.
9. **The wire contract is frozen.** Success `{ data, meta? }`, error
   `{ error: { code, message, fields? } }`, same status codes, same paths.
   The React client and `openapi.v1.yaml` must not notice the refactor.

## 3. Directory layout (target)

Resource-first: one folder per resource under `resources/`, containing that
resource's entire vertical slice. Cross-cutting code stays in the shared
top-level folders.

```
create-a-container/
├── resources/
│   ├── apikeys/
│   │   ├── router.js
│   │   ├── controller.js
│   │   ├── service.js
│   │   ├── repository.js
│   │   ├── serializer.js
│   │   └── validator.js
│   ├── containers/
│   │   ├── router.js, controller.js, serializer.js, validator.js
│   │   ├── service/              # large layers become folders
│   │   │   ├── index.js          # public API; re-exports the modules
│   │   │   ├── provisioning.js
│   │   │   └── collaborators.js
│   │   └── repository.js
│   ├── users/
│   └── ...
├── routers/api/v1/index.js   # stays: mounts each resources/<r>/router.js,
│                             #        keeps csrf/health/openapi inline routes
├── middlewares/              # stays as-is; shared (api.js is the contract,
│                             #        plus the new validate.js)
├── models/                   # stays as-is; shared across resources
└── utils/                    # stays; shared integration clients only
```

Rules of the folder:

- Resource folder names match the URL segment: `resources/apikeys/`,
  `resources/resource-requests/`, `resources/external-domains/`.
- File names are fixed: `router.js`, `controller.js`, `service.js`,
  `repository.js`, `serializer.js`, `validator.js`. When a layer outgrows a
  single file, promote it to a folder of focused modules with an `index.js`
  as its public API: `service.js` becomes `service/index.js` +
  `service/provisioning.js`, `service/collaborators.js`, etc. Node resolves
  `require('./service')` to either form, so callers never change. Never use
  suffix names like `provisioning.service.js`.
- Cross-resource imports go **service-to-service or serializer-to-
  serializer** (e.g. `resources/containers/service.js` may require
  `resources/jobs/service.js`). Never reach into another resource's
  repository — its service is its public API.
- `routers/api/v1/index.js` remains the single mount point:
  `router.use('/apikeys', require('../../../resources/apikeys/router'))`.

## 4. What a new route looks like — from day one

The example below is the complete, real pattern. Copy it. It uses the
`apikeys` resource because it is small enough to show every layer.

### `resources/apikeys/validator.js`

```js
const { z } = require('zod');

const createApiKey = z.object({
  description: z.string().trim().max(255).optional(),
});

module.exports = { createApiKey };
```

### `middlewares/validate.js` (shared, already written — see the file)

```js
// validate(schema)                     -> validates req.body
// validate({ body, params, query })    -> validates each part
// Parsed values land on req.validated.{body,params,query}; failures become
// ApiError(400, 'invalid_request') with per-field messages.
router.post('/', validate(createApiKey), ctrl.create);
```

### `resources/apikeys/repository.js`

```js
const { ApiKey } = require('../../models');

const LIST_ATTRS = ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt'];

async function findAllForUser(uidNumber) {
  return ApiKey.findAll({
    where: { uidNumber },
    order: [['createdAt', 'DESC']],
    attributes: LIST_ATTRS,
  });
}

async function findForUser(id, uidNumber) {
  return ApiKey.findOne({ where: { id, uidNumber }, attributes: LIST_ATTRS });
}

async function create(fields, options = {}) {
  return ApiKey.create(fields, options);
}

module.exports = { findAllForUser, findForUser, create };
```

### `resources/apikeys/service.js`

```js
const repo = require('./repository');
const { createApiKeyData } = require('../../utils/apikey');
const { ApiError } = require('../../middlewares/api');

async function listKeys(user) {
  return repo.findAllForUser(user.uidNumber);
}

async function createKey(user, { description }) {
  const data = await createApiKeyData(user.uidNumber, description);
  const key = await repo.create({
    uidNumber: data.uidNumber,
    keyPrefix: data.keyPrefix,
    keyHash: data.keyHash,
    description: data.description,
  });
  return { key, plainKey: data.plainKey };
}

async function deleteKey(user, id) {
  const key = await repo.findForUser(id, user.uidNumber);
  if (!key) throw new ApiError(404, 'not_found', 'API key not found');
  await key.destroy();
}

module.exports = { listKeys, createKey, deleteKey };
```

### `resources/apikeys/serializer.js`

```js
function serializeApiKey(k) {
  return {
    id: k.id,
    keyPrefix: k.keyPrefix,
    description: k.description,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  };
}

module.exports = { serializeApiKey };
```

### `resources/apikeys/controller.js`

```js
const svc = require('./service');
const { serializeApiKey } = require('./serializer');
const { asyncHandler, ok, created, noContent } = require('../../middlewares/api');

const list = asyncHandler(async (req, res) => {
  const keys = await svc.listKeys(req.user);
  return ok(res, keys.map(serializeApiKey));
});

const create = asyncHandler(async (req, res) => {
  const { key, plainKey } = await svc.createKey(req.user, req.validated.body);
  return created(res, {
    ...serializeApiKey(key),
    key: plainKey,
    warning: 'This is the only time the full API key will be displayed. Store it securely.',
  });
});

const remove = asyncHandler(async (req, res) => {
  await svc.deleteKey(req.user, req.params.id);
  return noContent(res);
});

module.exports = { list, create, remove };
```

### `resources/apikeys/router.js` — the whole file

```js
const express = require('express');
const { apiAuth } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { createApiKey } = require('./validator');
const ctrl = require('./controller');

const router = express.Router();
router.use(apiAuth);

router.get('/', ctrl.list);
router.post('/', validate(createApiKey), ctrl.create);
router.delete('/:id', ctrl.remove);

module.exports = router;
```

That router file is the entire ambition of this refactor: you can read the
whole API surface of a resource in ten lines, every layer below it is
independently testable, and everything about the resource is in one folder.

### Transactions (for services that need them)

Always the callback form — commit/rollback is automatic:

```js
// resources/containers/service/provisioning.js
async function createContainer(user, input) {
  return sequelize.transaction(async (t) => {
    const node = await nodesService.findLeastLoaded({ transaction: t });
    const container = await repo.create({ ...input, nodeId: node.id }, { transaction: t });
    await repo.createServices(container.id, input.services, { transaction: t });
    await jobsService.enqueue('create-container', { containerId: container.id }, { transaction: t });
    return container;
  });
}
```

Repositories accept an `options` object and pass it through, so the same
repository works inside and outside a transaction. **External side effects
(Proxmox, Cloudflare, NetBox, email) do not belong inside DB transactions**
— do them after commit, or enqueue a Job (the existing pattern) and let
`job-runner.js` do them.

## 5. Testing

The server currently has **zero tests**. The refactor is the opportunity;
extraction without tests is just moving risk around.

- Framework: `jest` + `supertest`, sqlite in-memory (the dev dialect already
  supported by `config/config.js`).
- Tests live with their resource: `resources/<r>/__tests__/` (note:
  `models/index.js` already skips `.test.js` files when auto-loading).
- **Services** get unit tests (mock repositories/integrations — plain
  functions make this trivial, no DI framework needed).
- **Routes** get thin integration tests through supertest: status code +
  envelope shape per endpoint. These are the safety net for migrations.
- Rule: **a route may not be migrated until integration tests pin its
  current behavior** (see playbook step 1).

## 6. The Migration Playbook

Strategy: **strangler fig, one resource per PR.** No big-bang rewrite, no
`v2/` directory, no behavior changes mixed with structural changes.

### Per-resource recipe

1. **Pin behavior.** Write supertest integration tests against the existing
   routes: every endpoint, happy path + main error paths, asserting status
   codes and response envelopes. Commit these first — they must pass before
   and after.
2. **Create `resources/<r>/` and extract the serializer** to
   `serializer.js`; import it back into the legacy route. Diff should be
   mechanical.
3. **Extract `repository.js`.** Move every `Model.findAll/findOne/create/...`
   call and query-builder helper (e.g. `buildContainerListWhere`,
   `visibleToClauses` in `containers.js:216-270`) into it.
4. **Extract `service.js`.** Move business logic and transaction management.
   Convert manual `t.commit()/t.rollback()` to callback-form transactions.
   This is the step where god routes actually die — take the opportunity to
   split 175-line handlers into named service functions
   (`selectLeastLoadedNode`, `attachCollaborators`, `provisionServices`).
5. **Write `controller.js` and `validator.js`**, move the shrunken route
   file to `resources/<r>/router.js`, delete `routers/api/v1/<r>.js`, and
   update the mount in `routers/api/v1/index.js`.
6. **Verify:** integration tests from step 1 still green, `npm run dev`
   smoke test against the React client, no diff in `openapi.v1.yaml`
   semantics.

Steps 2–5 can be one PR for small resources; for `containers.js` each step
is its own PR.

### Order of attack

| Phase | Resource | Why this order |
|---|---|---|
| 0 | Shared scaffolding | `middlewares/validate.js`, jest+supertest setup, `resources/` skeleton |
| 1 | `apikeys` (89 lines) | Pilot: smallest file, proves the pattern end-to-end |
| 2 | `settings`, `groups`, `external-domains` | Simple CRUD, builds muscle memory |
| 3 | `users`, `sites`, `jobs` | Medium; `jobs` SSE loop moves into a service |
| 4 | `nodes` | First heavy Proxmox integration (`POST /import`) |
| 5 | `resource-requests` | Approval policy becomes a testable service |
| 6 | `auth` | OIDC/session flows; touch carefully, high blast radius |
| 7 | `containers` | The boss fight — by now every pattern it needs exists |
| 8 | Cleanup | Delete duplicated auth in `middlewares/index.js` (near-copy of `api.js:47-79`), remove dead `currentSite.js` locals |

### What is explicitly out of scope during migration

- Changing URLs, payloads, status codes, or error codes.
- Renaming models or altering migrations.
- Switching module system, ORM, or framework versions.
- "While I'm here" feature work. Behavior changes go in separate PRs after
  the resource is migrated.

## 7. Rules for agents (and reviewers)

When asked to add or modify an endpoint in this app:

1. Read this document first. New endpoints use the full layer stack from
   §4 in their own `resources/<r>/` folder **even if the surrounding
   resource has not been migrated yet** — never add logic to a legacy god
   route.
2. If modifying a legacy route and the change is non-trivial, propose
   migrating that resource first (per §6) as a separate step.
3. Never put `await Model.` calls in a controller or router. Never put
   `req`/`res` in a service or repository. Never import another resource's
   repository — go through its service. If you find yourself doing any of
   these, stop — you're in the wrong file.
4. Reuse `middlewares/api.js` (`ApiError`, `asyncHandler`, `ok`/`created`/
   `noContent`, `jsonErrorHandler`). Do not add new response-shaping code.
5. Every new service function ships with a unit test; every new endpoint
   ships with a supertest integration test.
6. Definition of done for any endpoint PR:
   - [ ] Router file has no inline logic
   - [ ] Controller has no model imports and no transactions
   - [ ] Service has no `req`/`res`
   - [ ] Input validated by the resource's `validator.js`
   - [ ] Response built by the resource's `serializer.js`
   - [ ] Tests green; wire contract unchanged
