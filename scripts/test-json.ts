import { config } from 'dotenv';
config({path: '.env.local'});
config({path: '.env'});

async function run() {
  const { generateWithFallback, PRIMARY_MODEL } = await import('../src/ai/genkit.ts');
  
  const prompt = `
                Analyze this trading card's market position:
                Card: 2015-16 Upper Deck Connor McDavid #1
                
                Market Context:
                - User's Internal Value: $100
                - Live Active Listings: 2
                - Live Sold Comps (Last 30 Days): 2
                - Current Market Floor: $150.00
                
                Generate a grounded summary of whether the user's value is accurate compared to live data.
                
                Output ONLY the raw JSON object. Do not include markdown code blocks or the schema description.
                Return a JSON object with these keys:
                - marketFloor (number)
                - recentVelocity (string, e.g. 'High', 'Low')
                - investmentGrade (string: 'Strong Buy', 'Buy', 'Neutral', 'Hold', 'Sell', 'Strong Sell')
                - analysis (string: Detailed market analysis in Markdown)
            `;

  for (let i = 0; i < 3; i++) {
    const response = await generateWithFallback({
        model: PRIMARY_MODEL,
        prompt: prompt,
    });
    
    let rawOutput = response.output || response.text;
    console.log(`Run ${i}:`);
    if (typeof rawOutput === 'string') {
        console.log("Returned string");
        try {
            const firstBrace = rawOutput.indexOf('{');
            const lastBrace = rawOutput.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                rawOutput = JSON.parse(rawOutput.substring(firstBrace, lastBrace + 1));
                console.log("Parsed keys:", Object.keys(rawOutput));
            } else {
                console.log("Could not find braces");
            }
        } catch (e) {
            console.log("Failed to parse");
        }
    } else {
        console.log("Returned object directly. Keys:", Object.keys(rawOutput));
    }
  }
}
run();
