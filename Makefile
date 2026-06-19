.DEFAULT_GOAL := help

COMPONENTS := pull-config mie-opensource-landing create-a-container
PACKAGER   ?= deb

# Forwarded to every component Makefile.
MAKE_VARS = $(if $(PREFIX),PREFIX=$(PREFIX),) \
            $(if $(DESTDIR),DESTDIR=$(DESTDIR),)

.PHONY: help deps build install deb rpm apk clean

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
		cp -f $$c/*.$@ dist/; \
	done
	@echo ""
	@echo "Packages collected in dist/:"
	@ls -1 dist/
