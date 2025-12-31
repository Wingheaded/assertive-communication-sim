
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Manual .env parsing
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(envPath)) {
    console.log('Loading .env from:', envPath);
    const envContent = fs.readFileSync(envPath, 'utf-8');

    envContent.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;

        const idx = line.indexOf('=');
        if (idx > 0) {
            const key = line.substring(0, idx).trim();
            const value = line.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
            console.log(`Found key: ${key}`);
            if (key === 'GEMINI_API_KEY' || key === 'OPENAI_API_KEY') {
                process.env[key] = value;
            }
        }
    });
} else {
    console.log('.env file not found at:', envPath);
}

const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

if (!apiKey) {
    console.error('Error: No API key found in .env (Checked GEMINI_API_KEY and OPENAI_API_KEY)');
    process.exit(1);
}

console.log('API Key found (length):', apiKey.length);

async function listModels() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            console.error('API Error:', JSON.stringify(data, null, 2));
            return;
        }

        console.log('Available Models (filtered):');
        const models = data.models.map(m => m.name);

        if (models.includes('models/gemini-1.5-flash')) {
            console.log('MATCH: models/gemini-1.5-flash IS available.');
        } else {
            console.log('MISSING: models/gemini-1.5-flash is NOT available.');
        }

        console.log('Alternatives:');
        models.forEach(name => {
            if (name.includes('flash') || name.includes('pro')) {
                console.log(`- ${name}`);
            }
        });

    } catch (e) {
        console.error('Fetch error:', e);
    }
}

listModels();
