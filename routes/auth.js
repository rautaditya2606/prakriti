const express = require('express');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const usersFilePath = path.join(__dirname, '../users.json');

// Helper function to read users from JSON file
function readUsers() {
  if (!fs.existsSync(usersFilePath)) {
    return [];
  }
  const data = fs.readFileSync(usersFilePath);
  return JSON.parse(data);
}

// Helper function to write users to JSON file
function writeUsers(users) {
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
}

// Signup route
router.get('/signup', (req, res) => {
  res.render('signup');
});

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  const users = readUsers();

  // Check if email already exists
  if (users.find(user => user.email === email)) {
    return res.status(400).send('Email already exists');
  }

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Add new user
  const newUser = {
    id: users.length + 1,
    name,
    email,
    password: hashedPassword,
    prakriti: null,
  };
  users.push(newUser);
  writeUsers(users);

  res.redirect('/auth/login');
});

// Login route
// Check if user is already logged in
router.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/prakriti/dashboard');
  }
  res.render('login');
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const users = readUsers();

  const user = users.find(user => user.email === email);
  if (!user) {
    return res.status(400).send('Invalid email or password');
  }

  // Check password
  bcrypt.compare(password, user.password, (err, isMatch) => {
    if (err || !isMatch) {
      return res.status(400).send('Invalid email or password');
    }

        // Save user session
      req.session.userId = user.id;
      req.session.user = user; // Store the entire user object in session
      res.redirect('/prakriti');
  });
});

// Logout route
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).send('Could not log out');
    }
    res.redirect('/auth/login');
  });
});

module.exports = router;