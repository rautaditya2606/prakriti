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

router.post('/questionnaire', isAuthenticated, async (req, res) => {
  const { answers } = req.body; // Assume answers are sent as an array

  try {
    // Call the analyzePrakriti function with the conversation history
    const conversationHistory = [];
    // Add the answers to the conversation history
    if (answers && Array.isArray(answers)) {
      answers.forEach((answer, index) => {
        conversationHistory.push({
          sender: 'user',
          text: answer
        });
      });
    }

    // Get the prakriti analysis
    const chatModule = require('./chat');
    const analyzePrakriti = chatModule.analyzePrakriti;
    let prakritiResult = await analyzePrakriti(conversationHistory);
    
    // If scores are all zeros, set them based on the dominant dosha
    if (prakritiResult.scores && 
        prakritiResult.scores.vata === 0 && 
        prakritiResult.scores.pitta === 0 && 
        prakritiResult.scores.kapha === 0) {
      
      const dominantDosha = prakritiResult.dominantDosha.toLowerCase();
      prakritiResult.scores = {
        vata: dominantDosha === 'vata' ? 80 : 10,
        pitta: dominantDosha === 'pitta' ? 80 : 10,
        kapha: dominantDosha === 'kapha' ? 80 : 10
      };
      
      console.log('Adjusted scores for dominant dosha:', prakritiResult);
    }
    
    const users = readUsers();
    const userIndex = users.findIndex(user => user.id === req.session.userId);

    if (userIndex === -1) {
      return res.status(404).send('User not found');
    }

    // Update user with prakriti results
    users[userIndex] = {
      ...users[userIndex],
      prakriti: prakritiResult.dominantDosha,
      explanation: prakritiResult.explanation,
      doshaScores: prakritiResult.scores,
      lastAssessment: new Date().toISOString()
    };

    // Save to file
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));

    // Update session
    req.session.user = users[userIndex];
    
    res.redirect('/prakriti/dashboard');
  } catch (error) {
    console.error('Error processing questionnaire:', error);
    res.status(500).send('Error processing your assessment. Please try again.');
  }
});

module.exports = router;