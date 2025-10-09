const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Session setup
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your_secret_key', // Use environment variable for production
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
  })
);

// Custom middleware to make user data available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const chatModule = require('./routes/chat');
const chatRoutes = chatModule.router;
const prakritiRoutes = require('./routes/prakriti');

// Mount routes
app.use('/auth', authRoutes);
app.use('/prakriti', dashboardRoutes);
app.use('/prakriti', prakritiRoutes); // Add this line to include prakriti routes
app.use('/chat', chatRoutes);

// Home route
app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/prakriti');
  }
  res.redirect('/auth/login');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { message: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});