# create-a-container — Makefile
#
# Standard component contract shared across the repository:
#   deps     install build/runtime dependencies
#   build    (default) compile the component; depends on deps
#   install  stage built files into DESTDIR; depends on build
#   dev      run the development watch loop; depends on deps
#   deb/rpm/apk  package the staged tree with nfpm; depend on install
#
# PREFIX is the vendor install prefix every runtime reference in the project
# expects (systemd units, the manager-rendered nginx config). DESTDIR is the
# staging root. VERSION is derived from git but can be overridden.
#
# Packaging stages into a dedicated .nfpm/buildroot (never a user-supplied DESTDIR)
# and runs nfpm from the component directory; nfpm.yaml interpolates the
# staging path via ${DESTDIR} (expand: true), so it stays DRY and works for
# any DESTDIR.

.DEFAULT_GOAL := build

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
# v2026.6.2 -> 2026.6.2 ; v2026.6.2-15-gabc1234 -> 2026.6.2+15.gabc1234
VERSION ?= $(shell git describe --tags --always 2>/dev/null | sed -e 's/^v//' -e 's/-\([0-9]\+\)-g/+\1.g/')

DESTBIN  := $(DESTDIR)$(PREFIX)/create-a-container
UNIT_DIR := $(DESTDIR)/usr/lib/systemd/system

# Dedicated staging directory for packaging (never a user-supplied DESTDIR).
STAGE := $(CURDIR)/.nfpm/buildroot

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644

# Server runtime files and directories. Client sources, dev tooling and repo
# metadata are intentionally excluded; only the built client/dist ships.
APP_FILES := server.js job-runner.js package.json package-lock.json openapi.v1.yaml
APP_DIRS  := bin config data middlewares migrations models node_modules \
             public routers seeders utils views

.PHONY: deps build dev dev-client install deb rpm apk package clean

deps:
	npm ci --omit=dev
	npm --prefix client ci

build: deps
	npm --prefix client run build
	# Prune npm packaging cruft and foreign-platform / musl prebuilds; only
	# linux-x64 glibc prebuilds are relevant for an amd64 package.
	find node_modules \( -name '.eslintrc*' -o -name '.npmignore' -o -name '.eslintignore' \) -delete
	for d in $$(find node_modules -type d -name prebuilds); do \
		find "$$d" -mindepth 1 -maxdepth 1 ! -name 'linux-x64' -exec rm -rf {} +; \
		rm -f "$$d"/linux-x64/*.musl.node; \
	done

# Full local development: server (nodemon) + client (vite watch) together.
dev: deps
	npm run dev

# Client production-bundle watcher only. Used by the compose `client` service,
# where the server runs inside the Proxmox container, not here.
dev-client: deps
	npm run client:build
	npm run client:build:watch

# Stage built files into DESTDIR. container-creator-init.service is NOT
# installed here: provisioning a local PostgreSQL is an image/environment
# choice (the package only suggests postgresql), so that unit lives in the
# manager image.
install: build
	$(INSTALL) -d $(DESTBIN)
	$(INSTALL_DATA) $(APP_FILES) $(DESTBIN)/
	# cp -a preserves the symlinks in node_modules/.bin (e.g. sequelize,
	# invoked by the systemd units) and file modes.
	cp -a $(APP_DIRS) $(DESTBIN)/
	$(INSTALL) -d $(DESTBIN)/client
	cp -a client/dist $(DESTBIN)/client/
	# systemd units (enabled by the package postinstall script)
	$(INSTALL) -d $(UNIT_DIR)
	$(INSTALL_DATA) contrib/systemd/container-creator.service $(UNIT_DIR)/
	$(INSTALL_DATA) contrib/systemd/job-runner.service $(UNIT_DIR)/
	# logrotate for the morgan access log
	$(INSTALL) -d $(DESTDIR)/etc/logrotate.d
	$(INSTALL_DATA) contrib/opensource-server.logrotate $(DESTDIR)/etc/logrotate.d/opensource-server

# Package the staged tree with nfpm. Files are staged into a dedicated
# .nfpm/buildroot (never a user-supplied DESTDIR); nfpm.yaml interpolates that
# path via ${DESTDIR}, so nfpm runs from the component directory (where its
# contrib/ maintainer scripts live) and packaging never mutates the staged tree.
PACKAGER ?= deb
package:
	rm -rf $(STAGE)
	$(MAKE) install DESTDIR=$(STAGE) PREFIX=$(PREFIX)
	DESTDIR=$(STAGE) VERSION=$(VERSION) nfpm package -f nfpm.yaml -p $(PACKAGER) -t $(CURDIR)

deb:
	$(MAKE) package PACKAGER=deb
rpm:
	$(MAKE) package PACKAGER=rpm
apk:
	$(MAKE) package PACKAGER=apk

clean:
	rm -rf $(STAGE) node_modules client/node_modules client/dist
