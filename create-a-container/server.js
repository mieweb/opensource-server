const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs'); // Added fs module

const app = express();

// A simple in-memory object to store job status and output
const jobs = {};

// --- Middleware Setup ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'A7d#9Lm!qW2z%Xf8@Rj3&bK6^Yp$0Nc',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// --- Route Handlers ---

// Serves the main container creation form, protected by login
app.get('/form.html', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/'); // Redirect to login page if not authenticated
    }
    res.sendFile(path.join(__dirname, 'views', 'form.html'));
});

// Handles user login
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    execFile('node', ['/root/bin/js/runner.js', 'authenticateUser', username, password], (err, stdout) => {
        if (err) {
            console.error("Login script execution error:", err);
            return res.status(500).json({ error: "Server error during authentication." });
        }

        if (stdout.trim() === 'true') {
            req.session.user = username;
            req.session.proxmoxUsername = username;
            req.session.proxmoxPassword = password;
            return res.json({ success: true, redirect: '/form.html' });
        } else {
            return res.status(401).json({ error: "Invalid credentials" });
        }
    });
});

// ✨ UPDATED: API endpoint to get user's containers
app.get('/api/my-containers', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    // The username in port_map.json doesn't have the @pve suffix
    const username = req.session.user.split('@')[0];

    // Command to read the remote JSON file
    const command = "ssh root@10.15.20.69 'cat /etc/nginx/port_map.json'";

    exec(command, (err, stdout, stderr) => {
        if (err) {
            console.error("Error fetching port_map.json:", stderr);
            return res.status(500).json({ error: "Could not fetch container list." });
        }
        try {
            const portMap = JSON.parse(stdout);
            const userContainers = Object.entries(portMap)
                // This check now ensures 'details' exists and has a 'user' property before comparing
                .filter(([_, details]) => details && details.user === username)
                .map(([name, details]) => ({ name, ...details }));
                
            res.json(userContainers);
        } catch (parseError) {
            console.error("Error parsing port_map.json:", parseError);
            res.status(500).json({ error: "Could not parse container list." });
        }
    });
});

// Kicks off the container creation script as a background job
app.post('/create-container', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const jobId = crypto.randomUUID();
    const commandEnv = { ...process.env, ...req.body, PROXMOX_USERNAME: req.session.proxmoxUsername, PROXMOX_PASSWORD: req.session.proxmoxPassword };
    const scriptPath = '/opt/container-creator/create-container-wrapper.sh';
    
    jobs[jobId] = { status: 'running', output: '' };

    const command = `${scriptPath} 2>&1`;
    const child = spawn('bash', ['-c', command], { env: commandEnv });

    child.stdout.on('data', (data) => {
        const message = data.toString();
        console.log(`[${jobId}]: ${message.trim()}`);
        jobs[jobId].output += message;
    });

    child.on('close', (code) => {
        console.log(`[${jobId}] process exited with code ${code}`);
        jobs[jobId].status = (code === 0) ? 'completed' : 'failed';
    });

    res.json({ success: true, redirect: `/status/${jobId}` });
});

// Serves the status page for a specific job
app.get('/status/:jobId', (req, res) => {
    if (!jobs[req.params.jobId]) {
        return res.status(404).send("Job not found.");
    }
    res.sendFile(path.join(__dirname, 'views', 'status.html'));
});

// Streams the log output to the status page using Server-Sent Events (SSE)
app.get('/api/stream/:jobId', (req, res) => {
    const { jobId } = req.params;
    if (!jobs[jobId]) {
        return res.status(404).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify(jobs[jobId].output)}\n\n`);

    let lastSentLength = jobs[jobId].output.length;
    const intervalId = setInterval(() => {
        const currentOutput = jobs[jobId].output;
        if (currentOutput.length > lastSentLength) {
            const newData = currentOutput.substring(lastSentLength);
            res.write(`data: ${JSON.stringify(newData)}\n\n`);
            lastSentLength = currentOutput.length;
        }

        if (jobs[jobId].status !== 'running') {
            res.write(`event: close\ndata: Process finished with status: ${jobs[jobId].status}\n\n`);
            clearInterval(intervalId);
            res.end();
        }
    }, 500);

    req.on('close', () => {
        clearInterval(intervalId);
        res.end();
    });
});

// --- Server Initialization ---
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));