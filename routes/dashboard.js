const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();

const usersFilePath = path.join(__dirname, '../users.json');

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }
  next();
}

// Helper function to read users from JSON file
async function readUsers() {
  try {
    const data = await fs.readFile(usersFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading users file:', error);
    return [];
  }
}

// Dashboard routes
router.get(['/', '/dashboard'], isAuthenticated, async (req, res) => {
  try {
    const users = await readUsers();
    const user = users.find(u => u.id === req.session.userId);

    if (!user) {
      return res.status(404).render('error', { 
        message: 'User not found',
        user: null
      });
    }

    // Update session with latest user data
    req.session.user = user;
    res.render('dashboard', { 
      user: user,
      title: 'Dashboard - Prakriti Diagnosis'
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', {
      message: 'Error loading dashboard',
      user: req.session.user || null
    });
  }
});

module.exports = router;