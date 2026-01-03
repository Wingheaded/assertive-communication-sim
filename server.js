/**
 * server.js - Express server for cPanel Node.js deployment
 * 
 * This file replaces Vercel's serverless function magic.
 * It serves static files from /public and handles the /api/evaluate route.
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Import the evaluate handler
import evaluateHandler from './api/evaluate.js';

// ESM workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// API route: POST /api/evaluate
app.post('/api/evaluate', async (req, res) => {
    try {
        await evaluateHandler(req, res);
    } catch (error) {
        console.error('[Server] Error in /api/evaluate:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Fallback: serve index.html for all other routes (SPA-style)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
    console.log(`🔗 API endpoint: POST /api/evaluate`);
});
