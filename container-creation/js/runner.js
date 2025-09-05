authenticateuser = require("./authenticateUser.js");
authenticaterepo = require("./authenticateRepo.js")

const [, , func, ...args] = process.argv;
if (func == "authenticateUser") {
    authenticateuser.authenticateUser(...args).then((result) => {
        console.log(result);
    });
} else if (func == "authenticateRepo") {
    authenticaterepo.authenticateRepo(...args).then((result) => {
        console.log(result);
    })
}
