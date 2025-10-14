const axios = require('axios');

function authenticateRepo(repositoryURL, branch, folderPath) {

    if (folderPath.indexOf('.') != -1) {
        return Promise.resolve(false); //early exit if path points to a specific file
    }

    repositoryURL = repositoryURL.replace('.git', '');
    if (folderPath.startsWith('/')) {
        folderPath = folderPath.substring(1, folderPath.length);
    }
    fullURL = `${repositoryURL}/tree/${branch}/${folderPath}`

    const config = {
        method: "get",
        url: fullURL
    }

    return axios.request(config).then((response) => response.status === 200).catch(() => false);
}

module.exports = { authenticateRepo }