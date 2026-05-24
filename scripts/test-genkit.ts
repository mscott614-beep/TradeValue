import { config } from 'dotenv';
config({path: '.env.local'});
config({path: '.env'});

async function run() {
  const { generateWithFallback, PRIMARY_MODEL } = await import('../src/ai/genkit.ts');
  try {
    const prompt = `You are the "Shadow" Market Intelligence Engine v2. 
    Output exactly the string "Hello world!" and nothing else.`;
    const response = await generateWithFallback({
        model: PRIMARY_MODEL,
        prompt: prompt,
    });
    console.log("Success! Response text:", response.text);
    console.log("Response output:", response.output);
  } catch(e: any) {
    console.error("Error thrown by generateWithFallback or response.output:");
    console.error(e.message);
    if (e.stack) console.error(e.stack);
  }
}
run();
