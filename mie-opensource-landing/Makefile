# mie-opensource-landing — Makefile
#
# Standard component contract (see create-a-container/Makefile for details):
#   deps / build (default) / install / dev / deb / rpm / apk

.DEFAULT_GOAL := build

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
# Version derived from the nearest git tag (an unprefixed semver, e.g.
# 2026.6.3). nfpm renders the correct per-format version from it (deb/rpm use
# ~rc1, apk uses _rc1, etc.):
#   2026.6.3                  -> 2026.6.3
#   2026.6.3-rc1              -> 2026.6.3-rc1
#   2026.6.3-15-gabc1234      -> 2026.6.3+15.gabc1234       (snapshot metadata)
#   2026.6.3-rc1-15-gabc1234  -> 2026.6.3-rc1+15.gabc1234
VERSION ?= $(shell git describe --tags 2>/dev/null | sed -e 's/-\([0-9]\+\)-g/+\1.g/')

PKG_NAME := opensource-docs
SITE_DEST := $(DESTDIR)$(PREFIX)/mie-opensource-landing/site

# Dedicated staging directory for packaging (never a user-supplied DESTDIR).
STAGE := $(CURDIR)/.nfpm/buildroot

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
	rm -rf $(STAGE) site .venv
	rm -f *.deb *.rpm *.apk
