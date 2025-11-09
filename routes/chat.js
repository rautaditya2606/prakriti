const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const axios = require('axios');

const router = express.Router();

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

const usersFilePath = path.join(__dirname, '../users.json');
const userChatsFilePath = path.join(__dirname, '../user_chats.json');

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
    return res.status(401).render('error', {
        errorCode: 401,
        errorMessage: 'Unauthorized',
        errorDescription: 'You do not have permission to access this resource. Please log in or contact support if you believe this is an error.'
    });
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

// Helper function to read user chats from JSON file
async function readUserChats() {
  try {
    const data = await fs.readFile(userChatsFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading user chats file:', error);
    return [];
  }
}

// Helper function to write user chats to JSON file
async function writeUserChats(chats) {
  try {
    await fs.writeFile(userChatsFilePath, JSON.stringify(chats, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing user chats file:', error);
    throw error;
  }
}

// Middleware to log chat messages
async function logChatMessage(userId, sender, message) {
  const chats = await readUserChats();
  let userChat = chats.find(chat => chat.userId === userId);

  if (!userChat) {
    userChat = { userId, chats: [] };
    chats.push(userChat);
  }

  userChat.chats.push({
    sender,
    message,
    timestamp: new Date().toISOString()
  });

  await writeUserChats(chats);
}

// Detailed explanations for each dosha type
const DOSHA_EXPLANATIONS = {
  Vata: {
    physical: "Vata types typically have a light, thin build with prominent features and dry skin. They may experience cold hands and feet and have variable digestion and appetite.",
    mental: "Mentally, Vatas are creative, energetic, and enthusiastic. They learn quickly but also forget easily. When in balance, they are lively and flexible. When out of balance, they may experience anxiety, insomnia, or digestive issues.",
    recommendations: "To stay balanced, Vatas benefit from regular routines, warm foods, and calming activities like yoga or meditation."
  },
  Pitta: {
    physical: "Pitta types usually have a medium, well-proportioned build with warm skin that may be sensitive or prone to rashes. They have strong digestion and a good appetite.",
    mental: "Mentally, Pittas are intelligent, focused, and goal-oriented. They have strong leadership qualities but can become irritable or impatient when stressed. When in balance, they are warm, friendly, and disciplined.",
    recommendations: "Pittas should avoid excessive heat and stress, and incorporate cooling foods and relaxation techniques into their routine."
  },
  Kapha: {
    physical: "Kapha types tend to have a solid, sturdy build with smooth, oily skin. They have excellent stamina but may gain weight easily and have a slow metabolism.",
    mental: "Mentally, Kaphas are calm, patient, and loving. They are slow to anger but may become stubborn or resistant to change. When in balance, they provide stability and support to others.",
    recommendations: "Kaphas benefit from regular exercise, a light diet, and stimulating environments to maintain balance and avoid lethargy."
  }
};

// Function to analyze responses and determine Prakriti using Gemini
async function analyzePrakriti(conversation) {
  try {
    console.log('Analyzing conversation with Gemini...');

    // Extract just the text from the conversation
    const conversationText = conversation
      .filter(msg => msg.sender === 'user')
      .map(msg => `User: ${msg.text}`)
      .join('\n');

    const prompt = `You are an experienced Ayurvedic practitioner. Analyze the following conversation and determine the user's dosha constitution (Prakriti) based on their responses.

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
  "explanation": "A detailed 3-4 sentence explanation of the analysis, including key characteristics and traits identified."
}

Important: Only respond with valid JSON, no additional text.`;

    console.log('Sending to Gemini:', prompt);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('Raw Gemini response:', text);

    // Try to extract JSON from the response using a more robust method
    let jsonText = text.trim();

    // Remove potential markdown code blocks
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\n|\n```$/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\n|\n```$/g, '');
    }

    // Clean up any remaining non-JSON text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    try {
      const parsedResponse = JSON.parse(jsonText);
      console.log('Parsed response:', parsedResponse);

      // Ensure we have a valid dosha
      const validDoshas = ['Vata', 'Pitta', 'Kapha'];
      const dominantDosha = validDoshas.includes(parsedResponse.dominantDosha)
        ? parsedResponse.dominantDosha
        : 'Vata';

      // Get detailed explanation for the dominant dosha
      const doshaInfo = DOSHA_EXPLANATIONS[dominantDosha] || DOSHA_EXPLANATIONS.Vata;
      const detailedExplanation = `As a ${dominantDosha} type, ${doshaInfo.physical} ${doshaInfo.mental} ${doshaInfo.recommendations}`;

      return {
        dominantDosha: dominantDosha,
        scores: {
          vata: Math.min(100, Math.max(0, parseInt(parsedResponse.scores?.vata) || 33)),
          pitta: Math.min(100, Math.max(0, parseInt(parsedResponse.scores?.pitta) || 33)),
          kapha: Math.min(100, Math.max(0, parseInt(parsedResponse.scores?.kapha) || 34))
        },
        explanation: parsedResponse.explanation || detailedExplanation
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
    console.warn('Falling back to keyword matching due to AI analysis failure');

    // Enhanced keyword matching with more comprehensive terms
    const doshaScores = { vata: 0, pitta: 0, kapha: 0 };
    const keywordWeights = {
      vata: {
        'thin': 2, 'light': 2, 'dry': 2, 'cold': 2, 'anxious': 2, 'irregular': 2, 'creative': 1, 'enthusiastic': 1,
        'quick': 1, 'variable': 1, 'active': 1, 'restless': 2, 'sensitive': 1, 'flexible': 1, 'energetic': 1
      },
      pitta: {
        'medium': 1, 'oily': 2, 'warm': 2, 'intense': 2, 'irritable': 2, 'ambitious': 2, 'focused': 1, 'strong': 1,
        'determined': 1, 'perfectionist': 1, 'leader': 1, 'competitive': 2, 'goal-oriented': 2, 'sharp': 1
      },
      kapha: {
        'large': 1, 'solid': 2, 'heavy': 2, 'slow': 2, 'calm': 2, 'steady': 2, 'grounded': 1, 'nurturing': 1,
        'patient': 1, 'forgiving': 1, 'loving': 1, 'stable': 1, 'methodical': 1, 'loyal': 1, 'supportive': 1
      }
    };

    // Analyze each user message with weighted scores
    conversation.forEach(msg => {
      if (msg.sender === 'user') {
        const text = msg.text.toLowerCase();

        // Check for each keyword and add weighted scores
        Object.entries(keywordWeights).forEach(([dosha, keywords]) => {
          Object.entries(keywords).forEach(([keyword, weight]) => {
            if (text.includes(keyword)) {
              doshaScores[dosha] += weight;
            }
          });
        });
      }
    });

    // Ensure minimum scores for all doshas
    doshaScores.vata = Math.max(1, doshaScores.vata);
    doshaScores.pitta = Math.max(1, doshaScores.pitta);
    doshaScores.kapha = Math.max(1, doshaScores.kapha);

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

    // Get detailed explanation for the dominant dosha
    const doshaInfo = DOSHA_EXPLANATIONS[dominantDosha] || DOSHA_EXPLANATIONS.Vata;
    const detailedExplanation = `Based on your responses, your dominant dosha appears to be ${dominantDosha}. ${doshaInfo.physical} ${doshaInfo.mental} ${doshaInfo.recommendations}`;

    // Calculate total score for normalization
    const totalScore = doshaScores.vata + doshaScores.pitta + doshaScores.kapha;

    return {
      dominantDosha,
      scores: {
        vata: Math.round((doshaScores.vata / totalScore) * 100),
        pitta: Math.round((doshaScores.pitta / totalScore) * 100),
        kapha: Math.round((doshaScores.kapha / totalScore) * 100)
      },
      explanation: detailedExplanation
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

    // Format user data for the template
    const userData = {
      ...user,
      prakriti: {
        type: user.prakriti,
        description: user.explanation,
        scores: user.doshaScores
      }
    };

    res.render('chat', {
      user: userData,
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

  // Log the user's message
  await logChatMessage(user.id, 'user', message);

  // Helper function to get a random response from an array
  const getRandomResponse = (responses) => responses[Math.floor(Math.random() * responses.length)];

  // Check for greetings
  if (/(hi|hello|hey|greetings)/i.test(lowerMessage)) {
    const greetings = [
      `Hi ${userName}! How can I help you today?`,
      `Hello there! What can I do for you?`,
      `Hey! How can I assist you today?`
    ];
    const response = getRandomResponse(greetings);

    // Log the bot's response
    await logChatMessage(user.id, 'bot', response);
    return response;
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
    // Add system instruction to avoid formatting
    const systemInstruction = `You are a helpful Ayurvedic Prakriti assistant. Your responses should be:

CRITICAL FORMATTING RULES:
- Use ONLY plain text - NO HTML tags of any kind
- NO markdown formatting (no **bold**, *italic*, etc.)
- NO code blocks or special formatting
- Use simple line breaks for paragraphs
- Use bullet points with asterisks if needed, but no other formatting
- Keep responses clear and conversational

IMPORTANT: If you include any formatting tags, the user will see them as raw text, so please avoid all formatting completely.`;

    const fullPrompt = `${systemInstruction}

User message: ${message}`;

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: fullPrompt
          }]
        }],
        // You can also add system instruction as a separate parameter if supported
        systemInstruction: {
          parts: [{
            text: systemInstruction
          }]
        }
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

// Add a route to handle prakriti-card click
router.post('/prakriti-card', isAuthenticated, async (req, res) => {
  try {
    const users = await readUsers();
    const user = users.find(u => u.id === req.session.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send the user's prakriti data to the chatbot
    const prakritiData = {
      prakriti: user.prakriti,
      explanation: user.explanation,
      doshaScores: user.doshaScores
    };

    return res.json({
      message: 'Prakriti data sent successfully.',
      data: prakritiData
    });
  } catch (error) {
    console.error('Error handling prakriti-card click:', error);
    return res.status(500).json({
      error: 'An error occurred while processing the request.',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// New route to handle sending messages with user-specific Prakriti data
router.post('/send-message', async (req, res) => {
  const { message, prakriti, traits, imbalances } = req.body;

  const systemPrompt = {
    role: "system",
    content: `You are an Ayurvedic Prakriti specialist. When given a user's Prakriti type and traits, you must provide detailed recommendations in the following structured format: 

1. Daily Routine:
  - Morning:
  - Afternoon:
  - Evening:
  - Before Sleep:

2. Meals:
  - Breakfast:
  - Lunch:
  - Dinner:

Be specific to the user's Prakriti, including dosha-balancing activities, foods, and lifestyle tips. Avoid generic explanations.`
  };

  const userMessage = {
    role: "user",
    content: `User Prakriti: ${prakriti}. Traits: ${traits.join(', ')}. Imbalances: ${imbalances.join(', ')}. ${message}`
  };

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: "gpt-4",
      messages: [systemPrompt, userMessage]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({ reply: response.data.choices[0].message.content });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error communicating with chatbot API');
  }
});

// Export the router and utility functions
module.exports = {
  router,
  analyzePrakriti,
  getPrakritiExplanation
};