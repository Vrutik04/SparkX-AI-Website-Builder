import OpenAI from 'openai';

const apiKey = process.env.AI_API_KEY;
let baseURL = "https://openrouter.ai/api/v1";

if (apiKey?.startsWith('gsk_')) {
  baseURL = "https://api.groq.com/openai/v1";
}

const openai = new OpenAI({
  baseURL,
  apiKey,
});

export const AI_MODEL = apiKey?.startsWith('gsk_') 
  ? 'llama-3.3-70b-versatile' // Live high-performance Groq model
  : 'kwaipilot/kat-coder-pro:free';

export default openai