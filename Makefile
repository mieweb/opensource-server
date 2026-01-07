.PHONY: install install-create-container install-pull-config install-docs help

help:
	@echo "opensource-server installation"
	@echo ""
	@echo "Available targets:"
	@echo "  make install                - Install all components"
	@echo "  make install-create-container - Install create-a-container web application"
	@echo "  make install-pull-config    - Install pull-config system"
	@echo "  make install-docs           - Install documentation server"
	@echo ""

install: install-create-container install-pull-config install-docs

install-create-container:
	cd create-a-container && npm install --production
	cd create-a-container && npm run db:migrate
	install -m644 -oroot -groot create-a-container/container-creator.service /etc/systemd/system/container-creator.service
	systemctl daemon-reload || true
	systemctl enable container-creator.service
	systemctl start container-creator.service || true

install-pull-config:
	cd pull-config && bash install.sh

install-docs:
	cd mie-opensource-landing && npm install --production
	cd mie-opensource-landing && npm run build
	install -m644 -oroot -groot mie-opensource-landing/systemd/opensource-docs.service /etc/systemd/system/opensource-docs.service
	systemctl daemon-reload || true
	systemctl enable opensource-docs.service
	systemctl start opensource-docs.service || true
