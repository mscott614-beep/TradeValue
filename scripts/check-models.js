const { genkit } = require('genkit');
const { googleAI } = require('@genkit-ai/google-genai');
const dotenv = require('dotenv');
dotenv.config();

async function checkModel() {
    const ai = genkit({
        plugins: [googleAI({ apiKey: process.env.GEMINI_API_KEY })],
    });

    try {
        console.log("Checking gemini-2.5-flash...");
        const response = await ai.generate({
            model: 'googleai/gemini-2.5-flash',
            prompt: 'Hi, are you there? Respond with "Yes" if you are Gemini 2.5.'
        });
        console.log("Response:", response.text);
    } catch (error) {
        console.error("Error with gemini-2.5-flash:", error.message);
        
        console.log("\nTrying gemini-1.5-flash (without -latest)...");
        try {
            const response = await ai.generate({
                model: 'googleai/gemini-1.5-flash',
                prompt: 'Hi'
            });
            console.log("Success with gemini-1.5-flash!");
        } catch (e2) {
            console.error("Error with gemini-1.5-flash:", e2.message);
        }
    }
}

checkModel();
