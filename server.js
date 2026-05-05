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

// ── Schemas ──────────────────────────────────────────────────────────────────

const ChatSchema = new mongoose.Schema({
  userId: String,
  awaitingOrderId: { type: Boolean, default: false },
  requestedHuman: { type: Boolean, default: false },
  messages: [
    {
      role: String,
      content: String,
      timestamp: { type: Date, default: Date.now },
    }
  ],
});

const OrderSchema = new mongoose.Schema({
  orderId:           { type: String, unique: true },
  item:              String,
  quantity:          Number,
  price:             String,
  status:            String,
  placedDate:        String,
  shippedDate:       String,
  estimatedDelivery: String,
  trackingNumber:    String,
  carrier:           String,
});

const UnansweredSchema = new mongoose.Schema({
  question: String,
  userId: String,
  timestamp: { type: Date, default: Date.now },
});

const Chat = mongoose.model("Chat", ChatSchema);
const Order = mongoose.model("Order", OrderSchema);
const Unanswered = mongoose.model("Unanswered", UnansweredSchema);

// ── Seed orders (always replace to keep data fresh) ───────────────────────────
async function seedOrders() {
  await Order.deleteMany({});
  await Order.insertMany([
    {
      orderId: "16452", item: "Wireless Headphones", quantity: 1, price: "₹2,499",
      status: "Shipped", placedDate: "28 Apr 2026", shippedDate: "30 Apr 2026",
      estimatedDelivery: "5 May 2026", trackingNumber: "FX9823741", carrier: "FedEx",
    },
    {
      orderId: "29831", item: "Running Shoes (Size 9)", quantity: 1, price: "₹3,199",
      status: "Out for Delivery", placedDate: "1 May 2026", shippedDate: "3 May 2026",
      estimatedDelivery: "5 May 2026", trackingNumber: "DL4472910", carrier: "Delhivery",
    },
    {
      orderId: "38820", item: "Laptop Stand + USB Hub", quantity: 1, price: "₹1,899",
      status: "Processing", placedDate: "4 May 2026", shippedDate: "—",
      estimatedDelivery: "9 May 2026", trackingNumber: "—", carrier: "—",
    },
    {
      orderId: "47193", item: "Phone Case (iPhone 15)", quantity: 2, price: "₹599",
      status: "Delivered", placedDate: "20 Apr 2026", shippedDate: "22 Apr 2026",
      estimatedDelivery: "26 Apr 2026", trackingNumber: "BL2291048", carrier: "BlueDart",
    },
    {
      orderId: "55310", item: "Mechanical Keyboard", quantity: 1, price: "₹4,799",
      status: "Shipped", placedDate: "2 May 2026", shippedDate: "4 May 2026",
      estimatedDelivery: "7 May 2026", trackingNumber: "EC7731820", carrier: "Ecom Express",
    },
    {
      orderId: "61847", item: "Yoga Mat + Resistance Bands", quantity: 1, price: "₹1,299",
      status: "Returned", placedDate: "15 Apr 2026", shippedDate: "17 Apr 2026",
      estimatedDelivery: "21 Apr 2026", trackingNumber: "SH0039271", carrier: "Shiprocket",
    },
  ]);
  console.log("Orders seeded.");
}
mongoose.connection.once("open", seedOrders);

// ── Sessions ──────────────────────────────────────────────────────────────────
const sessions = {};

// ── FAQ ───────────────────────────────────────────────────────────────────────
const faq = [
  { keywords: ["refund", "return"], answer: "Refunds are allowed within 7 days of purchase." },
  { keywords: ["delivery", "shipping"], answer: "Delivery takes 3–5 business days." },
  { keywords: ["cancel", "cancellation"], answer: "Orders cannot be cancelled once placed." },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function detectIntent(message) {
  const msg = message.toLowerCase();
  if (msg.includes("human") || msg.includes("agent") || msg.includes("real person") || msg.includes("speak to someone")) return "human_handoff";
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
      if (userMessage.includes(keyword)) score++;
    }
    if (score > maxScore) { maxScore = score; bestMatch = item; }
  }
  return maxScore > 0 ? bestMatch : null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Gemini chatbot server running!"));

app.post("/chat", async (req, res) => {
  const { message, userId } = req.body;
  const userMessage = message.toLowerCase();

  let chat = await Chat.findOne({ userId });
  if (!chat) chat = new Chat({ userId, messages: [] });

  chat.messages.push({ role: "user", content: userMessage });

  // Awaiting order ID
  if (chat.awaitingOrderId) {
    const orderId = userMessage.match(/\d+/)?.[0];
    if (orderId) {
      const order = await Order.findOne({ orderId });
      if (!order) {
        const reply = "Sorry, I couldn't find that order number. Please check and try again.";
        chat.awaitingOrderId = false;
        chat.messages.push({ role: "model", content: reply });
        await chat.save();
        return res.json({ reply });
      }
      const status = order.status.toLowerCase();
      let reply;
      if (status.includes("out for delivery")) {
        reply = `Great news! 🎉 Your order #${orderId} (${order.item}) is out for delivery and arriving ${order.estimatedDelivery}!`;
      } else if (status.includes("shipped")) {
        reply = `Your order #${orderId} (${order.item}) has been shipped via ${order.carrier} and is expected to arrive by ${order.estimatedDelivery}. 🚚`;
      } else if (status.includes("delivered")) {
        reply = `Your order #${orderId} (${order.item}) was delivered on ${order.estimatedDelivery}. ✅ Hope you're enjoying it!`;
      } else if (status.includes("processing")) {
        reply = `Your order #${orderId} (${order.item}) is currently being processed and will be shipped soon. Estimated arrival: ${order.estimatedDelivery}. 📦`;
      } else if (status.includes("returned")) {
        reply = `Your order #${orderId} (${order.item}) has been returned and is being processed by our team. 🔄`;
      } else {
        reply = `Your order #${orderId} (${order.item}) status: ${order.status}. Expected arrival: ${order.estimatedDelivery}.`;
      }

      chat.awaitingOrderId = false;
      chat.messages.push({ role: "model", content: reply });
      await chat.save();
      return res.json({
        reply,
        orderCard: {
          orderId,
          item:              order.item,
          quantity:          order.quantity,
          price:             order.price,
          status:            order.status,
          placedDate:        order.placedDate,
          shippedDate:       order.shippedDate,
          estimatedDelivery: order.estimatedDelivery,
          trackingNumber:    order.trackingNumber,
          carrier:           order.carrier,
        }
      });
    }
    chat.awaitingOrderId = false;
  }

  // Intent detection
  const intent = detectIntent(userMessage);

  if (intent === "human_handoff") {
    const reply = "I've notified our support team. A human agent will reach out to you shortly. 🙋";
    chat.requestedHuman = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply, humanHandoff: true });
  }

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

  // FAQ match
  const match = findBestMatch(userMessage, faq);
  if (match) {
    chat.messages.push({ role: "model", content: match.answer });
    await chat.save();
    return res.json({ reply: match.answer });
  }

  // Gemini fallback — log as unanswered
  await Unanswered.create({ question: userMessage, userId });

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
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
        }]
      }
    );

    const reply = response.data.candidates[0].content.parts[0].text;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    res.json({ reply });

  } catch (error) {
    console.error("FULL ERROR:", error.response?.data || error.message);
    return res.json({ reply: "Server is busy right now. Please try again in a moment 🙏" });
  }
});

app.post("/reset", async (req, res) => {
  const { userId } = req.body;
  await Chat.updateOne(
    { userId },
    { $set: { awaitingOrderId: false, requestedHuman: false, messages: [] } },
    { upsert: true }
  );
  res.sendStatus(200);
});

// ── Admin routes ──────────────────────────────────────────────────────────────

app.get("/admin/chats", async (req, res) => {
  try {
    const chats = await Chat.find().sort({ _id: -1 });
    res.json(chats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

app.delete("/admin/chats/:id", async (req, res) => {
  try {
    await Chat.findByIdAndDelete(req.params.id);
    res.send("Deleted");
  } catch (err) {
    res.status(500).send("Error deleting");
  }
});

app.get("/admin/unanswered", async (req, res) => {
  try {
    const questions = await Unanswered.find().sort({ _id: -1 }).limit(100);
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch unanswered questions" });
  }
});

app.get("/admin/export", async (req, res) => {
  try {
    const chats = await Chat.find().sort({ _id: -1 });
    const rows = ["userId,role,content,timestamp"];
    chats.forEach(chat => {
      chat.messages.forEach(msg => {
        const content = msg.content.replace(/"/g, '""');
        rows.push(`"${chat.userId}","${msg.role}","${content}","${msg.timestamp || ""}"`);
      });
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=chats.csv");
    res.send(rows.join("\n"));
  } catch (error) {
    res.status(500).send("Export failed");
  }
});

// Start server
app.listen(3000, () => console.log("Server running on port 3000"));
