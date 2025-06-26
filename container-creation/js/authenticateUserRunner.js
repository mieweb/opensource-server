// Script to run authenticateUser in the shell
// Last updated June 24th, 2025 by Maxwell Klema

authenticateuser = require("./authenticateUser.js");

const [, , func, ...args] = process.argv;
if (func == "authenticateUser") {
    authenticateuser.authenticateUser(...args).then((result) => {
        console.log(result);
    });
}
