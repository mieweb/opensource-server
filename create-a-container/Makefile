.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
DESTBIN  := $(DESTDIR)$(PREFIX)/create-a-container
UNIT_DIR := $(DESTDIR)/usr/lib/systemd/system

# Staging directory for packaging
STAGE := $(CURDIR)/.pkg/buildroot

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644

# Server runtime files and directories. Client sources, dev tooling and repo
# metadata are intentionally excluded; only the built client/dist ships.
APP_FILES := server.js app.js job-runner.js package.json package-lock.json openapi.v1.yaml
APP_DIRS  := bin config data middlewares migrations models node_modules \
             public resources routers seeders utils

.PHONY: help deps build dev test install deb rpm apk package clean

help:
	@echo "create-a-container — builds the opensource-server package."
	@echo ""
	@echo "Targets:"
	@echo "  deps        install production dependencies (npm ci, server + client)"
	@echo "  build       build the web client bundle"
	@echo "  install     stage the app into DESTDIR (default /)"
	@echo "  dev         run the Manager locally (SQLite, no Proxmox)"
	@echo "  test        run the server test suite (jest)"
	@echo "  deb         build the .deb package"
	@echo "  rpm         build the .rpm package"
	@echo "  apk         build the .apk package"
	@echo "  clean       remove the staging dir, build output and built packages"
	@echo "  help        show this message"
	@echo ""
	@echo "Variables: PREFIX (default /opt/opensource-server), DESTDIR (default /)."

deps:
	npm ci --omit=dev
	npm --prefix client ci

build: deps
	npm --prefix client run build

# Run the Manager locally against SQLite, with a dummy (mock) hypervisor so
# containers can be "created" without Proxmox. No .env is needed — the server's
# defaults (SQLite, auto-generated session secret, non-production mode) are
# sufficient for development.
#
# Self-contained (dev needs a full install incl. devDependencies, unlike the
# production `deps` which omits them, so it isn't split into shared phony
# prerequisites): install server + client deps with `npm install
# --no-package-lock`. This is a fast, incremental install that keeps
# devDependencies and runs the server's patch-package postinstall, but never
# rewrites package-lock.json (so `make dev` leaves the lockfile untouched even
# when the local npm would otherwise renormalize it). Then run migrations (which
# also runs the dev-only seeders, e.g. a localhost site + dummy node, via
# `db:seed:all`), build the client once, and run three processes together via
# concurrently:
#   - server (nodemon, restarts on change)
#   - job-runner (so container creation exercises the real POST /containers ->
#     Job -> job-runner -> bin/create-container.js -> DummyApi path)
#   - client build in watch mode (rebuilds client/dist, which the server serves)
#
# Override behavior on the command line, e.g.:
#   make dev LOG_LEVEL=trace      # log every SQL query
#
# Only forward LOG_LEVEL into the subprocess when it's actually provided on the
# command line. Setting it unconditionally (even to empty) would shadow any
# LOG_LEVEL in a local .env, since dotenv does not override existing env vars.
dev: LOG_LEVEL_PREFIX = $(if $(LOG_LEVEL),LOG_LEVEL=$(LOG_LEVEL) ,)
dev:
	npm install --no-package-lock
	npm --prefix client install --no-package-lock
	npm run db:migrate
	npm --prefix client run build
	@echo "Starting Manager (server + job-runner + client watch) at http://localhost:3000 ..."
	$(LOG_LEVEL_PREFIX)npx concurrently -n server,jobs,client -c blue,magenta,green \
		"npx nodemon server.js" \
		"node job-runner.js" \
		"npm --prefix client run build:watch"

# Run the server test suite (jest + supertest against a throwaway SQLite DB in
# $TMPDIR; see jest.config.js / tests/setup-env.js). Like `dev`, tests need
# devDependencies, so install with `npm install --no-package-lock` — fast,
# incremental, and never rewrites package-lock.json.
test:
	npm install --no-package-lock
	npm test

install: build
	$(INSTALL) -d $(DESTBIN)
	$(INSTALL_DATA) $(APP_FILES) $(DESTBIN)/
	cp -a $(APP_DIRS) $(DESTBIN)/
	find $(DESTBIN) -type d -name __tests__ -prune -exec rm -rf {} +
	$(INSTALL) -d $(DESTBIN)/client
	cp -a client/dist $(DESTBIN)/client/
	$(INSTALL) -d $(UNIT_DIR)
	$(INSTALL_DATA) contrib/systemd/container-creator.service $(UNIT_DIR)/
	$(INSTALL_DATA) contrib/systemd/job-runner.service $(UNIT_DIR)/
	$(INSTALL) -d $(DESTDIR)/etc/logrotate.d
	$(INSTALL_DATA) contrib/opensource-server.logrotate $(DESTDIR)/etc/logrotate.d/opensource-server
	# The MCP server ships inside this package (vendored Python deps, no uv
	# on the target); the Manager proxies /mcp to it (see MCP_SERVER_URL).
	$(MAKE) -C ../manager-control-program install DESTDIR=$(DESTDIR) PREFIX=$(PREFIX)

PACKAGER ?= deb
package:
	rm -rf $(STAGE)
	$(MAKE) install DESTDIR=$(STAGE) PREFIX=$(PREFIX)
	fpm -s dir -t $(PACKAGER) -v "$$(../package-version $(PACKAGER))" \
		-C $(STAGE) -p $(CURDIR) -f

deb:
	$(MAKE) package PACKAGER=deb
rpm:
	$(MAKE) package PACKAGER=rpm
apk:
	$(MAKE) package PACKAGER=apk

clean:
	rm -rf $(STAGE) node_modules client/node_modules client/dist
	rm -f *.deb *.rpm *.apk
