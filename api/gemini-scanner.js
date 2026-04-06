const { GoogleGenerativeAI } = require("@google/generative-ai");

export default async function handler(req, res) {
  // We are now using the NEW name here to force a refresh
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY_SCANNER);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { maxOutputTokens: 500 }
  });

  try {
    const { markets } = req.body;
    const prompt = `Analyze these markets: ${JSON.stringify(markets)}. Give a clear BUY/SELL signal.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (!text) throw new Error("AI returned empty content");

    res.status(200).json({ message: text });

  } catch (error) {
    console.error("Scanner Error:", error);
    // If it still says invalid, this will tell us exactly what name it's missing
    res.status(500).json({ message: "AI Error: " + error.message });
  }
}
