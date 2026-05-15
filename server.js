require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
const path = require("path");

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("Mongo error:", err));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
}));

function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.redirect("/login");
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const ChatSchema = new mongoose.Schema({
  userId: String,
  awaitingOrderId:       { type: Boolean, default: false },
  awaitingDamageOrderId: { type: Boolean, default: false },
  requestedHuman:        { type: Boolean, default: false },
  messages: [{
    role: String,
    content: String,
    timestamp: { type: Date, default: Date.now },
  }],
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
  question:  String,
  userId:    String,
  timestamp: { type: Date, default: Date.now },
});

const Chat        = mongoose.model("Chat",        ChatSchema);
const Order       = mongoose.model("Order",       OrderSchema);
const Unanswered  = mongoose.model("Unanswered",  UnansweredSchema);

// ── Seed orders ───────────────────────────────────────────────────────────────
async function seedOrders() {
  await Order.deleteMany({});
  await Order.insertMany([
    { orderId: "16452", item: "Wireless Headphones",       quantity: 1, price: "₹2,499", status: "Shipped",           placedDate: "28 Apr 2026", shippedDate: "30 Apr 2026", estimatedDelivery: "5 May 2026",  trackingNumber: "FX9823741", carrier: "FedEx"         },
    { orderId: "29831", item: "Running Shoes (Size 9)",    quantity: 1, price: "₹3,199", status: "Out for Delivery",   placedDate: "1 May 2026",  shippedDate: "3 May 2026",  estimatedDelivery: "6 May 2026",  trackingNumber: "DL4472910", carrier: "Delhivery"     },
    { orderId: "38820", item: "Laptop Stand + USB Hub",    quantity: 1, price: "₹1,899", status: "Processing",         placedDate: "4 May 2026",  shippedDate: "—",           estimatedDelivery: "9 May 2026",  trackingNumber: "—",         carrier: "—"             },
    { orderId: "47193", item: "Phone Case (iPhone 15)",    quantity: 2, price: "₹599",   status: "Delivered",          placedDate: "20 Apr 2026", shippedDate: "22 Apr 2026", estimatedDelivery: "26 Apr 2026", trackingNumber: "BL2291048", carrier: "BlueDart"      },
    { orderId: "55310", item: "Mechanical Keyboard",       quantity: 1, price: "₹4,799", status: "Shipped",            placedDate: "2 May 2026",  shippedDate: "4 May 2026",  estimatedDelivery: "7 May 2026",  trackingNumber: "EC7731820", carrier: "Ecom Express"  },
    { orderId: "61847", item: "Yoga Mat + Resistance Bands", quantity: 1, price: "₹1,299", status: "Returned",         placedDate: "15 Apr 2026", shippedDate: "17 Apr 2026", estimatedDelivery: "21 Apr 2026", trackingNumber: "SH0039271", carrier: "Shiprocket"    },
  ]);
  console.log("Orders seeded.");
}
mongoose.connection.once("open", seedOrders);

// ── FAQ ───────────────────────────────────────────────────────────────────────
const faq = [
  { keywords: ["refund", "return"], answer: "Refunds are allowed within 7 days of purchase." },
  { keywords: ["delivery", "shipping"], answer: "Delivery takes 3–5 business days." },
  { keywords: ["cancel", "cancellation"], answer: "Orders cannot be cancelled once placed." },
];

// ── Intent detection ──────────────────────────────────────────────────────────
function detectIntent(msg) {
  const m = msg.toLowerCase();
  if (m.includes("human") || m.includes("agent") || m.includes("real person") || m.includes("speak to someone")) return "human_handoff";
  if (m.includes("broken") || m.includes("damaged") || m.includes("defective") || m.includes("wrong item") || m.includes("not working") || m.includes("faulty") || m.includes("cracked") || m.includes("missing item")) return "damaged_product";
  if (m.includes("late") || m.includes("overdue") || m.includes("not arrived") || m.includes("been waiting") || m.includes("expected delivery") || m.includes("still not received") || m.includes("delayed")) return "late_delivery";
  if (m.includes("exchange") || m.includes("wrong size") || m.includes("different size") || m.includes("wrong colour") || m.includes("wrong color") || m.includes("swap")) return "exchange";
  if (m.includes("payment failed") || m.includes("charged twice") || m.includes("double charge") || m.includes("transaction failed") || m.includes("not charged") || m.includes("payment issue")) return "payment_issue";
  if (m.includes("coupon") || m.includes("promo") || m.includes("discount code") || m.includes("voucher") || m.includes("promo code")) return "coupon_issue";
  if (m.includes("invoice") || m.includes("receipt") || m.includes("gst") || m.includes("tax bill")) return "invoice";
  if (m.includes("warranty") || m.includes("guarantee") || m.includes("manufacturing defect")) return "warranty";
  if (m.includes("track")) return "track_order";
  if (m.includes("delivery") || m.includes("shipping")) return "delivery_info";
  if (m.includes("cancel") || m.includes("cancellation")) return "cancel_order";
  return "general";
}

function findBestMatch(msg, faq) {
  let best = null, max = 0;
  for (const item of faq) {
    const score = item.keywords.filter(k => msg.includes(k)).length;
    if (score > max) { max = score; best = item; }
  }
  return max > 0 ? best : null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Gemini chatbot server running!"));

// Chat history for page reload
app.get("/chat-history", async (req, res) => {
  const { userId } = req.query;
  const chat = await Chat.findOne({ userId });
  res.json({ messages: chat ? chat.messages : [] });
});

app.post("/chat", async (req, res) => {
  const { message, userId } = req.body;
  const userMessage = message.toLowerCase();

  let chat = await Chat.findOne({ userId });
  if (!chat) chat = new Chat({ userId, messages: [] });

  chat.messages.push({ role: "user", content: userMessage });

  // ── Awaiting damage order ID ──────────────────────────────────────────────
  if (chat.awaitingDamageOrderId) {
    const orderId = userMessage.match(/\d+/)?.[0];
    if (orderId) {
      const order = await Order.findOne({ orderId });
      const reply = order
        ? `Damage report filed for Order #${orderId} (${order.item}). 📋 Our team will review the photos and contact you within **24 hours** with a resolution. Thank you for your patience! 🙏`
        : `We've logged your damage report. We couldn't find order #${orderId} in our system — please double-check the ID or contact our support team directly.`;
      chat.awaitingDamageOrderId = false;
      chat.messages.push({ role: "model", content: reply });
      await chat.save();
      return res.json({ reply });
    }
    // Not a number — remind and wait
    const reply = "Please share your **order ID** (e.g. 16452) so we can file the damage report. 📋";
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  // ── Awaiting track order ID ───────────────────────────────────────────────
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
      const s = order.status.toLowerCase();
      let reply;
      if (s.includes("out for delivery")) reply = `Great news! 🎉 Your order #${orderId} (${order.item}) is **out for delivery** and arriving ${order.estimatedDelivery}!`;
      else if (s.includes("shipped"))     reply = `Your order #${orderId} (${order.item}) has been **shipped** via ${order.carrier} and is expected to arrive by **${order.estimatedDelivery}**. 🚚`;
      else if (s.includes("delivered"))   reply = `Your order #${orderId} (${order.item}) was **delivered** on ${order.estimatedDelivery}. ✅ Hope you're enjoying it!`;
      else if (s.includes("processing"))  reply = `Your order #${orderId} (${order.item}) is currently being **processed** and will ship soon. Estimated arrival: **${order.estimatedDelivery}**. 📦`;
      else if (s.includes("returned"))    reply = `Your order #${orderId} (${order.item}) has been **returned** and is being processed by our team. 🔄`;
      else reply = `Your order #${orderId} (${order.item}) status: **${order.status}**. Expected arrival: ${order.estimatedDelivery}.`;
      chat.awaitingOrderId = false;
      chat.messages.push({ role: "model", content: reply });
      await chat.save();
      return res.json({ reply });
    }
    chat.awaitingOrderId = false;
  }

  // ── Intent detection ──────────────────────────────────────────────────────
  const intent = detectIntent(userMessage);

  if (intent === "human_handoff") {
    const reply = "I've notified our support team. A human agent will reach out to you shortly. 🙋";
    chat.requestedHuman = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply, humanHandoff: true });
  }

  if (intent === "damaged_product") {
    const reply = `We're really sorry to hear that! 😔 Here's what to do:\n\n1. Take clear photos of the damaged/incorrect item\n2. Share your order ID with us below\n3. Tell us whether you'd prefer a **replacement** or a **full refund**\n\nPlease go ahead and share your order ID to get started.`;
    chat.awaitingDamageOrderId = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "late_delivery") {
    const reply = `We're sorry your order hasn't arrived yet! 😟 Deliveries can occasionally be delayed due to logistics or local conditions.\n\nPlease share your **order ID** and we'll track it down right away. If needed, we can escalate to our delivery partner.`;
    chat.awaitingOrderId = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "exchange") {
    const reply = `We offer **exchanges within 7 days** of delivery for size or colour issues. Here's how:\n\n1. Share your **order ID** and photos of the item\n2. Let us know what you'd like instead (size/colour)\n3. We'll arrange a pickup and send the replacement\n\nWould you like to proceed?`;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "payment_issue") {
    const reply = `We're sorry about the payment issue! 😟 Here's what to know:\n\n- If your payment **failed**, you won't be charged — the amount will be reversed within **3–5 business days**\n- If you were **charged twice**, please share your order ID and we'll resolve it within **24 hours**\n\nPlease share your order ID to proceed.`;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "coupon_issue") {
    const reply = `Coupon not working? Here are the most common reasons:\n\n- ❌ Coupon has **expired**\n- ❌ Minimum cart value **not met**\n- ❌ Coupon already **used once**\n- ❌ Not applicable on **sale items**\n- ❌ **Case-sensitive** — try typing it exactly\n\nIf none of these apply, our agent can check it manually. Want me to connect you?`;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "invoice") {
    const reply = `Your invoice is **automatically emailed** after delivery. 📧\n\nYou can also download it from your account's order history page.\n\nIf you haven't received it, please share your **order ID** and we'll resend it right away.`;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "warranty") {
    const reply = `Most products come with a **6-month manufacturer warranty** against defects. 🛡️\n\nFor warranty claims:\n1. Share your **order ID** and photos/video of the defect\n2. We'll arrange a **repair or replacement** at no cost\n\nNote: Warranty does not cover physical damage or misuse.`;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "track_order") {
    const reply = "Please enter your order ID to track your order.";
    chat.awaitingOrderId = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "delivery_info") {
    const reply = "Delivery usually takes **3–5 business days**. 🚚";
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "cancel_order") {
    const reply = "Orders **cannot be cancelled** once placed. If you'd like a refund, please reach out within 7 days of delivery.";
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

  // Gemini fallback
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
- Be empathetic when the customer has a problem
- Use **bold** for key terms
- Use this info:
  - Delivery: 3–5 business days
  - Cancellations: not allowed once placed
  - Refunds: within 7 days of delivery
  - Damaged/defective/wrong items: ask for photos + order ID, offer replacement or refund within 24–48 hours
  - Exchanges: within 7 days, for size or colour issues
  - Payments: failed payments are reversed in 3–5 business days
  - Warranty: 6-month manufacturer warranty on most products
  - Invoice: auto-emailed after delivery, available in order history

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
    { $set: { awaitingOrderId: false, awaitingDamageOrderId: false, requestedHuman: false, messages: [] } },
    { upsert: true }
  );
  res.sendStatus(200);
});

// ── Auth routes ───────────────────────────────────────────────────────────────

app.get("/login", (req, res) => {
  if (req.session.admin) return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  res.redirect("/login?error=1");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/admin", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// ── Admin routes ──────────────────────────────────────────────────────────────

app.get("/admin/chats", requireAuth, async (req, res) => {
  try {
    const chats = await Chat.find().sort({ _id: -1 });
    res.json(chats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

app.delete("/admin/chats/:id", requireAuth, async (req, res) => {
  try {
    await Chat.findByIdAndDelete(req.params.id);
    res.send("Deleted");
  } catch (err) {
    res.status(500).send("Error deleting");
  }
});

app.get("/admin/unanswered", requireAuth, async (req, res) => {
  try {
    const questions = await Unanswered.find().sort({ _id: -1 }).limit(100);
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch unanswered questions" });
  }
});

app.get("/admin/export", requireAuth, async (req, res) => {
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

app.listen(3000, () => console.log("Server running on port 3000"));
