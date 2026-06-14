# mie-opensource-landing — Makefile
#
# Standard component contract (see create-a-container/Makefile for details):
#   deps / build (default) / install / dev / deb / rpm / apk

.DEFAULT_GOAL := build

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
# v2026.6.2 -> 2026.6.2 ; v2026.6.2-15-gabc1234 -> 2026.6.2+15.gabc1234
VERSION ?= $(shell git describe --tags --always 2>/dev/null | sed -e 's/^v//' -e 's/-\([0-9]\+\)-g/+\1.g/')

PKG_NAME := opensource-docs
SITE_DEST := $(DESTDIR)$(PREFIX)/mie-opensource-landing/site

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

PACKAGER ?= deb
package:
	rm -rf build-root
	$(MAKE) install DESTDIR=$(CURDIR)/build-root PREFIX=$(PREFIX)
	VERSION=$(VERSION) nfpm package -f nfpm.yaml -p $(PACKAGER)

deb:
	$(MAKE) package PACKAGER=deb
rpm:
	$(MAKE) package PACKAGER=rpm
apk:
	$(MAKE) package PACKAGER=apk

clean:
	rm -rf build-root site .venv
