.DEFAULT_GOAL := help

PREFIX  ?= /opt/opensource-server
DESTDIR ?= /
DESTBIN  := $(DESTDIR)$(PREFIX)/manager-control-program
UNIT_DIR := $(DESTDIR)/usr/lib/systemd/system

INSTALL      := install
INSTALL_DATA := $(INSTALL) -m 0644

# The production target is the manager image: Debian 13 / amd64 / CPython 3.13
# (python3 comes with the base image). uv selects wheels for that platform
# regardless of the build host's own interpreter, and downloads a managed
# CPython for resolution if the host has none (the builder image doesn't).
PYTHON_VERSION  := 3.13
PYTHON_PLATFORM := x86_64-unknown-linux-gnu

REQUIREMENTS := .pkg-requirements.txt

.PHONY: help deps build dev test install deb rpm apk package clean

help:
	@echo "manager-control-program — MCP server for create-a-container."
	@echo ""
	@echo "Targets:"
	@echo "  deps     install dependencies (uv sync)"
	@echo "  build    nothing to build (kept for the repo-wide target set)"
	@echo "  dev      run the MCP server locally over stdio (uv)"
	@echo "  test     run tests (none; kept for the repo-wide target set)"
	@echo "  install  stage the app with vendored dependencies into DESTDIR"
	@echo "  clean    remove the venv and vendoring artifacts"
	@echo "  help     show this message"
	@echo ""
	@echo "This component ships inside the opensource-server package: the"
	@echo "create-a-container Makefile calls 'install' here while staging."
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
	$(INSTALL_DATA) contrib/systemd/manager-control-program.service $(UNIT_DIR)/

# This component does not build its own package; it ships inside the
# opensource-server package built by create-a-container.
deb rpm apk package:
	@echo "manager-control-program ships inside the opensource-server package;" \
	     "build it with 'make -C ../create-a-container $@'"

clean:
	rm -rf .venv $(REQUIREMENTS)
