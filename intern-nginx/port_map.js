// /etc/nginx/port_map.js
// This is a reverse proxy configuration for Nginx that uses JavaScript to dynamically 
// map subdomains to specific ports and IP addresses based on a JSON file.
// Code is based off of bluehive-testflight's port_map.js
// Last updated: 06-02-2025 Carter Myers

var fs = require('fs');
var filePath = "/etc/nginx/port_map.json"; // Make sure Nginx has read access
var cachedMapping = null;

function loadMapping() {
    try {
        var content = fs.readFileSync(filePath);
        cachedMapping = JSON.parse(content);
        return true;
    } catch (e) {
        // Optionally log error
        return false;
    }
}

function extractSubdomain(r) {
    var host = r.variables.host;
    var match = host.match(/^([^.]+)\.opensource\.mieweb\.com$/);
    if (!match) {
        r.error("Invalid hostname format: " + host);
        return null;
    }
    return match[1];
}

function portLookup(r) {
    if (cachedMapping === null && !loadMapping()) {
        r.error("Failed to load port mapping file.");
        r.return(500);
        return;
    }

    var subdomain = extractSubdomain(r);
    if (!subdomain) {
        r.return(500);
        return;
    }

    var entry = cachedMapping[subdomain];
    if (!entry) {
        if (!loadMapping()) {
            r.error("Reload failed.");
            r.return(500);
            return;
        }
        entry = cachedMapping[subdomain];
        if (!entry) {
            r.error("No entry found for subdomain: " + subdomain);
            r.return(500);
            return;
        }
    }

    return entry.port.toString();  // Always return string
}

function ipLookup(r) {
    if (cachedMapping === null && !loadMapping()) {
        r.error("Failed to load port mapping file.");
        r.return(500);
        return;
    }

    var subdomain = extractSubdomain(r);
    if (!subdomain) {
        r.return(500);
        return;
    }

    var entry = cachedMapping[subdomain];
    if (!entry) {
        if (!loadMapping()) {
            r.error("Reload failed.");
            r.return(500);
            return;
        }
        entry = cachedMapping[subdomain];
        if (!entry) {
            r.error("No entry found for subdomain: " + subdomain);
            r.return(500);
            return;
        }
    }

    return entry.ip;
}