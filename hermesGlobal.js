const { spawn } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.local') });

// Set environment variable for service account
const keyPath = path.join(__dirname, 'service-account.json');
if (!fs.existsSync(keyPath)) {
    console.error(`[HermesGlobal] ERROR: Service account file not found at ${keyPath}`);
    process.exit(1);
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

// Optional Resend for email alerts
const RESEND_API_KEY = process.env.RESEND_API_KEY;

console.log("[HermesGlobal] Starting Local Global Batch Sync via Python worker...");
const startTime = Date.now();

const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
const scriptPath = path.join(__dirname, 'local_global_batch.py');

const pythonProcess = spawn(pythonPath, [scriptPath], {
    env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        GOOGLE_CLOUD_PROJECT: 'puckvaluebak-38609945-5e85c',
        GOOGLE_CLOUD_LOCATION: 'global'
    }
});

let outputLog = "";

pythonProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
    outputLog += chunk;
    console.log(`[Python Output] ${chunk.trim()}`);
});

pythonProcess.stderr.on('data', (data) => {
    const chunk = data.toString();
    outputLog += chunk;
    console.error(`[Python Error] ${chunk.trim()}`);
});

pythonProcess.on('close', async (code) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[HermesGlobal] Local Global Batch Sync process exited with code ${code} after ${duration}s.`);
    
    // Optional: send an email via Resend if it's configured
    if (RESEND_API_KEY) {
        try {
            const axios = require('axios');
            const today = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/New_York",
            }).format(new Date());

            await axios.post(
                "https://api.resend.com/emails",
                {
                    from: "TradeValue Hermes <onboarding@resend.dev>",
                    to: "mscott614@gmail.com",
                    subject: `🌍 Global Batch Sync Complete — ${today}`,
                    html: `
                        <h2>🌍 Hermes Global Batch Sync Complete</h2>
                        <p><strong>Duration:</strong> ${duration} seconds</p>
                        <p><strong>Exit Code:</strong> ${code}</p>
                        <hr/>
                        <pre style="background:#f4f4f4; padding:10px; border-radius:5px; max-height: 400px; overflow-y: auto; font-size:11px;">
${outputLog}
                        </pre>
                    `
                },
                { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }
            );
            console.log("[HermesGlobal] Email alert sent successfully.");
        } catch (err) {
            console.error("[HermesGlobal] Failed to send Resend email:", err.message);
        }
    }
});
