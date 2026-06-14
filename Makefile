# opensource-server — top-level Makefile
#
# Delegates the standard component contract to each component's own Makefile:
#   create-a-container   -> opensource-server
#   mie-opensource-landing -> opensource-docs
#   pull-config          -> opensource-agent
#
# Each component supports: deps, build (default), install, dev, deb/rpm/apk.
# Variables pass straight through:
#   PREFIX   vendor install prefix (default /opt/opensource-server)
#   DESTDIR  staging root for `install` (default /)
#   VERSION  package version (default derived from git tags)

.DEFAULT_GOAL := build

COMPONENTS := pull-config mie-opensource-landing create-a-container
PACKAGER   ?= deb

# Forwarded to every component Makefile.
MAKE_VARS = $(if $(PREFIX),PREFIX=$(PREFIX),) \
            $(if $(DESTDIR),DESTDIR=$(DESTDIR),) \
            $(if $(VERSION),VERSION=$(VERSION),)

.PHONY: deps build install dev deb rpm apk clean $(COMPONENTS)

deps build install clean:
	@for c in $(COMPONENTS); do \
		echo "==> $$c: $@"; \
		$(MAKE) -C $$c $@ $(MAKE_VARS) || exit $$?; \
	done

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
