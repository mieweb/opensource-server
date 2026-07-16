group "default" {
    targets = ["base", "nodejs", "docker", "docker-nodejs", "docs", "agent", "manager", "proxmox-ve"]
}

target "base" {
    context = "./base"
}

target "nodejs" {
    context = "./nodejs"
    contexts = {
        base = "target:base"
    }
}

# Docker Engine (CE) on the plain Debian base. docker/Dockerfile builds FROM
# the named `base` context, so the same Dockerfile also produces the
# docker-nodejs image below by swapping that context.
target "docker" {
    context = "./docker"
    contexts = {
        base = "target:base"
    }
}

# Docker Engine (CE) layered on the NodeJS image instead of the Debian base.
target "docker-nodejs" {
    context = "./docker"
    contexts = {
        base = "target:nodejs"
    }
}

# Builds the Debian packages consumed by the other images.
target "builder" {
    context = "../"
    dockerfile = "images/builder/Dockerfile"
}

target "docs" {
    context = "../"
    dockerfile = "images/docs/Dockerfile"
    contexts = {
        base = "target:base"
        builder = "target:builder"
    }
}

target "agent" {
    context = "../"
    dockerfile = "images/agent/Dockerfile"
    contexts = {
        nodejs = "target:nodejs"
        builder = "target:builder"
    }
}

target "manager" {
    context = "../"
    dockerfile = "images/manager/Dockerfile"
    contexts = {
        agent = "target:agent"
        builder = "target:builder"
    }
}

target "proxmox-ve" {
    context = "./proxmox-ve"
}
