group "default" {
    targets = ["base", "nodejs", "mie-opensource-landing"]
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

target "mie-opensource-landing" {
    context = "../"
    dockerfile = "mie-opensource-landing/Dockerfile"
    contexts = {
        nodejs = "target:nodejs"
    }
}
