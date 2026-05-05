require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("Mongo error:", err));

const app = express();

app.use(cors());
app.use(express.json());

const ChatSchema = new mongoose.Schema({
  userId: String,
  awaitingOrderId: { type: Boolean, default: false },
  messages: [
    {
      role: String,
      content: String,
      timestamp: { type: Date, default: Date.now },
    }
  ],
});

const Chat = mongoose.model("Chat", ChatSchema);

const sessions = {};

const orders = {
  "16452": {
    deliveryDate: "in 2 days",
    status: "Shipped",
  },
};

const faq = [
  { keywords: ["refund", "return"], answer: "Refunds are allowed within 7 days of purchase." },
  { keywords: ["delivery", "shipping"], answer: "Delivery takes 3–5 business days." },
  { keywords: ["cancel", "cancellation"], answer: "Orders cannot be cancelled once placed." },
];

function detectIntent(message) {
  const msg = message.toLowerCase();
  if (msg.includes("track")) return "track_order";
  if (msg.includes("delivery") || msg.includes("shipping")) return "delivery_info";
  if (msg.includes("cancel") || msg.includes("cancellation")) return "cancel_order";
  return "general";
}

function findBestMatch(userMessage, faq) {
  let bestMatch = null;
  let maxScore = 0;

  for (let item of faq) {
    let score = 0;

    for (let keyword of item.keywords) {
      if (userMessage.includes(keyword)) {
        score++;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestMatch = item;
    }
  }

  return maxScore > 0 ? bestMatch : null;
}

app.get("/", (req, res) => {
  res.send("Gemini chatbot server running!");
});

app.post("/chat", async (req, res) => {
  const { message, userId } = req.body;
  const userMessage = message.toLowerCase();

  // 1. Create/find chat
  let chat = await Chat.findOne({ userId });
  if (!chat) {
    chat = new Chat({ userId, messages: [] });
  }

  // 2. Add user message
  chat.messages.push({ role: "user", content: userMessage });

  // 3. If awaiting order ID → look it up
  if (chat.awaitingOrderId) {
    const orderId = userMessage.match(/\d+/)?.[0];
    let reply;

    if (orderId && orders[orderId]) {
      reply = `Order ${orderId} is ${orders[orderId].status} and will arrive ${orders[orderId].deliveryDate}.`;
    } else if (orderId) {
      reply = "Sorry, I couldn't find that order number.";
    } else {
      reply = "Please enter a valid order number.";
    }

    chat.awaitingOrderId = false;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  // 4. Intent detection
  const intent = detectIntent(userMessage);

  if (intent === "track_order") {
    const reply = "Please enter your order ID to track your order.";
    chat.awaitingOrderId = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "delivery_info") {
    const reply = "Delivery usually takes 3–5 business days.";
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "cancel_order") {
    const reply = "Orders cannot be cancelled once placed.";
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  // 5. FAQ keyword match
  const match = findBestMatch(userMessage, faq);
  if (match) {
    chat.messages.push({ role: "model", content: match.answer });
    await chat.save();
    return res.json({ reply: match.answer });
  }

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: `
You are a customer support assistant for an online store.

Rules:
- Always give short, direct answers (1–2 lines max)
- Do NOT give long explanations
- Do NOT ask multiple questions
- Never say "it depends"
- Use this info:
  - Delivery takes 3–5 days
  - Orders cannot be cancelled
  - Refunds within 7 days

Conversation:
${chat.messages.map(m => `${m.role}: ${m.content}`).join("\n")}

User: ${userMessage}
` }]
          }
        ]
      }
    );

    const reply = response.data.candidates[0].content.parts[0].text;

    // 3. Save after reply
    chat.messages.push({ role: "model", content: reply });
    console.log("Saving to DB...");
    await chat.save();

    res.json({ reply });

  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message || "Unknown error";
    console.error("FULL ERROR:", errMsg);
    res.json({ reply: `Error: ${errMsg}` }); // frontend reads this to show friendly messages
  }
});

app.post("/reset", async (req, res) => {
  const { userId } = req.body;
  await Chat.updateOne(
    { userId },
    { $set: { awaitingOrderId: false, messages: [] } },
    { upsert: true }
  );
  res.sendStatus(200);
});

app.delete("/admin/chats/:id", async (req, res) => {
  try {
    await Chat.findByIdAndDelete(req.params.id);
    res.send("Deleted");
  } catch (err) {
    res.status(500).send("Error deleting");
  }
});

app.get("/admin/chats", async (req, res) => {
  try {
    const chats = await Chat.find().sort({ _id: -1 });
    res.json(chats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// Start server
app.listen(3000, () => {
  console.log("Server running on port 3000");
});