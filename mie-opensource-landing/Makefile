.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /

PKG_NAME := opensource-docs
SITE_DEST := $(DESTDIR)$(PREFIX)/mie-opensource-landing/site

STAGE := $(CURDIR)/.pkg/buildroot

.PHONY: help deps build dev install deb rpm apk package clean

help:
	@echo "mie-opensource-landing — builds the opensource-docs package."
	@echo ""
	@echo "Targets:"
	@echo "  deps     install dependencies (uv sync)"
	@echo "  build    build the documentation site (zensical build)"
	@echo "  install  stage the site into DESTDIR (default /)"
	@echo "  dev      run the live-reloading docs server (zensical serve)"
	@echo "  deb      build the .deb package"
	@echo "  rpm      build the .rpm package"
	@echo "  apk      build the .apk package"
	@echo "  clean    remove the staging dir, build output and built packages"
	@echo "  help     show this message"
	@echo ""
	@echo "Variables: PREFIX (default /opt/opensource-server), DESTDIR (default /)."

deps:
	uv sync --frozen

build: deps
	uv run --frozen zensical build

dev: deps
	uv run zensical serve

install: build
	install -d $(SITE_DEST)
	cp -a site/. $(SITE_DEST)/

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
	rm -rf $(STAGE) site .venv
	rm -f *.deb *.rpm *.apk
