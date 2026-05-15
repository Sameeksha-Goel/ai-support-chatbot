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

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

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
    const reply = pick([
      "I've notified our support team. A human agent will reach out to you shortly. 🙋",
      "Got it — I've flagged this for a real agent. Someone will be with you shortly. 🙋",
      "On it! I've alerted our team and someone will follow up with you soon. 🙋",
    ]);
    chat.requestedHuman = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply, humanHandoff: true });
  }

  if (intent === "damaged_product") {
    const reply = pick([
      `We're really sorry to hear that! 😔 Here's what to do:\n\n1. Take clear photos of the damaged item\n2. Share your **order ID** below\n3. Let us know if you'd prefer a **replacement** or a **full refund**\n\nStart by sharing your order ID.`,
      `Oh no, that's not okay at all! 😟 Let's get this sorted:\n\n1. Grab clear photos of the item\n2. Drop your **order ID** below\n3. Tell us — **replacement** or **refund**?\n\nWhat's your order ID?`,
      `So sorry about this! 😔 Here's how we'll fix it:\n\n1. Take photos of the damaged item\n2. Share your **order ID** below\n3. Choose a **replacement** or a **full refund**\n\nGo ahead and share your order ID to get started.`,
    ]);
    chat.awaitingDamageOrderId = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "late_delivery") {
    const reply = pick([
      `We're sorry your order hasn't arrived yet! 😟 Delays can happen due to logistics or local conditions — but let's find out exactly where it is.\n\nPlease share your **order ID** and I'll track it down right away.`,
      `That's frustrating, and we're sorry for the wait! 😟 Let me look into this for you.\n\nCould you share your **order ID**?`,
      `Apologies for the delay — that's not the experience we want for you! 😔 Share your **order ID** and I'll check exactly where your order is right now.`,
    ]);
    chat.awaitingOrderId = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "exchange") {
    const reply = pick([
      `We offer **exchanges within 7 days** of delivery for size or colour issues. Here's how:\n\n1. Share your **order ID** and photos of the item\n2. Let us know what you'd like instead\n3. We'll arrange a pickup and send the replacement\n\nWould you like to proceed?`,
      `No problem — exchanges are available **within 7 days** of delivery for size or colour issues! 🔄\n\nJust share your **order ID** and photos, and tell us what you need instead. We'll handle the rest. Shall we start?`,
      `Totally understandable! You can exchange **within 7 days** of delivery for a different size or colour.\n\n1. Share your **order ID** and a photo\n2. Tell us what you'd like instead\n3. We'll arrange the swap\n\nWant to go ahead?`,
    ]);
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "payment_issue") {
    const reply = pick([
      `We're sorry about the payment issue! 😟\n\n- **Failed payment?** You won't be charged — it reverses within **3–5 business days**\n- **Charged twice?** Share your order ID and we'll resolve it within **24 hours**\n\nWhat happened in your case?`,
      `Payment issues are stressful — let's sort this out! 💳\n\n- A **failed payment** won't charge you; the hold clears in **3–5 business days**\n- A **double charge** gets fixed within **24 hours** once you share your order ID\n\nPlease share your order ID to proceed.`,
      `Sorry about that! Here's what to expect:\n\n- **Failed payment** → you won't be charged, reversed in **3–5 business days**\n- **Charged twice** → resolved within **24 hours** — just share your **order ID**\n\nWhat's your situation?`,
    ]);
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "coupon_issue") {
    const reply = pick([
      `Coupon not working? Here are the most common reasons:\n\n- ❌ Coupon has **expired**\n- ❌ Minimum cart value **not met**\n- ❌ Coupon already **used once**\n- ❌ Not valid on **sale items**\n- ❌ **Case-sensitive** — try typing it exactly as received\n\nIf none of these apply, our agent can check it manually. Want me to connect you?`,
      `Hmm, a few things can cause coupon issues:\n\n- ❌ **Expired** code\n- ❌ Cart doesn't meet the **minimum value**\n- ❌ It's a **one-time use** code\n- ❌ Not applicable to **sale items**\n- ❌ Try entering it **exactly** as shown — it's case-sensitive\n\nStill not working? I can loop in an agent to check it.`,
      `Let's figure this out! Common culprits:\n\n- ❌ Code may have **expired**\n- ❌ **Minimum cart value** not reached\n- ❌ Already **used once**\n- ❌ Doesn't apply to items on **sale**\n- ❌ Check the **exact spelling** — coupons are case-sensitive\n\nNone of those? Let me know and we'll look into it manually.`,
    ]);
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "invoice") {
    const reply = pick([
      `Your invoice is **automatically emailed** after delivery. 📧\n\nYou can also download it from your account's order history page.\n\nHaven't received it? Share your **order ID** and we'll resend it right away.`,
      `Invoices are sent automatically once your order is delivered — check your inbox (and spam, just in case). 📧\n\nIf it's not there, drop your **order ID** and I'll get it resent.`,
      `Your invoice goes out by email right after delivery. 📧 It's also in your account under order history.\n\nDon't see it? Share your **order ID** and we'll send it again.`,
    ]);
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "warranty") {
    const reply = pick([
      `Most products come with a **6-month manufacturer warranty** against defects. 🛡️\n\nFor a claim:\n1. Share your **order ID** and photos/video of the defect\n2. We'll arrange a **repair or replacement** at no cost\n\n*Warranty doesn't cover physical damage or misuse.*`,
      `Good news — most items are covered by a **6-month warranty**! 🛡️\n\nTo make a claim, share your **order ID** and some photos of the issue. We'll arrange a repair or replacement free of charge.\n\n*Doesn't apply to accidental damage or misuse.*`,
      `Most products have a **6-month manufacturer warranty**. 🛡️\n\nJust share your **order ID** and evidence of the defect and we'll take it from there — repair or replacement, at no cost to you.\n\n*Doesn't cover physical damage or misuse.*`,
    ]);
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "track_order") {
    const reply = pick([
      "Sure! What's your **order ID**?",
      "Of course — drop your **order ID** and I'll pull up the latest status.",
      "Happy to help! Please share your **order ID**.",
    ]);
    chat.awaitingOrderId = true;
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "delivery_info") {
    const reply = pick([
      "Standard delivery takes **3–5 business days** from dispatch. 🚚",
      "Most orders arrive within **3–5 business days**. 🚚",
      "Delivery usually takes **3–5 business days** once your order ships. 🚚",
    ]);
    chat.messages.push({ role: "model", content: reply });
    await chat.save();
    return res.json({ reply });
  }

  if (intent === "cancel_order") {
    const reply = pick([
      "Unfortunately, orders **can't be cancelled** once placed. 😔 If you're unhappy with it on arrival, you have **7 days to request a refund**.",
      "Once an order is confirmed, we're unable to cancel it. However, if it doesn't work out, you can request a **refund within 7 days** of delivery.",
      "Orders **can't be cancelled** after they're placed — but you do have a **7-day refund window** from delivery if you change your mind.",
    ]);
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
You are a warm, helpful customer support agent for an online store. Write like a real person — not a bot reading from a script.

Tone:
- Match the customer: brief and efficient for simple questions, warm and patient for complaints
- Never open with "Of course!", "Certainly!", "Great question!" or similar filler phrases
- Vary your sentence structure — don't always lead the same way
- Use **bold** for key terms, dates, and amounts

Length:
- Simple question → 1–2 sentences
- Complex issue or step-by-step → short prose or a numbered list
- Never pad your answer; never cut off genuinely useful info

Store policies:
- Delivery: 3–5 business days from dispatch
- Cancellations: not allowed once an order is placed
- Refunds: within 7 days of delivery
- Damaged/wrong items: ask for photos + order ID, offer replacement or refund, resolved within 24–48 hours
- Exchanges: within 7 days of delivery, size or colour issues only
- Failed payments: not charged, reversed in 3–5 business days; double charges resolved in 24 hours with order ID
- Warranty: 6-month manufacturer warranty on most products; doesn't cover physical damage or misuse
- Invoice: auto-emailed after delivery, also downloadable from order history

Conversation so far:
${chat.messages.map(m => `${m.role === "user" ? "Customer" : "Agent"}: ${m.content}`).join("\n")}

Customer: ${userMessage}
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
