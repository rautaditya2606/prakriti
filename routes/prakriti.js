const express = require('express');
const fs = require('fs');
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
function readUsers() {
  if (!fs.existsSync(usersFilePath)) {
    return [];
  }
  const data = fs.readFileSync(usersFilePath);
  return JSON.parse(data);
}

// Dashboard route
router.get('/dashboard', isAuthenticated, (req, res) => {
  const users = readUsers();
  const user = users.find(user => user.id === req.session.userId);

  if (!user) {
    return res.status(404).send('User not found');
  }

  res.render('dashboard', { user });
});

// Questionnaire route
router.get('/questionnaire', isAuthenticated, (req, res) => {
  res.render('questionnaire');
});

router.post('/questionnaire', isAuthenticated, (req, res) => {
  const { answers } = req.body; // Assume answers are sent as an array

  // Call LLM API to get Prakriti result (mocked for now)
  const prakritiResult = 'Pitta'; // Replace with actual API call

  const users = readUsers();
  const user = users.find(user => user.id === req.session.userId);

  if (!user) {
    return res.status(404).send('User not found');
  }

  // Save Prakriti result
  user.prakriti = prakritiResult;
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));

  res.redirect('/prakriti/dashboard');
});

module.exports = router;