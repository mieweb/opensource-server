group "default" {
    targets = ["base", "nodejs", "docs", "agent", "manager"]
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

target "docs" {
    context = "../"
    dockerfile = "images/docs/Dockerfile"
    contexts = {
        nodejs = "target:nodejs"
    }
}

target "agent" {
    context = "../"
    dockerfile = "images/agent/Dockerfile"
    contexts = {
        nodejs = "target:nodejs"
    }
}

target "manager" {
    context = "../"
    dockerfile = "images/manager/Dockerfile"
    contexts = {
        agent = "target:agent"
    }
}
