# pull-config — Makefile (opensource-agent package)
#
# Standard component contract (see create-a-container/Makefile for details).
# pull-config is plain bash, so deps/build/dev are no-ops; install stages the
# engine, instances, cron schedule and the shared error pages.

.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /

# Staging directory for packaging. Not named ".fpm" — fpm reads a file of that
# name as an rc options file.
STAGE := $(CURDIR)/.pkg/buildroot

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644
INSTALL_PROG := $(INSTALL) -m 0755

ERROR_PAGES := ../error-pages

.PHONY: help deps build dev install deb rpm apk package clean

help:
	@echo "pull-config — builds the opensource-agent package."
	@echo ""
	@echo "Targets:"
	@echo "  deps     install dependencies (none; plain bash)"
	@echo "  build    build the component (nothing to compile)"
	@echo "  install  stage files into DESTDIR (default /)"
	@echo "  deb      build the .deb package"
	@echo "  rpm      build the .rpm package"
	@echo "  apk      build the .apk package"
	@echo "  clean    remove the staging dir and built packages"
	@echo "  help     show this message"
	@echo ""
	@echo "Variables: PREFIX (default /opt/opensource-server), DESTDIR (default /)."

# Plain bash; nothing to install, compile, or watch.
deps:
build: deps
dev: deps

install: build
	# pull-config engine — instances exec this absolute path.
	$(INSTALL) -D -m 0755 bin/pull-config $(DESTDIR)$(PREFIX)/pull-config/bin/pull-config
	# pull-config instances (program code) + cron schedule.
	$(INSTALL) -d $(DESTDIR)/etc/pull-config.d
	$(INSTALL_PROG) etc/pull-config.d/* $(DESTDIR)/etc/pull-config.d/
	$(INSTALL) -D -m 0644 etc/cron.d/pull-config $(DESTDIR)/etc/cron.d/pull-config
	# Static error pages referenced by the manager-rendered nginx config.
	$(INSTALL) -d $(DESTDIR)$(PREFIX)/error-pages
	$(INSTALL_DATA) $(ERROR_PAGES)/* $(DESTDIR)$(PREFIX)/error-pages/
	# Forward-auth cache directory used by the manager-rendered nginx config.
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
	rm -rf $(STAGE)
	rm -f *.deb *.rpm *.apk
