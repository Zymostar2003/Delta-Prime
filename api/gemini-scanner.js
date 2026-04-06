const { GoogleGenerativeAI } = require("@google/generative-ai");

export default async function handler(req, res) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // Use gemini-1.5-flash for the fastest response
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { maxOutputTokens: 500 }
  });

  try {
    const { markets } = req.body;
    
    // Simplified prompt to ensure the AI doesn't get confused
    const prompt = `Analyze these trading markets: ${JSON.stringify(markets)}. 
    Give a clear BUY/SELL/NEUTRAL signal for each. Keep it brief.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (!text) {
      throw new Error("AI returned empty content");
    }

    res.status(200).json({ message: text });

  } catch (error) {
    console.error("Scanner Error:", error);
    res.status(500).json({ message: "AI Error: " + error.message });
  }
}

