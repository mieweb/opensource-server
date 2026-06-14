# pull-config — Makefile (opensource-agent package)
#
# Standard component contract (see create-a-container/Makefile for details).
# pull-config is plain bash, so deps/build/dev are no-ops; install stages the
# engine, instances, cron schedule and the shared error pages.

.DEFAULT_GOAL := build

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /

# Dedicated staging directory for packaging (never a user-supplied DESTDIR).
STAGE := $(CURDIR)/.nfpm/buildroot

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644
INSTALL_PROG := $(INSTALL) -m 0755

# The static error pages live at the repository root and are referenced by the
# manager-rendered nginx config; they ship with the agent package.
ERROR_PAGES := ../error-pages

.PHONY: deps build dev install deb rpm apk package clean

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

# Stage into a dedicated .nfpm/buildroot and package it. The version string is
# composed for the target format from the git parts above; nfpm.yaml sets
# version_schema: none so nfpm uses it verbatim. nfpm.yaml interpolates the
# staging path via ${DESTDIR}.
PACKAGER ?= deb
package:
	rm -rf $(STAGE)
	$(MAKE) install DESTDIR=$(STAGE) PREFIX=$(PREFIX)
	DESTDIR=$(STAGE) \
	VERSION="$$(../package-version $(PACKAGER))" \
	nfpm package -f nfpm.yaml -p $(PACKAGER) -t $(CURDIR)

deb:
	$(MAKE) package PACKAGER=deb
rpm:
	$(MAKE) package PACKAGER=rpm
apk:
	$(MAKE) package PACKAGER=apk

clean:
	rm -rf $(STAGE)
	rm -f *.deb *.rpm *.apk
