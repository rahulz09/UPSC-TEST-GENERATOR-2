# UPSC Test Generator

## Overview
A personalized platform for mastering the civil services (UPSC) exam. Users can generate AI-powered multiple-choice tests, take practice exams, and track their performance analytics.

## Project Structure
- `index.html` - Main HTML entry point
- `index.tsx` - Main TypeScript application logic
- `index.css` - Styling
- `vite.config.ts` - Vite build configuration
- `tsconfig.json` - TypeScript configuration

## Tech Stack
- **Frontend**: Vanilla TypeScript with Vite
- **AI**: Google GenAI (@google/genai) for generating UPSC-style questions
- **PDF Processing**: pdfjs-dist for extracting text from PDF files
- **Storage**: LocalStorage for tests and performance history

## Setup Requirements
This app requires a `GEMINI_API_KEY` secret to enable AI-powered test generation. Add it via the Secrets panel.

## Development
- Run `npm run dev` to start the development server on port 5000
- Run `npm run build` to create a production build in `dist/`

## Deployment
Configured for static deployment. The build outputs to the `dist` directory.

## Features
- Create tests from topics, files (PDF/TXT), or pasted text
- Bulk import questions in structured format
- Take timed practice tests with question palette
- View detailed results and analytics
- Backup/restore data functionality
