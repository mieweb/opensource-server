.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
DESTBIN  := $(DESTDIR)$(PREFIX)/manager-control-program
UNIT_DIR := $(DESTDIR)/usr/lib/systemd/system

# `build` assembles the ready-to-run application tree (the app package plus all
# vendored Python dependencies) into BUILDDIR in the source tree; `install`
# then copies that tree verbatim into DESTBIN. So the dev bind mount and the
# packaged install serve byte-for-byte the same layout, runnable with only the
# system python3 (PYTHONPATH pointed at it — no uv, pip, venv, or network).
BUILDDIR := $(CURDIR)/build

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644

# The production target is Debian 13 / amd64 / CPython 3.13. uv selects
# wheels for that platform regardless of the build host's own interpreter,
# and downloads a managed CPython for resolution if the host has none (the
# builder image doesn't).
#
# Compiled wheels are ABI-locked to this exact minor version (cp313), so the
# opensource-mcp package pins its python3 dependency to the matching range
# in .fpm — update both together when bumping.
PYTHON_VERSION  := 3.13
PYTHON_PLATFORM := x86_64-unknown-linux-gnu

REQUIREMENTS := .pkg-requirements.txt

# Staging directory for packaging
STAGE := $(CURDIR)/.pkg/buildroot

.PHONY: help deps build dev test install deb rpm apk package clean

help:
	@echo "manager-control-program — builds the opensource-mcp package."
	@echo ""
	@echo "Targets:"
	@echo "  deps     install dependencies (uv sync)"
	@echo "  build    assemble the app + vendored deps tree into build/"
	@echo "  dev      run the MCP server locally over stdio (uv)"
	@echo "  test     run tests (none; kept for the repo-wide target set)"
	@echo "  install  copy the build/ tree into DESTDIR"
	@echo "  deb      build the .deb package"
	@echo "  rpm      build the .rpm package"
	@echo "  apk      build the .apk package"
	@echo "  clean    remove the venv, build/, staging dir and built packages"
	@echo "  help     show this message"
	@echo ""
	@echo "Variables: PREFIX (default /opt/opensource-server), DESTDIR (default /)."

deps:
	uv sync --frozen

# Assemble the ready-to-run application tree into build/: the locked
# requirements are exported from uv.lock and installed as prebuilt wheels for
# the production target (Debian 13 / amd64 / CPython 3.13) directly into
# build/, then the app package is copied alongside them. The result runs with
# `python3 -m manager_control_program.server` and PYTHONPATH=build/, needing
# only the system python3. install/package and the dev bind mount all consume
# this same tree.
build:
	rm -rf $(BUILDDIR)
	$(INSTALL) -d $(BUILDDIR)
	uv export --frozen --no-dev --no-emit-project -o $(REQUIREMENTS)
	uv pip install \
		--python $(PYTHON_VERSION) \
		--python-version $(PYTHON_VERSION) \
		--python-platform $(PYTHON_PLATFORM) \
		--only-binary :all: \
		--target $(BUILDDIR) \
		--requirements $(REQUIREMENTS)
	rm -f $(REQUIREMENTS)
	cp -a manager_control_program $(BUILDDIR)/
	find $(BUILDDIR) -type d -name __pycache__ -prune -exec rm -rf {} +

dev:
	uv run manager-control-program

# No test suite yet; kept as a no-op so the repo-wide `make test` loop stays
# uniform if this component is ever added to the root COMPONENTS list.
test:

# Copy the assembled application tree (build/) into DESTBIN/build so the dev
# bind mount and the packaged install expose the identical path
# (.../manager-control-program/build, matching the repo layout), then install
# the systemd unit and its /etc/default config to the system paths. Depends on
# build so `make install` alone produces a complete tree.
install: build
	$(INSTALL) -d $(DESTBIN)/build
	cp -a $(BUILDDIR)/. $(DESTBIN)/build/
	$(INSTALL) -d $(UNIT_DIR)
	$(INSTALL_DATA) contrib/systemd/opensource-mcp.service $(UNIT_DIR)/
	$(INSTALL) -d $(DESTDIR)/etc/default
	$(INSTALL_DATA) contrib/default/opensource-mcp $(DESTDIR)/etc/default/opensource-mcp

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
	rm -rf .venv $(REQUIREMENTS) $(BUILDDIR) $(STAGE)
	rm -f *.deb *.rpm *.apk
