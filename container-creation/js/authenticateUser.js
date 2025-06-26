// Script to authenticate a user into Proxmox
// Last updated June 24th, 2025 by Maxwell Klema

const axios = require('axios');
const qs = require('qs');
const https = require('https');

// authenticates user, ensuring they have a valid proxmox account
function authenticateUser(username, password) {
    let data = qs.stringify({
        'username': username + "@pve",
        'password': password
    })

    let config = {
        method: 'post',
        url: ' https://10.15.0.4:8006/api2/json/access/ticket',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false // Disable SSL verification for self-signed certificates (Only because public facing domain is resolved to nginx server internally, so have to use hypervisor IP instead of domain)
        }),
        data: data
    };

    return axios.request(config).then((response) => response.status === 200).catch(() => false);
}

module.exports = { authenticateUser };
