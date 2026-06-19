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
