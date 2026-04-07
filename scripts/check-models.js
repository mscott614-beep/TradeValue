const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    console.log("Available Models:");
    data.models.forEach(m => console.log(`- ${m.name}`));
    
    // Specifically check for 3.1
    const has31 = data.models.some(m => m.name.includes("3.1"));
    console.log(`\nHas Gemini 3.1: ${has31}`);
  } catch (error) {
    console.error("Error fetching models:", error.message);
  }
}

listModels();
