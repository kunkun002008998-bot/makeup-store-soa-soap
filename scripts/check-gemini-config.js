
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
const envPath = path.join(projectDir, '.env');

console.log('\n========== GEMINI CONFIG CHECK ==========');
console.log('Project directory:', projectDir);
console.log('.env file:', envPath);

if (!fs.existsSync(envPath)) {
    console.error('ERROR: Missing .env file');
    process.exit(1);
}

console.log('.env file: FOUND');

const apiKey = (process.env.GEMINI_API_KEY || '').trim();
const model = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();

if (!apiKey) {
    console.error('GEMINI_API_KEY: MISSING');
    process.exit(1);
}

if (!/^AIza[0-9A-Za-z_-]+$/.test(apiKey)) {
    console.error('GEMINI_API_KEY: INVALID FORMAT');
    process.exit(1);
}

if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    console.error('GEMINI_MODEL: INVALID FORMAT');
    process.exit(1);
}

console.log('GEMINI_API_KEY: FOUND (hidden)');
console.log('GEMINI_MODEL:', model);
console.log('API endpoint: Gemini GenerateContent');
console.log('========================================\n');
