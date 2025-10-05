const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const router = express.Router();

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

const usersFilePath = path.join(__dirname, '../users.json');

// Predefined questions for Prakriti assessment
const QUESTIONS = [
  "How would you describe your body frame? (e.g., thin and light, medium build, or large and solid)",
  "How is your skin typically? (e.g., dry, oily, or combination)",
  "How do you typically respond to stress? (e.g., anxious, irritable, or withdrawn)",
  "What best describes your energy levels throughout the day? (e.g., variable, intense, or steady)",
  "How is your appetite and digestion? (e.g., irregular, strong, or slow)",
  "How do you typically sleep? (e.g., light sleeper, moderate, or heavy sleeper)",
  "What best describes your personality? (e.g., creative and enthusiastic, ambitious and focused, or calm and steady)"
];

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Helper function to read users from JSON file
async function readUsers() {
  try {
    const data = await fs.readFile(usersFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading users file:', error);
    return [];
  }
}

// Helper function to write users to JSON file
async function writeUsers(users) {
  try {
    await fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing users file:', error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

// Function to analyze responses and determine Prakriti using Gemini
async function analyzePrakriti(conversation) {
  try {
    const prompt = `Analyze the following conversation and determine the user's dominant dosha (Vata, Pitta, or Kapha) based on their responses. 
    Return a JSON object with the following structure: 
    {
      "dominantDosha": "Vata/Pitta/Kapha",
      "scores": {
        "vata": 0-100,
        "pitta": 0-100,
        "kapha": 0-100
      },
      "explanation": "Brief explanation of the analysis"
    }
    
    Conversation: ${JSON.stringify(conversation, null, 2)}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Try to parse the JSON response
    try {
      const parsedResponse = JSON.parse(text);
      return {
        dominantDosha: parsedResponse.dominantDosha,
        scores: parsedResponse.scores || { vata: 0, pitta: 0, kapha: 0 },
        explanation: parsedResponse.explanation || 'No explanation provided'
      };
    } catch (e) {
      console.error('Error parsing AI response:', e);
      throw new Error('Failed to parse AI response');
    }
  } catch (error) {
    console.error('Error analyzing prakriti:', error);
    // Fallback to simple keyword matching if AI fails
    const doshaScores = { vata: 0, pitta: 0, kapha: 0 };
    const vataKeywords = ['thin', 'light', 'dry', 'cold', 'anxious', 'irregular', 'creative', 'enthusiastic'];
    const pittaKeywords = ['medium', 'oily', 'warm', 'intense', 'irritable', 'ambitious', 'focused', 'strong'];
    const kaphaKeywords = ['large', 'solid', 'heavy', 'slow', 'calm', 'steady', 'grounded', 'nurturing'];

    // Analyze each user message
    conversation.forEach(msg => {
      if (msg.sender === 'user') {
        const text = msg.text.toLowerCase();
        
        // Check for dosha keywords
        vataKeywords.forEach(keyword => {
          if (text.includes(keyword)) doshaScores.vata++;
        });
        pittaKeywords.forEach(keyword => {
          if (text.includes(keyword)) doshaScores.pitta++;
        });
        kaphaKeywords.forEach(keyword => {
          if (text.includes(keyword)) doshaScores.kapha++;
        });
      }
    });

    // Determine dominant dosha
    let dominantDosha = 'Vata';
    let maxScore = doshaScores.vata;
    
    if (doshaScores.pitta > maxScore) {
      maxScore = doshaScores.pitta;
      dominantDosha = 'Pitta';
    }
    
    if (doshaScores.kapha > maxScore) {
      dominantDosha = 'Kapha';
    }

    // Calculate total score for normalization
    const totalScore = doshaScores.vata + doshaScores.pitta + doshaScores.kapha || 1; // Avoid division by zero
    
    return {
      dominantDosha,
      scores: {
        vata: Math.round((doshaScores.vata / totalScore) * 100),
        pitta: Math.round((doshaScores.pitta / totalScore) * 100),
        kapha: Math.round((doshaScores.kapha / totalScore) * 100)
      },
      explanation: `Based on your responses, your dominant dosha appears to be ${dominantDosha}.`
    };
  }
}

// Function to get explanation for each dosha
function getPrakritiExplanation(dosha) {
  const explanations = {
    vata: 'Vata types are creative, energetic, and lively. They tend to be thin, light, and quick in their thoughts and actions. When in balance, Vatas are flexible and have a joyful, enthusiastic outlook. When out of balance, they may experience anxiety, insomnia, or digestive issues.',
    pitta: 'Pitta types are intense, intelligent, and goal-oriented. They have a medium build and tend to be focused and determined. When in balance, Pittas are strong leaders with a sharp intellect. When out of balance, they may become irritable, impatient, or prone to inflammation.',
    kapha: 'Kapha types are calm, steady, and strong. They have a solid build and tend to be nurturing and supportive. When in balance, Kaphas are loving and loyal. When out of balance, they may become lethargic, resistant to change, or prone to weight gain.'
  };
  
  return explanations[dosha] || 'Your Prakriti analysis is complete.';
}

// Function to call LLM API (kept for future enhancement)
async function getPrakritiFromLLM(conversationHistory) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not found. Using local analysis.');
      return analyzePrakriti(conversationHistory);
    }

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    
    // Prepare the conversation for the LLM
    const prompt = `Analyze the following conversation to determine the person's Ayurvedic Prakriti (Vata, Pitta, or Kapha). 
    Consider their physical characteristics, personality traits, and other mentioned attributes.
    
    Conversation:
    ${conversationHistory.map(msg => `${msg.sender === 'user' ? 'User' : 'Bot'}: ${msg.text}`).join('\n')}
    
    Please respond with a JSON object containing:
    {
      "prakriti": "Vata/Pitta/Kapha",
      "explanation": "Brief explanation of the analysis",
      "doshaScores": {
        "vata": 0-100,
        "pitta": 0-100,
        "kapha": 0-100
      }
    }`;

    const requestBody = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API call failed with status ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.contents[0]?.parts[0]?.text || '{}';
    
    try {
      // Try to parse the JSON response
      const result = JSON.parse(responseText);
      return {
        prakriti: result.prakriti || 'Unknown',
        explanation: result.explanation || 'Analysis complete',
        doshaScores: result.doshaScores || { vata: 33, pitta: 33, kapha: 34 }
      };
    } catch (e) {
      console.error('Failed to parse LLM response:', e);
      // Fall back to local analysis if LLM response is not in expected format
      return analyzePrakriti(conversationHistory);
    }
  } catch (error) {
    console.error('Error calling LLM API:', error);
    // Fall back to local analysis if there's an error with the API call
    return analyzePrakriti(conversationHistory);
  }
}

// Chat interface route
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const users = await readUsers();
    const user = users.find(u => u.id === req.session.userId);
    
    if (!user) {
      return res.status(404).render('error', { 
        message: 'User not found',
        user: null
      });
    }
    
    res.render('chat', { 
      user: user,
      title: 'Chat - Prakriti Diagnosis',
      conversation: []
    });
  } catch (error) {
    console.error('Chat route error:', error);
    res.status(500).render('error', {
      message: 'Error loading chat interface',
      user: req.session.user || null
    });
  }
});

// Chat message handling route
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { message, conversation = [] } = req.body;
    const users = await readUsers();
    const user = users.find(u => u.id === req.session.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate the conversation array
    if (!Array.isArray(conversation)) {
      return res.status(400).json({ error: 'Invalid conversation format' });
    }

    // Add user message to conversation
    const updatedConversation = [
      ...conversation,
      { sender: 'user', text: message }
    ];
    
    // Check if this is the last question
    if (updatedConversation.filter(msg => msg.sender === 'bot').length >= QUESTIONS.length) {
      // Analyze responses and determine prakriti
      const analysis = await getPrakritiFromLLM(updatedConversation);
      
      // Update user's prakriti
      user.prakriti = analysis.prakriti || analysis.dominantDosha;
      user.doshaScores = analysis.scores || analysis.doshaScores || { vata: 0, pitta: 0, kapha: 0 };
      user.lastAssessment = new Date().toISOString();
      
      // Save updated user data
      const userIndex = users.findIndex(u => u.id === user.id);
      if (userIndex !== -1) {
        users[userIndex] = user;
        await writeUsers(users);
      }
      
      // Update session
      req.session.user = user;
      
      return res.json({
        conversation: [
          ...updatedConversation,
          { 
            sender: 'bot', 
            text: `Based on your responses, your dominant dosha is ${user.prakriti}.\n\n${analysis.explanation || getPrakritiExplanation(user.prakriti.toLowerCase())}`,
            isFinal: true,
            prakriti: user.prakriti,
            scores: user.doshaScores
          }
        ]
      });
    }
    
    // Get next question
    const nextQuestion = QUESTIONS[updatedConversation.filter(msg => msg.sender === 'bot').length];
    
    // Add bot's response to conversation
    const botResponse = {
      sender: 'bot',
      text: nextQuestion,
      isFinal: false
    };
    
    res.json({
      conversation: [...updatedConversation, botResponse]
    });
    
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ 
      error: 'Error processing your message. Please try again.' 
    });
  }
});

module.exports = router;