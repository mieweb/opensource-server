require('dotenv').config();

const express = require('express');
const session = require('express-session');
const morgan = require('morgan');
const SequelizeStore = require('express-session-sequelize')(session.Store);
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const RateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { sequelize } = require('./models');
const { requireAuth, loadSites } = require('./middlewares');

const app = express();

// setup views
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

// setup middleware
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Parse form data
app.use(methodOverride((req, res) => {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
}));

// Configure session store
const sessionStore = new SequelizeStore({
  db: sequelize,
});

app.use(session({
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Only secure in production
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(flash());
app.use(express.static('public'));
app.use(RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
}));

// Middleware to load sites for authenticated users
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    return loadSites(req, res, next);
  }
  next();
});

// Redirect root to sites list
app.get('/', (req, res) => res.redirect('/sites'));

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  host: "opensource.mieweb.org",
  port: 25,
  secure: false, // use STARTTLS if supported
  tls: {
    rejectUnauthorized: false, // allow self-signed certs
  },
});

// --- Mount Routers ---
const loginRouter = require('./routers/login');
const registerRouter = require('./routers/register');
const usersRouter = require('./routers/users');
const groupsRouter = require('./routers/groups');
const jobsRouter = require('./routers/jobs');
app.use('/jobs', jobsRouter);
const sitesRouter = require('./routers/sites'); // Includes nested nodes router
app.use('/login', loginRouter);
app.use('/register', registerRouter);
app.use('/users', usersRouter);
app.use('/groups', groupsRouter);
app.use('/sites', sitesRouter); // /sites/:siteId/nodes and /sites/:siteId/containers routes nested here

// --- Routes ---
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

// Handles logout
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ error: 'Failed to log out.' });
    }
    res.clearCookie('connect.sid'); // Clear the session cookie
    return res.redirect('/');
  });
});
