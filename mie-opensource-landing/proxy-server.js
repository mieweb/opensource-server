const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    credentials: true
}));

// Create proxy middleware
const apiProxy = createProxyMiddleware({
    target: 'http://10.15.20.69:3001',
    changeOrigin: true,
    pathRewrite: {
        '^/api/projects': '', 
    }
});

const apiAllProjectsProxy = createProxyMiddleware({
    target: 'http://10.15.20.69:3001/keys',
    changeOrigin: true,
});

// Use the proxy middleware
app.use('/api/projects', apiProxy);
app.use('/api/all-projects', apiAllProjectsProxy);
app.listen(3001);