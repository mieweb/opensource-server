# mie-opensource-landing — Makefile
#
# Standard component contract (see create-a-container/Makefile for details):
#   deps / build (default) / install / dev / deb / rpm / apk

.DEFAULT_GOAL := build

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /

PKG_NAME := opensource-docs
SITE_DEST := $(DESTDIR)$(PREFIX)/mie-opensource-landing/site

# Dedicated staging directory for packaging (never a user-supplied DESTDIR).
# Not named ".fpm" — fpm treats a file/dir of that name as an rc options file.
STAGE := $(CURDIR)/.pkg/buildroot

# ARCH=all (content-only payload); FPM_DIRS are the top-level staged dirs.
ARCH     := all
FPM_DIRS := opt

.PHONY: deps build dev install deb rpm apk package clean

deps:
	uv sync --frozen

build: deps
	uv run --frozen zensical build

# Live-reloading docs server. Honors VIRTUAL_ENV when set (compose sets
# VIRTUAL_ENV=/opt/zensical); otherwise uses the project .venv from `deps`.
dev: deps
	uv run zensical serve

install: build
	install -d $(SITE_DEST)
	cp -a site/. $(SITE_DEST)/

# Stage into a dedicated .nfpm/buildroot and package it; nfpm.yaml interpolates the
# staging path via ${DESTDIR}.
# Stage into a dedicated .pkg/buildroot and build the package with fpm. Static
# options live in opensource-docs.fpm; version/type/arch/staging are passed here.
PACKAGER ?= deb
package:
	rm -rf $(STAGE)
	$(MAKE) install DESTDIR=$(STAGE) PREFIX=$(PREFIX)
	fpm --fpm-options-file opensource-docs.fpm \
		-s dir -t $(PACKAGER) -a $(ARCH) \
		-v "$$(../package-version $(PACKAGER))" \
		-C $(STAGE) -p $(CURDIR) -f \
		$(FPM_DIRS)

deb:
	$(MAKE) package PACKAGER=deb
rpm:
	$(MAKE) package PACKAGER=rpm
apk:
	$(MAKE) package PACKAGER=apk

clean:
	rm -rf $(STAGE) site .venv
	rm -f *.deb *.rpm *.apk
