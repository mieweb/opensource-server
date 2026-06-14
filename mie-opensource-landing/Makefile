# mie-opensource-landing — Makefile
#
# Standard component contract (see create-a-container/Makefile for details):
#   deps / build (default) / install / dev / deb / rpm / apk

.DEFAULT_GOAL := build

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
# Version parts parsed from git. `git describe --tags --long --dirty` yields
# <tag>-<count>-g<hash>[-dirty]; we split it into the pieces below and let
# scripts/nfpm-version.sh compose a format-specific string at package time.
#   VERSION     base version, leading 'v' stripped, 0.0.0 if no tag
#   PRERELEASE  prerelease label (e.g. rc1), empty otherwise
#   COMMITS     commits since the tag (0 on an exact tag)
#   HASH        short commit hash (g<sha>)
#   DIRTY       1 if the working tree has uncommitted changes, else 0
GIT_DESCRIBE := $(shell git describe --tags --long --dirty 2>/dev/null)
DIRTY        := $(if $(filter %-dirty,$(GIT_DESCRIBE)),1,0)
_DESC        := $(GIT_DESCRIBE:%-dirty=%)
HASH         := $(if $(_DESC),$(lastword $(subst -, ,$(_DESC))),)
_REST        := $(_DESC:%-$(HASH)=%)
COMMITS      := $(if $(_DESC),$(lastword $(subst -, ,$(_REST))),0)
_TAG         := $(_REST:%-$(COMMITS)=%)
_BASE        := $(patsubst v%,%,$(_TAG))
VERSION      := $(if $(_BASE),$(firstword $(subst -, ,$(_BASE))),0.0.0)
PRERELEASE   := $(if $(findstring -,$(_BASE)),$(patsubst $(VERSION)-%,%,$(_BASE)),)

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
	DESTDIR=$(STAGE) \
	VERSION="$$(../scripts/nfpm-version.sh $(PACKAGER) '$(VERSION)' '$(PRERELEASE)' '$(COMMITS)' '$(HASH)' '$(DIRTY)')" \
	nfpm package -f nfpm.yaml -p $(PACKAGER) -t $(CURDIR)

deb:
	$(MAKE) package PACKAGER=deb
rpm:
	$(MAKE) package PACKAGER=rpm
apk:
	$(MAKE) package PACKAGER=apk

clean:
	rm -rf $(STAGE) site .venv
	rm -f *.deb *.rpm *.apk
