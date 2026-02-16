group "default" {
    targets = ["base", "nodejs", "manager"]
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

target "manager" {
    context = "../"
    dockerfile = "images/manager/Dockerfile"
    contexts = {
        nodejs = "target:nodejs"
    }
}
