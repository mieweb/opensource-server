group "default" {
    targets = ["base", "nodejs", "agent", "manager"]
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
