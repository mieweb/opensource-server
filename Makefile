.PHONY: install install-create-container install-pull-config install-docs dev help

help:
	@echo "opensource-server installation"
	@echo ""
	@echo "Available targets:"
	@echo "  make dev                    - Set up and start create-a-container locally (SQLite)"
	@echo "  make install                - Install all components"
	@echo "  make install-create-container - Install create-a-container web application"
	@echo "  make install-pull-config    - Install pull-config system"
	@echo "  make install-docs           - Install documentation server"
	@echo ""

# Local development: sets up create-a-container with SQLite and starts the server.
# Creates .env if missing, installs deps, runs migrations, builds the client, then starts.
dev:
	@if [ ! -f create-a-container/.env ]; then \
		echo "Creating create-a-container/.env with SQLite defaults..."; \
		printf 'DATABASE_DIALECT=sqlite\nSQLITE_STORAGE=./dev.sqlite\nSESSION_SECRET=%s\nNODE_ENV=development\n' \
			$$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") \
			> create-a-container/.env; \
	fi
	cd create-a-container && npm install
	cd create-a-container && npm run db:migrate
	cd create-a-container/client && npm install && node_modules/.bin/vite build
	@echo "Starting server at http://localhost:3000 ..."
	cd create-a-container && node server.js

install: install-create-container install-pull-config install-docs

SYSTEMD_DIR := create-a-container/systemd
SERVICES    := $(wildcard $(SYSTEMD_DIR)/*.service)
install-create-container:
	cd create-a-container && npm install --omit=dev
	cd create-a-container/client && npm install && npm run build
	install -m 644 -o root -g root $(SERVICES) /etc/systemd/system/
	systemctl daemon-reload || true
	@for service in $(notdir $(SERVICES)); do \
		systemctl enable $$service; \
	done

install-pull-config:
	cd pull-config && bash install.sh

install-docs:
	cd mie-opensource-landing && uv run zensical build
