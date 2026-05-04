# 🤖 AI Support Chatbot

A full-stack AI-powered customer support chatbot with an admin dashboard for monitoring conversations, built using Node.js, MongoDB, and deployed on Render + Netlify.

---

## 🚀 Live Demo

- 💬 **Chatbot:** https://your-chatbot-link.netlify.app
- 🛠️ **Admin Panel:** https://your-admin-link.netlify.app

---

## 📌 Features

### 💬 Chatbot
- Real-time AI responses using Gemini API
- Clean modern chat UI (dark theme)
- Handles common support queries (delivery, refund, etc.)
- Graceful error handling for API limits

### 🗄️ Backend
- Node.js + Express server
- MongoDB Atlas for storing chat conversations
- REST API for chatbot + admin panel

### 🛠️ Admin Dashboard
- View all user conversations
- Search users by ID
- See latest message preview
- View message timestamps
- Delete chats (moderation control)
- Total conversation analytics

---

## 🧠 Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express |
| Database | MongoDB Atlas |
| AI | Google Gemini API |
| Deployment | Backend → Render, Frontend → Netlify |

---

## 📂 Project Structure

```
ai-support-chatbot/
│── index.html        # Chatbot UI
│── admin.html        # Admin dashboard
│── server.js         # Backend server
│── package.json
│── .env              # API keys (not pushed)
```

---

## ⚙️ Setup Instructions

1. Clone the repo:
```bash
git clone https://github.com/Sameeksha-Goel/ai-support-chatbot.git
cd ai-support-chatbot
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```
MONGO_URI=your_mongodb_connection_string
GEMINI_API_KEY=your_api_key
```

4. Run server:
```bash
node server.js
```

5. Open:
```
http://localhost:3000
```

---

## ⚠️ Notes

* Free-tier Gemini API has request limits
* If quota is exceeded, chatbot shows fallback message
* MongoDB Atlas free cluster used

---

## 📸 Screenshots

### 💬 Chatbot Interface
![Chatbot](./screenshots/chatbot.png)

### 🤖 Query Handling
![Response](./screenshots/response.png)

### 🛠️ Admin Dashboard
![Admin](./screenshots/admin.png)

### 🗄️ MongoDB Storage
![Database](./screenshots/db.png)

---

## 💡 Future Improvements

- Admin authentication (login system)
- Role-based access control
- Analytics dashboard (charts)
- Chat filtering & tagging
- React-based frontend

---

## 🧑‍💻 Author

**Sameeksha Goel**

---

## ⭐ If you found this useful

Give this repo a star ⭐
