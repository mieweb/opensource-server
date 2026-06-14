group "default" {
    targets = ["base", "nodejs", "docs", "agent", "manager", "proxmox-ve"]
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

# Builds the three Debian packages consumed by the docs, agent and manager
# images. Not part of the default group: built on demand as a dependency, and
# exported by CI with `docker buildx bake builder --set
# builder.output=type=local,dest=dist`.
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
