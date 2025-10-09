const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const router = express.Router();

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
    console.log('Analyzing conversation with Gemini...');
    
    // Extract just the text from the conversation
    const conversationText = conversation
      .filter(msg => msg.sender === 'user')
      .map(msg => `User: ${msg.text}`)
      .join('\n');
    
    const prompt = `You are an Ayurvedic expert. Analyze the following conversation and determine the user's dominant dosha (Vata, Pitta, or Kapha) based on their responses.

Conversation:
${conversationText}

Respond with a JSON object in this exact format:
{
  "dominantDosha": "Vata" or "Pitta" or "Kapha",
  "scores": {
    "vata": 0-100,
    "pitta": 0-100,
    "kapha": 0-100
  },
  "explanation": "A brief explanation of your analysis"
}`;

    console.log('Sending to Gemini:', prompt);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('Raw Gemini response:', text);
    
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : text;
    
    try {
      const parsedResponse = JSON.parse(jsonText);
      console.log('Parsed response:', parsedResponse);
      
      // Ensure we have a valid dosha
      const validDoshas = ['Vata', 'Pitta', 'Kapha'];
      const dominantDosha = validDoshas.includes(parsedResponse.dominantDosha) 
        ? parsedResponse.dominantDosha 
        : 'Vata';
      
      return {
        dominantDosha: dominantDosha,
        scores: {
          vata: Math.min(100, Math.max(0, parseInt(parsedResponse.scores?.vata) || 33)),
          pitta: Math.min(100, Math.max(0, parseInt(parsedResponse.scores?.pitta) || 33)),
          kapha: Math.min(100, Math.max(0, parseInt(parsedResponse.scores?.kapha) || 34))
        },
        explanation: parsedResponse.explanation || `Based on your responses, your dominant dosha appears to be ${dominantDosha}.`
      };
    } catch (e) {
      console.error('Error parsing AI response:', e);
      console.error('Response text was:', text);
      
      // Fallback response if parsing fails
      return {
        dominantDosha: 'Vata',
        scores: { vata: 40, pitta: 30, kapha: 30 },
        explanation: 'Based on your responses, I detected a Vata constitution. Vata types tend to be creative, energetic, and lively.'
      };
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

async function generateResponse(message, user, conversation) {
  const lowerMessage = message.toLowerCase().trim();
  const userName = user.name || 'there';
  
  // Helper function to get a random response from an array
  const getRandomResponse = (responses) => responses[Math.floor(Math.random() * responses.length)];

  // Check for greetings
  if (/(hi|hello|hey|greetings)/i.test(lowerMessage)) {
    const greetings = [
      `Hi ${userName}! How can I help you today?`,
      `Hello there! What can I do for you?`,
      `Hey! How can I assist you today?`
    ];
    return getRandomResponse(greetings);
  }

  // Check for name
  if (/(my name is|i'm|i am) ([a-z]+)/i.test(lowerMessage)) {
    const name = message.match(/(?:my name is|i'm|i am) ([a-z]+)/i)[1];
    user.name = name;
    return `Nice to meet you, ${name}! How can I help you today?`;
  }

  // Check for how are you
  if (/(how are you|how's it going)/i.test(lowerMessage)) {
    return "I'm just a bot, but I'm here and ready to help! What can I do for you?";
  }

  // Check for thank you
  if (/(thank|thanks|appreciate)/i.test(lowerMessage)) {
    const thanksResponses = [
      "You're welcome!",
      "No problem!",
      "Happy to help!",
      "Anytime!"
    ];
    return getRandomResponse(thanksResponses);
  }

  // Check for help
  if (/(help|what can you do)/i.test(lowerMessage)) {
    return "I'm a simple chatbot here to chat and answer questions. You can ask me anything, and I'll do my best to respond!";
  }

  // Default response for anything else
  const fallbackResponses = [
    "I'm not sure I understand. Could you rephrase that?",
    "I'm still learning! Could you try asking that differently?",
    "I didn't quite get that. Could you say it another way?",
    "I'm not sure how to respond to that. Could you ask me something else?"
  ];
  
  return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
}

// Function to call Gemini API
async function callGeminiAPI(message) {
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: message
          }]
        }]
      })
    });

    const data = await response.json();
    
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return data.candidates[0].content.parts[0].text;
    } else {
      console.error('Unexpected API response:', data);
      return "I'm sorry, I couldn't process that request. Please try again.";
    }
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return "I'm having trouble connecting to the AI service. Please try again later.";
  }
}

// Chat message handling route
router.post('/', async (req, res) => {
  console.log('Received chat message:', req.body);
  
  try {
    const { message, conversation = [] } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid message format',
        details: 'Message must be a non-empty string'
      });
    }
    
    // Call Gemini API with the user's message
    const aiResponse = await callGeminiAPI(message);
    
    // Add user message to conversation
    const userMessage = { 
      sender: 'user', 
      text: message,
      timestamp: new Date().toISOString()
    };
    
    // Add bot's response to conversation
    const botMessage = {
      sender: 'bot',
      text: aiResponse,
      timestamp: new Date().toISOString()
    };
    
    const updatedConversation = [...conversation, userMessage, botMessage];
    
    // Return the AI's response and updated conversation
    return res.json({ 
      text: aiResponse,
      sender: 'bot',
      timestamp: new Date().toISOString(),
      conversation: updatedConversation
    });
    
  } catch (error) {
    console.error('Error in chat route:', error);
    return res.status(500).json({
      error: 'An error occurred while processing your message.',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Export the router and utility functions
module.exports = {
  router,
  analyzePrakriti,
  getPrakritiExplanation
};