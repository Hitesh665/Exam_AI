import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';

// Load environment variables from .env
dotenv.config();

// Resolve paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'examai_fallback_jwt_secret_key_2026';
const USERS_FILE = path.join(__dirname, 'users.json');

// ==========================================
// Middleware Setup
// ==========================================

// Security headers with CSP disabled so inline SVGs and CDN scripts load smoothly
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(cors());

// Increase JSON body limit to 10MB to accept base64-encoded images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve all frontend static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// General API rate limiter (120 requests per 15 minutes)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// Stricter rate limiter for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ==========================================
// Database Setup: MongoDB Atlas + Local JSON Fallback
// ==========================================
let isMongoConnected = false;

// Mongoose User Schema
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MongoUser = mongoose.models.User || mongoose.model('User', userSchema);

// Connect to MongoDB Atlas if MONGODB_URI is provided
async function initDatabase() {
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri && mongoUri.trim()) {
    try {
      await mongoose.connect(mongoUri.trim(), { serverSelectionTimeoutMS: 5000 });
      isMongoConnected = true;
      console.log('✅ Connected to MongoDB Atlas Cloud Database');
    } catch (err) {
      console.warn('⚠️ MongoDB Atlas connection error. Falling back to local users.json:', err.message);
      isMongoConnected = false;
    }
  } else {
    console.log('ℹ️ MONGODB_URI not found in environment. Using local users.json storage.');
    isMongoConnected = false;
  }
}

// Helper: read local users.json fallback
async function readUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.writeFile(USERS_FILE, '[]', 'utf-8');
      return [];
    }
    console.error('Error reading users file:', err.message);
    return [];
  }
}

// Helper: write local users.json fallback
async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// Unified Database Functions (Seamless MongoDB / JSON switching)
async function findUserByEmail(email) {
  const cleanEmail = email.trim().toLowerCase();
  if (isMongoConnected) {
    return await MongoUser.findOne({ email: cleanEmail });
  } else {
    const users = await readUsers();
    return users.find((u) => u.email.toLowerCase() === cleanEmail) || null;
  }
}

async function createUser({ name, email, password }) {
  const cleanEmail = email.trim().toLowerCase();
  const id = 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  if (isMongoConnected) {
    const userDoc = new MongoUser({
      id,
      name: name.trim().slice(0, 100),
      email: cleanEmail,
      password
    });
    await userDoc.save();
    return { id: userDoc.id, name: userDoc.name, email: userDoc.email };
  } else {
    const users = await readUsers();
    const newUser = {
      id,
      name: name.trim().slice(0, 100),
      email: cleanEmail,
      password,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    await writeUsers(users);
    return { id: newUser.id, name: newUser.name, email: newUser.email };
  }
}

// Initialize database connection
initDatabase();

// ==========================================
// Authentication Middleware
// ==========================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
    }
    req.user = decodedUser;
    next();
  });
}

// ==========================================
// Lazy Gemini Client Initialization
// ==========================================
function getGeminiClient() {
  dotenv.config(); // Reload .env dynamically so key updates work immediately
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_gemini_api_key_here') {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

// Sanitize user personalization fields to prevent prompt manipulation and control character injection
function sanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return {};
  const allowedFields = ['name', 'grade', 'exam', 'subjects', 'examDate', 'weakTopics', 'answerStyle'];
  const clean = {};
  for (const field of allowedFields) {
    if (typeof profile[field] === 'string') {
      // Strip control chars (\x00-\x1F\x7F) and limit length to 150 chars
      clean[field] = profile[field].replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 150);
    }
  }
  return clean;
}

// Build system prompt incorporating student personalization
function buildSystemInstruction(profile) {
  const clean = sanitizeProfile(profile);
  let prompt = `You are "ExamAI", an expert exam preparation tutor and coach dedicated to helping students ace their examinations.
Your tone is encouraging, academically rigorous, articulate, and structured.
Guidelines:
1. Always format responses using clean markdown (headings, bold text, bullet points, numbered lists, math symbols, code blocks when relevant).
2. For conceptual explanations: use the First Principles method, followed by an intuitive real-world analogy, key points, and a sample exam question with its model answer.
3. For revision: keep points punchy, high-yield, and memorable.
4. When correcting student answers, be constructive: praise what is right, pinpoint missing keywords, and supply the ideal answer with mark distribution.`;

  if (clean.name || clean.exam || clean.grade || clean.subjects || clean.weakTopics) {
    prompt += `\n\nStudent Profile:`;
    if (clean.name) prompt += `\n- Student Name: ${clean.name}`;
    if (clean.exam) prompt += `\n- Target Exam: ${clean.exam}`;
    if (clean.grade) prompt += `\n- Class / Year: ${clean.grade}`;
    if (clean.subjects) prompt += `\n- Subjects: ${clean.subjects}`;
    if (clean.examDate) prompt += `\n- Exam Date: ${clean.examDate}`;
    if (clean.weakTopics) prompt += `\n- Weak / Priority Topics: ${clean.weakTopics}`;
    if (clean.answerStyle) prompt += `\n- Preferred Answer Style: ${clean.answerStyle}`;
    prompt += `\nTailor your explanations, difficulty, and examples specifically to match this student's exam syllabus and level.`;
  }

  return prompt;
}

// ==========================================
// Authentication Routes
// ==========================================

// POST /api/signup
app.post('/api/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Input validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters long.' });
    }
    if (!email || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await findUserByEmail(cleanEmail);
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await createUser({
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword
    });

    // Issue JWT token
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, name: newUser.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email }
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// POST /api/login
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await findUserByEmail(cleanEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password. Please check your credentials or create an account first.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password. Please check your credentials or create an account first.' });
    }

    // Issue JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// GET /api/health (Server & Database Health status)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: isMongoConnected ? 'mongodb_atlas' : 'local_file',
    timestamp: new Date().toISOString()
  });
});

// GET /api/me (Verify active session)
app.get('/api/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================
// AI Chat & Quiz Generation Route
// ==========================================

// JSON schema for Quiz Generation mode
const quizResponseSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          type: {
            type: 'string',
            enum: ['mcq', 'one_mark', 'short', 'long']
          },
          section: { type: 'string' },
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string' }
          },
          answer: { type: 'string' },
          explanation: { type: 'string' },
          marks: { type: 'integer' }
        },
        required: ['id', 'type', 'section', 'question', 'answer', 'marks']
      }
    }
  },
  required: ['questions']
};

// JSON schema for AI Flashcards Generation mode
const flashcardResponseSchema = {
  type: 'object',
  properties: {
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' }
        },
        required: ['front', 'back']
      }
    }
  },
  required: ['flashcards']
};

// POST /api/chat
app.post('/api/chat', authenticateToken, async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI key not configured yet. Add GEMINI_API_KEY to .env and restart the server.',
      isKeyMissing: true
    });
  }

  const { messages, mode = 'chat', quizConfig, profile } = req.body;
  const modelName = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  const systemInstruction = buildSystemInstruction(profile);

  // ----------------------------------------
  // Mode 1: Quiz Generation (Strict JSON Mode, Non-Streaming)
  // ----------------------------------------
  if (mode === 'quiz') {
    const qType = quizConfig?.type || 'mcq';
    const qCount = Math.min(Math.max(parseInt(quizConfig?.count, 10) || 5, 1), 25);
    const difficulty = quizConfig?.difficulty || 'Medium';
    const topic = quizConfig?.topic?.trim() || 'General Exam Revision';
    const includeExplanations = quizConfig?.includeExplanations !== false;

    let distributionGuide = '';
    if (qType === 'mixed') {
      if (qCount === 5) {
        distributionGuide = `Generate exactly 5 questions divided across 4 sections:
- Section A: Exactly 2 Multiple Choice Questions (type: "mcq", 1 mark each). Must have 4 options array ["A) ...", "B) ...", "C) ...", "D) ..."] and answer set to single letter key e.g. "B".
- Section B: Exactly 1 One-mark question (type: "one_mark", 1 mark, definition / direct concept / true-false / fill in the blanks).
- Section C: Exactly 1 Short Answer question (type: "short", 3 marks, point-wise model answer).
- Section D: Exactly 1 Long Answer question (type: "long", 5 marks, comprehensive structured model answer with headings/steps).
Total marks = 11 marks.`;
      } else {
        const mcqCount = Math.round(qCount * 0.4);
        const oneMarkCount = Math.round(qCount * 0.2);
        const shortCount = Math.round(qCount * 0.25);
        const longCount = Math.max(1, qCount - (mcqCount + oneMarkCount + shortCount));
        distributionGuide = `Generate ${qCount} questions structured as:
- Section A: ${mcqCount} MCQ questions (type: "mcq", 1 mark each, 4 options array, answer letter key).
- Section B: ${oneMarkCount} One-mark questions (type: "one_mark", 1 mark each).
- Section C: ${shortCount} Short answer questions (type: "short", 3 marks each).
- Section D: ${longCount} Long answer questions (type: "long", 5 marks each).`;
      }
    } else if (qType === 'mcq') {
      distributionGuide = `Generate exactly ${qCount} Multiple Choice Questions (type: "mcq", section: "A", 1 mark each).
Every question must have an "options" array with exactly 4 options formatted like ["A) option text", "B) option text", "C) option text", "D) option text"].
The "answer" field must be the correct option letter, e.g. "A", "B", "C", or "D".`;
    } else if (qType === 'one_mark') {
      distributionGuide = `Generate exactly ${qCount} One-Mark Questions (type: "one_mark", section: "A", 1 mark each).
Questions should test definitions, key formulas, true/false, or direct one-line facts. Do NOT include options array. Provide a concise 1-line model answer.`;
    } else if (qType === 'short') {
      distributionGuide = `Generate exactly ${qCount} Short Answer Questions (type: "short", section: "A", 3 marks each).
Provide structured 3-bullet-point model answers demonstrating key concepts. Do NOT include options array.`;
    } else if (qType === 'long') {
      distributionGuide = `Generate exactly ${qCount} Long Answer Questions (type: "long", section: "A", 5 marks each).
Provide comprehensive, structured model answers with headings, subpoints, and expected keyword coverage. Do NOT include options array.`;
    }

    const quizPrompt = `Generate an exam question paper on the topic: "${topic}".
Difficulty level: ${difficulty}.
${distributionGuide}
${includeExplanations ? 'Include clear, educational explanations for each question.' : 'Explanations can be brief.'}
Ensure all questions are academically accurate, syllabus-relevant, and formatted according to the JSON schema.`;

    // Attempt quiz generation with 1 retry on invalid format
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: quizPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: quizResponseSchema
          }
        });

        const rawText = response.text;
        const parsed = JSON.parse(rawText);

        if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          return res.json({ quiz: parsed });
        } else {
          throw new Error('Malformed quiz schema returned by model');
        }
      } catch (err) {
        console.warn(`Quiz generation attempt ${attempts} failed:`, err.message);
        if (attempts >= 2) {
          if (err.status === 429 || err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
            return res.status(429).json({
              error: 'Google Gemini rate limit reached. Please wait a moment and click retry.',
              isRateLimit: true
            });
          }
          return res.status(500).json({
            error: 'Failed to generate quiz in the requested format. Please try again.',
            details: err.message
          });
        }
      }
    }
    return;
  }

  // ----------------------------------------
  // Mode 2: AI Flashcard Generation (Strict JSON Mode, Non-Streaming)
  // ----------------------------------------
  if (mode === 'flashcards') {
    const topic = req.body.topic?.trim() || 'Core Exam Concepts';
    const count = Math.min(Math.max(parseInt(req.body.count, 10) || 6, 3), 15);

    const flashcardPrompt = `Generate exactly ${count} high-yield revision flashcards on the topic: "${topic}".
Each flashcard must have:
- "front": A sharp, clear concept question, formula prompt, or term.
- "back": A concise, memorable definition, formula, derivation step, or model answer.
Make them academically precise, high-yield for exams, and formatted strictly to the JSON schema.`;

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: flashcardPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: flashcardResponseSchema
        }
      });

      const parsed = JSON.parse(response.text);
      if (parsed && Array.isArray(parsed.flashcards)) {
        return res.json({ flashcards: parsed.flashcards });
      } else {
        throw new Error('Malformed flashcards response');
      }
    } catch (err) {
      console.error('Flashcard generation error:', err);
      if (err.status === 429 || err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
        return res.status(429).json({
          error: 'Rate limit reached on Google Gemini. Please wait a moment before trying again.',
          isRateLimit: true
        });
      }
      return res.status(500).json({
        error: 'Failed to generate flashcards. Please try again.',
        details: err.message
      });
    }
  }

  // ----------------------------------------
  // Mode 3: Normal Chat (Streaming with ReadableStream)
  // ----------------------------------------
  try {
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    // Limit context to the last 10 messages
    const recentMessages = messages.slice(-10);

    // Format messages for Gemini API
    const contents = recentMessages.map((msg) => {
      // Role must be 'user' or 'model' (never 'assistant')
      const role = msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user';
      const parts = [];

      // Include base64 image attachment if provided
      if (msg.attachment && msg.attachment.type === 'image' && msg.attachment.data) {
        // Strip data URI prefix if present (e.g. data:image/png;base64,)
        const base64Data = msg.attachment.data.includes(',')
          ? msg.attachment.data.split(',')[1]
          : msg.attachment.data;

        parts.push({
          inlineData: {
            mimeType: msg.attachment.mimeType || 'image/jpeg',
            data: base64Data
          }
        });
      }

      // Add text content
      parts.push({ text: msg.content || '' });

      return { role, parts };
    });

    // Set streaming headers for chunked response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const streamResult = await ai.models.generateContentStream({
      model: modelName,
      contents,
      config: {
        systemInstruction
      }
    });

    for await (const chunk of streamResult) {
      if (chunk.text) {
        res.write(chunk.text);
      }
    }

    res.end();
  } catch (err) {
    console.error('Chat error:', err);

    // Handle 429 Rate Limit cleanly
    if (err.status === 429 || err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
      if (!res.headersSent) {
        return res.status(429).json({
          error: 'Rate limit reached on Google Gemini. Please wait a moment before trying again.',
          isRateLimit: true
        });
      } else {
        res.write('\n\n[Rate limit reached on Gemini API. Please wait a moment and retry.]');
        return res.end();
      }
    }

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'An error occurred while generating the AI response. Please try again.',
        details: err.message
      });
    } else {
      res.write('\n\n[An error occurred while completing the response.]');
      res.end();
    }
  }
});

// ==========================================
// Long Answer Evaluation Route
// ==========================================

const evaluateResponseSchema = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    outOf: { type: 'number' },
    strengths: {
      type: 'array',
      items: { type: 'string' }
    },
    improvements: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['score', 'outOf', 'strengths', 'improvements']
};

// POST /api/evaluate
app.post('/api/evaluate', authenticateToken, async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI key not configured yet. Add GEMINI_API_KEY to .env and restart the server.',
      isKeyMissing: true
    });
  }

  const { question, modelAnswer, studentAnswer, marks = 5 } = req.body;

  if (!question || !studentAnswer) {
    return res.status(400).json({ error: 'Question and student answer are required for evaluation.' });
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

  const evaluationPrompt = `You are a strict, fair, and encouraging academic exam evaluator.
Evaluate the student's answer against the given question and model answer.

Question:
"${question}"

Target Marks: ${marks}

Model / Benchmark Answer:
"${modelAnswer || 'Use standard textbook accuracy for this question.'}"

Student's Answer:
"${studentAnswer}"

Evaluation Rules:
1. "score": Award marks out of ${marks} based on conceptual correctness, accuracy of key terms, completeness, and clarity. Round to 0.5 increments.
2. "outOf": Must equal ${marks}.
3. "strengths": List 2 to 3 specific positive aspects of the student's response.
4. "improvements": List 2 to 3 specific actionable points or missing keywords to achieve full marks.
Output strictly following the JSON schema.`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: evaluationPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: evaluateResponseSchema
      }
    });

    const raw = response.text;
    const parsed = JSON.parse(raw);
    return res.json(parsed);
  } catch (err) {
    console.error('Evaluation error:', err);
    if (err.status === 429 || err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({
        error: 'Gemini rate limit reached during evaluation. Please wait a moment and retry.',
        isRateLimit: true
      });
    }
    return res.status(500).json({
      error: 'Could not evaluate answer. Please try again.',
      details: err.message
    });
  }
});

// ==========================================
// Fallback Route for Single Page App
// ==========================================
app.get('*', (req, res) => {
  // If requesting an API that doesn't exist
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  // Otherwise serve index.html
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// Start Server
// ==========================================
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 ExamAI Portal is running on http://localhost:${PORT}`);
  console.log(`📁 Static files served from: ${path.join(__dirname, 'public')}`);
  console.log(`🔑 Gemini Key Status: ${process.env.GEMINI_API_KEY ? 'Configured' : 'Missing (Add to .env)'}`);
  console.log(`🤖 Model: ${process.env.GEMINI_MODEL || 'gemini-3-flash-preview'}`);
  console.log(`===============================================`);
});
