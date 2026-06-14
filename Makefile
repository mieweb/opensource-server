# opensource-server — top-level Makefile
#
# Delegates the standard component contract to each component's own Makefile:
#   create-a-container   -> opensource-server
#   mie-opensource-landing -> opensource-docs
#   pull-config          -> opensource-agent
#
# Each component supports: deps, build, install, dev, deb/rpm/apk. Run `make
# help` for details. Variables pass straight through:
#   PREFIX   vendor install prefix (default /opt/opensource-server)
#   DESTDIR  staging root for `install` (default /)
# The package version is derived from git by ./package-version.

.DEFAULT_GOAL := help

COMPONENTS := pull-config mie-opensource-landing create-a-container
PACKAGER   ?= deb

# Forwarded to every component Makefile.
MAKE_VARS = $(if $(PREFIX),PREFIX=$(PREFIX),) \
            $(if $(DESTDIR),DESTDIR=$(DESTDIR),)

.PHONY: help deps build install dev deb rpm apk clean $(COMPONENTS)

help:
	@echo "opensource-server — delegates to each component's Makefile."
	@echo ""
	@echo "Targets (run across all components):"
	@echo "  deps     install build/runtime dependencies"
	@echo "  build    build all components"
	@echo "  install  stage component files into DESTDIR (default /)"
	@echo "  deb      build .deb packages, collected into ./dist"
	@echo "  rpm      build .rpm packages, collected into ./dist"
	@echo "  apk      build .apk packages, collected into ./dist"
	@echo "  clean    remove build artifacts, staging, packages and ./dist"
	@echo "  dev      print the per-component dev commands"
	@echo "  help     show this message"
	@echo ""
	@echo "Variables: PREFIX (default /opt/opensource-server), DESTDIR (default /)."
	@echo "The package version is derived from git by ./package-version."

deps build install:
	@for c in $(COMPONENTS); do \
		echo "==> $$c: $@"; \
		$(MAKE) -C $$c $@ $(MAKE_VARS) || exit $$?; \
	done

# Clean each component (which removes its built packages) and the dist/
# collection directory.
clean:
	@for c in $(COMPONENTS); do \
		echo "==> $$c: clean"; \
		$(MAKE) -C $$c clean $(MAKE_VARS) || exit $$?; \
	done
	rm -rf dist

# Package every component, then collect the artifacts into ./dist.
deb rpm apk:
	@mkdir -p dist
	@for c in $(COMPONENTS); do \
		echo "==> $$c: $@"; \
		$(MAKE) -C $$c $@ $(MAKE_VARS) || exit $$?; \
		cp -f $$c/*.$@ dist/ 2>/dev/null || true; \
	done
	@echo ""
	@echo "Packages collected in dist/:"
	@ls -1 dist/

# `make dev` isn't meaningful for the whole repo (each watcher is long-running);
# run it per component, e.g. `make -C create-a-container dev`.
dev:
	@echo "Run 'dev' per component, e.g.:"
	@echo "  make -C create-a-container dev        # server + client watch"
	@echo "  make -C create-a-container dev-client # client watch only"
	@echo "  make -C mie-opensource-landing dev    # docs live server"
