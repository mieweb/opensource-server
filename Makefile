.PHONY: install install-create-container install-pull-config help

help:
	@echo "opensource-server installation"
	@echo ""
	@echo "Available targets:"
	@echo "  make install                - Install all components"
	@echo "  make install-create-container - Install create-a-container web application"
	@echo "  make install-pull-config    - Install pull-config system"
	@echo ""

install: install-create-container install-pull-config

install-create-container:
	cd create-a-container && npm install --production
	cd create-a-container && npm run db:migrate
	install -m644 -oroot -groot create-a-container/container-creator.service /etc/systemd/system/container-creator.service
	systemctl daemon-reload || true
	systemctl enable container-creator.service
	systemctl start container-creator.service || true

install-pull-config:
	cd pull-config && bash install.sh
