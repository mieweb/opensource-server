authenticateuser = require("./authenticateUser.js");

const [,, func, ...args] = process.argv;
if (func == "authenticateUser") {
    authenticateuser.authenticateUser(...args).then((result) => {
        console.log(result);
    });
}
