@echo off
title ExamAI: AI Exam Preparation Chatbot Portal
echo ==============================================================
echo 🎓 Launching ExamAI Portal
echo ==============================================================

if not exist ".env" (
  echo [*] Creating .env from .env.example...
  copy .env.example .env
  echo [!] Remember to paste your Google AI Studio GEMINI_API_KEY in .env
)

if not exist "node_modules" (
  echo [*] Installing dependencies (express, @google/genai, bcryptjs, jsonwebtoken, etc.)...
  call npm install
)

echo [*] Starting server at http://localhost:3000 ...
echo [*] Press Ctrl+C anytime to stop.
echo ==============================================================
call npm start
pause
