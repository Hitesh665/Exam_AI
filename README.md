# ExamAI: AI Exam Preparation Chatbot Portal 🎓🤖

ExamAI is a full-stack, production-ready web application built to empower students with personalized, AI-driven exam preparation. It features streaming conversational tutoring, structured practice quizzes across multiple question formats (MCQ, 1-Mark, Short Answer, Long Answer, and Mixed Section papers), automated long-answer grading with rubrics, PDF/image study material extraction, voice interactions, flashcards, a personalized revision timetable generator, and a performance progress tracker.

---

## 🌟 Key Highlights & Tech Stack

- **Frontend**: Plain modern HTML5, CSS3, and JavaScript (ES6+). Zero build tools or bundlers required.
  - **CDN Libraries**:
    - [Marked.js](https://cdn.jsdelivr.net/npm/marked/marked.min.js) for Markdown parsing
    - [DOMPurify](https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js) for XSS sanitization
    - [PDF.js](https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js) for client-side PDF document parsing
  - **Design System**: BEM-structured CSS with custom property tokens, dark/light theme switching, responsive clamp typography, and micro-interactions.
  - **Charts**: Custom responsive SVG / Canvas performance tracker (no heavy chart library).
- **Backend**: Node.js & Express (ES Modules) serving static files from `/public` at `http://localhost:3000`.
- **AI Engine**: Google Gemini API powered by the **current official SDK** (`@google/genai`), supporting chunked streaming for real-time tutoring and strict JSON Schema mode for structured quiz generation and answer grading.
- **Security & Reliability**:
  - Bcrypt password hashing + JWT tokens.
  - Express JSON body limit set to 10 MB for base64 study materials.
  - Helmet security headers and `express-rate-limit` protection.
  - Lazy Gemini client initialization so the server starts smoothly even before adding an API key.

---

## 📂 Project Structure

```
examai/
├── .env.example          # Environment variable template
├── .gitignore             # Git ignore patterns (.env, node_modules, users.json)
├── package.json           # Dependencies and scripts (ES Modules)
├── README.md              # Project documentation and setup guide
├── server.js              # Express backend, Gemini API integration, auth routes
├── users.json             # Local database for user credentials (auto-generated)
└── public/                # Frontend static assets served by Express
    ├── index.html         # Main dashboard and chatbot portal
    ├── login.html         # Authentication interface (Login / Signup)
    ├── style.css          # Full design system (Tokens, Theme, BEM components)
    ├── auth.js            # Frontend authentication & session handlers
    ├── quiz.js            # Quiz engine, evaluator & printable paper generator
    └── app.js             # Core chat logic, streaming reader, speech & UI controls
```

> **Note on Storage**: `users.json` is used here as a simple, zero-setup local datastore for development. For enterprise or production deployments, replace this file-based approach with an ACID-compliant database such as PostgreSQL, MySQL, or MongoDB with Prisma/Mongoose.

---

## 🚀 Quick Setup & Installation

### Step 1: Prerequisites
Ensure you have **Node.js** (v18.0.0 or later) installed on your system.
Verify with:
```bash
node -v
npm -v
```

### Step 2: Install Dependencies
Open your terminal in the `examai` directory and run:
```bash
npm install
```

### Step 3: Configure Environment Variables
Copy the `.env.example` file to `.env`:
```bash
# On Windows (PowerShell):
copy .env.example .env

# On macOS/Linux:
cp .env.example .env
```

Open `.env` in any text editor. By default, it contains:
```env
PORT=3000
JWT_SECRET=examai_super_secure_jwt_token_secret_2026_change_in_production
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3-flash-preview
```

---

## 🔑 How to Get and Configure Your Gemini API Key

You can start and explore the application UI even without an API key. When you are ready to enable AI chat and quiz generation:

1. Visit [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click on **"Get API key"** in the top navigation or sidebar.
4. Click **"Create API key in new project"** (or select an existing Google Cloud project).
5. Copy your newly generated API key.
6. Open your `.env` file and replace `your_gemini_api_key_here` with your actual key:
   ```env
   GEMINI_API_KEY=AIzaSy...your_actual_key_here...
   ```
7. *(Optional)* Check the available free-tier models on Google AI Studio. The default model is `gemini-3-flash-preview` (or `gemini-1.5-flash` / `gemini-2.0-flash`). If you ever encounter a model-not-found error, update `GEMINI_MODEL` in `.env` to the current active model name.
8. Restart your server if it was already running.

---

## 💻 Running the Application

To run the server in standard production mode:
```bash
npm start
```

Or for development with automatic reload on file changes:
```bash
npm run dev
```

Visit the application in your browser:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🛡️ API Endpoints Reference

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `POST` | `/api/signup` | No | Creates a new user, hashes password with bcrypt, returns JWT. |
| `POST` | `/api/login` | No | Authenticates user credentials and issues a 7-day JWT. |
| `GET` | `/api/me` | Yes (`Bearer <token>`) | Returns the currently authenticated user session. |
| `POST` | `/api/chat` | Yes (`Bearer <token>`) | Streams conversational answers (ReadableStream) or returns structured JSON quizzes. |
| `POST` | `/api/evaluate` | Yes (`Bearer <token>`) | Grades subjective student answers with rubrics, scoring, strengths, and areas to improve. |
