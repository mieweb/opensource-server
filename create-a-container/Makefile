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
APP_FILES := server.js job-runner.js package.json package-lock.json openapi.v1.yaml
APP_DIRS  := bin config data middlewares migrations models node_modules \
             public routers seeders utils views

.PHONY: help deps build dev install deb rpm apk package clean

help:
	@echo "create-a-container — builds the opensource-server package."
	@echo ""
	@echo "Targets:"
	@echo "  deps        install dependencies (npm ci, server + client)"
	@echo "  build       build the web client bundle"
	@echo "  install     stage the app into DESTDIR (default /)"
	@echo "  dev         run server + client watch (npm run dev)"
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

# Full local development: server (nodemon) + client (vite watch) together.
dev: deps
	npm run dev

install: build
	$(INSTALL) -d $(DESTBIN)
	$(INSTALL_DATA) $(APP_FILES) $(DESTBIN)/
	cp -a $(APP_DIRS) $(DESTBIN)/
	$(INSTALL) -d $(DESTBIN)/client
	cp -a client/dist $(DESTBIN)/client/
	$(INSTALL) -d $(UNIT_DIR)
	$(INSTALL_DATA) contrib/systemd/container-creator.service $(UNIT_DIR)/
	$(INSTALL_DATA) contrib/systemd/job-runner.service $(UNIT_DIR)/
	$(INSTALL) -d $(DESTDIR)/etc/logrotate.d
	$(INSTALL_DATA) contrib/opensource-server.logrotate $(DESTDIR)/etc/logrotate.d/opensource-server

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
