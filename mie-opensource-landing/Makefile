# mie-opensource-landing — Makefile
#
# Standard component contract (see create-a-container/Makefile for details):
#   deps / build (default) / install / dev / deb / rpm / apk

.DEFAULT_GOAL := build

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
# Version derived from the nearest git tag, as a plain semver string. nfpm
# renders the correct per-format version from it (deb/rpm use ~rc1, apk uses
# _rc1, etc.), so no separator translation happens here:
#   v2026.6.3                 -> 2026.6.3
#   v2026.6.3-rc1             -> 2026.6.3-rc1
#   v2026.6.3-15-gabc1234     -> 2026.6.3+15.gabc1234        (snapshot metadata)
#   v2026.6.3-rc1-15-gabc1234 -> 2026.6.3-rc1+15.gabc1234
# no tag reachable (e.g. shallow checkout) -> 0.0.0+g<sha>.
VERSION ?= $(shell d=$$(git describe --tags 2>/dev/null); if [ -n "$$d" ]; then echo "$$d" | sed -e 's/^v//' -e 's/-\([0-9]\+\)-g/+\1.g/'; else echo "0.0.0+g$$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"; fi)

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
