const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
  const genAI = new GoogleGenerativeAI("AIzaSyDID3Obctz23xrI56grM_kvDeuoElkfg7A");
  const models = await genAI.listModels();
  console.log(JSON.stringify(models, null, 2));
}

listModels().catch(console.error);
