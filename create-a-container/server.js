const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { spawn, exec } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const app = express();

// A simple in-memory object to store job status and output
const jobs = {};

// --- Middleware Setup ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public')); // For CSS, images, etc.
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

    // This command should be secure and not directly expose passwords if possible
    exec(`node /root/bin/js/runner.js authenticateUser ${username} ${password}`, (err, stdout) => {
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

// Kicks off the container creation script as a background job
app.post('/create-container', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const jobId = crypto.randomUUID();
    const commandEnv = { ...process.env, ...req.body, PROXMOX_USERNAME: req.session.proxmoxUsername, PROXMOX_PASSWORD: req.session.proxmoxPassword };
    const scriptPath = '/opt/container-creator/create-container-wrapper.sh';
    
    jobs[jobId] = { status: 'running', output: '' };

    // ✨ FIX: Run the script via bash and merge stderr into stdout with 2>&1
    const command = `${scriptPath} 2>&1`;
    const child = spawn('bash', ['-c', command], { env: commandEnv });

    // Since we merged streams, we only need to listen to stdout
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

    // Send the output that has already been generated
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