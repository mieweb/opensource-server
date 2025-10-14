manageHostnames = require('./checkHostname.js');

const [,, func, ...args] = process.argv;
if (func == "checkHostnameExists"){
    console.log(manageHostnames.checkHostnameExists(...args));
} else {
    console.error("Invalid function name. Use 'checkHostnameExists' or 'addHostname'.");
    process.exit(1);
}