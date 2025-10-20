var fs = require('fs');
var filePath = "/etc/nginx/port_map.json";
var cachedMapping = null;

var content = fs.readFileSync(filePath);
cachedMapping = JSON.parse(content);


function checkHostnameExists(hostname) {
    if (cachedMapping === null) {
        console.error("Failed to load port mapping file.");
        return false;
    }

    if (!cachedMapping.hasOwnProperty(hostname)) {
        return false;
    } else {
        return true;
    }
}

module.exports = { checkHostnameExists };