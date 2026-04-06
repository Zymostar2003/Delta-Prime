const { GoogleGenerativeAI } = require("@google/generative-ai");

export default async function handler(req, res) {
  // 1. Initialize the AI with your Environment Variable
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    const { markets } = req.body;

    // 2. Craft the prompt for the Market Scanner
    const prompt = `Context: Binary Options Trading. 
    Analyze these markets (last 100 ticks each). 
    Provide a brief signal (BUY/SELL/NEUTRAL) and a prediction for: 
    Rise/Fall, Even/Odd, and Over/Under. 
    Data: ${JSON.stringify(markets)}`;

    // 3. Get the response from Gemini
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 4. Send the successful analysis back to your website
    res.status(200).json({ 
      analysis: text.replace(/\n/g, '<br>') 
    });

  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ 
      error: "AI Connection Failed. Please check your API Key in Vercel Settings.",
      details: error.message 
    });
  }
}
