group "default" {
    targets = ["base", "nodejs", "docs"]
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
