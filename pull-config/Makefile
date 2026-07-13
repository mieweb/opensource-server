.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /

STAGE := $(CURDIR)/.pkg/buildroot

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644
INSTALL_PROG := $(INSTALL) -m 0755

ERROR_PAGES := ../error-pages

.PHONY: help deps build dev test install deb rpm apk package clean

help:
	@echo "pull-config — builds the opensource-agent package."
	@echo ""
	@echo "Targets:"
	@echo "  deps     install dependencies (none; plain bash)"
	@echo "  build    build the component (nothing to compile)"
	@echo "  test     run tests (none; plain bash)"
	@echo "  install  stage files into DESTDIR (default /)"
	@echo "  deb      build the .deb package"
	@echo "  rpm      build the .rpm package"
	@echo "  apk      build the .apk package"
	@echo "  clean    remove the staging dir and built packages"
	@echo "  help     show this message"
	@echo ""
	@echo "Variables: PREFIX (default /opt/opensource-server), DESTDIR (default /)."

# Plain bash; nothing to install, compile, test, or watch.
deps:
build: deps
dev: deps
test:

install: build
	$(INSTALL) -D -m 0755 bin/pull-config $(DESTDIR)$(PREFIX)/pull-config/bin/pull-config
	$(INSTALL) -d $(DESTDIR)/etc/pull-config.d
	$(INSTALL_PROG) etc/pull-config.d/* $(DESTDIR)/etc/pull-config.d/
	$(INSTALL) -D -m 0644 etc/cron.d/pull-config $(DESTDIR)/etc/cron.d/pull-config
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
	rm -rf $(STAGE)
	rm -f *.deb *.rpm *.apk
