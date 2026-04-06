const { GoogleGenerativeAI } = require("@google/generative-ai");

export default async function handler(req, res) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    const { markets } = req.body;
    const prompt = `Context: Binary Options Trading. Analyze these markets (last 100 ticks each). 
    Provide a brief signal (BUY/SELL/NEUTRAL) and a prediction for: 
    Rise/Fall, Even/Odd, and Over/Under. Data: ${JSON.stringify(markets)}`;

    const result = await model.generateContent(prompt);
    res.status(200).json({ analysis: result.response.text().replace(/\n/g, '<br>') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
