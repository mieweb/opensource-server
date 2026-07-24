.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
DESTBIN  := $(DESTDIR)$(PREFIX)/manager-control-program
UNIT_DIR := $(DESTDIR)/usr/lib/systemd/system

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
	@echo "  build    nothing to build (kept for the repo-wide target set)"
	@echo "  dev      run the MCP server locally over stdio (uv)"
	@echo "  test     run tests (none; kept for the repo-wide target set)"
	@echo "  install  stage the app with vendored dependencies into DESTDIR"
	@echo "  deb      build the .deb package"
	@echo "  rpm      build the .rpm package"
	@echo "  apk      build the .apk package"
	@echo "  clean    remove the venv, staging dir and built packages"
	@echo "  help     show this message"
	@echo ""
	@echo "Variables: PREFIX (default /opt/opensource-server), DESTDIR (default /)."

deps:
	uv sync --frozen

build:

dev:
	uv run manager-control-program

# No test suite yet; kept as a no-op so the repo-wide `make test` loop stays
# uniform if this component is ever added to the root COMPONENTS list.
test:

# Stage the application with vendored dependencies so the target host needs
# only /usr/bin/python3 — no uv, pip, network access, or venv. The locked
# requirements are exported from uv.lock and installed as prebuilt wheels
# directly into the app directory; the systemd unit runs
# `python3 -m manager_control_program.server` with PYTHONPATH pointed there.
install:
	$(INSTALL) -d $(DESTBIN)
	uv export --frozen --no-dev --no-emit-project -o $(REQUIREMENTS)
	uv pip install \
		--python $(PYTHON_VERSION) \
		--python-version $(PYTHON_VERSION) \
		--python-platform $(PYTHON_PLATFORM) \
		--only-binary :all: \
		--target $(DESTBIN) \
		--requirements $(REQUIREMENTS)
	rm -f $(REQUIREMENTS)
	cp -a manager_control_program $(DESTBIN)/
	find $(DESTBIN) -type d -name __pycache__ -prune -exec rm -rf {} +
	$(INSTALL) -d $(UNIT_DIR)
	$(INSTALL_DATA) contrib/systemd/opensource-mcp.service $(UNIT_DIR)/

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
	rm -rf .venv $(REQUIREMENTS) $(STAGE)
	rm -f *.deb *.rpm *.apk
