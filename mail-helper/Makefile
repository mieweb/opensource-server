.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
DESTBIN  := $(DESTDIR)$(PREFIX)/mail-helper
UNIT_DIR := $(DESTDIR)/usr/lib/systemd/system

# Staging directory for packaging
STAGE := $(CURDIR)/.pkg/buildroot

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644

# Canonical unsubscribe-token implementation lives in the manager; it is
# copied here at build time (gitignored) so the two stay in sync by
# construction instead of by hand.
TOKEN_SRC := ../create-a-container/utils/unsubscribe-token.js

.PHONY: help deps build dev test install deb rpm apk package clean

help:
	@echo "mail-helper — builds the opensource-mail-helper package."
	@echo ""
	@echo "Targets:"
	@echo "  deps     install dependencies (npm ci) and sync shared sources"
	@echo "  build    prepare the runtime tree"
	@echo "  test     run tests"
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
	cp $(TOKEN_SRC) src/unsubscribe-token.js

build: deps
	npm prune --omit=dev

dev: build

test: deps
	npm test

install: build
	$(INSTALL) -d $(DESTBIN)/src
	$(INSTALL_DATA) package.json config.json $(DESTBIN)/
	$(INSTALL_DATA) src/*.js $(DESTBIN)/src/
	cp -a node_modules $(DESTBIN)/
	$(INSTALL) -d $(UNIT_DIR)
	$(INSTALL_DATA) contrib/systemd/opensource-mail-helper.service $(UNIT_DIR)/

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
	rm -rf $(STAGE) node_modules
	rm -f src/unsubscribe-token.js *.deb *.rpm *.apk
