.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
DESTBIN  := $(DESTDIR)$(PREFIX)/agent
UNIT_DIR := $(DESTDIR)/usr/lib/systemd/system

# Staging directory for packaging
STAGE := $(CURDIR)/.pkg/buildroot

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644

ERROR_PAGES := ../error-pages

.PHONY: help deps build dev install deb rpm apk package clean

help:
	@echo "agent — builds the opensource-agent package."
	@echo ""
	@echo "Targets:"
	@echo "  deps     install dependencies (npm ci)"
	@echo "  build    compile the TypeScript sources"
	@echo "  install  stage files into DESTDIR (default /)"
	@echo "  deb      build the .deb package"
	@echo "  rpm      build the .rpm package"
	@echo "  apk      build the .apk package"
	@echo "  clean    remove build output, staging dir and built packages"
	@echo "  help     show this message"
	@echo ""
	@echo "Variables: PREFIX (default /opt/opensource-server), DESTDIR (default /)."

deps:
	npm ci

# Compile, then drop devDependencies so only the runtime node_modules
# (ejs) is staged into the package.
build: deps
	npm run build
	npm prune --omit=dev

dev: build

install: build
	$(INSTALL) -d $(DESTBIN)
	$(INSTALL_DATA) package.json $(DESTBIN)/
	cp -a dist templates node_modules $(DESTBIN)/
	$(INSTALL) -d $(UNIT_DIR)
	$(INSTALL_DATA) contrib/systemd/opensource-agent.service $(UNIT_DIR)/
	$(INSTALL_DATA) contrib/systemd/opensource-agent.timer $(UNIT_DIR)/
	$(INSTALL) -d $(DESTDIR)$(PREFIX)/error-pages
	$(INSTALL_DATA) $(ERROR_PAGES)/* $(DESTDIR)$(PREFIX)/error-pages/
	$(INSTALL) -d -m 0755 $(DESTDIR)/var/cache/nginx/auth_cache

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
	rm -rf $(STAGE) node_modules dist
	rm -f *.deb *.rpm *.apk
