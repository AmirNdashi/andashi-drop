# ANDASHI-DROP 🚀

Real-time AirDrop-like file transfer system built with Node.js and Socket.IO.

---

## ✨ Features

- 🔗 Session-based device connection
- 📱 QR code join system
- ⚡ Real-time file transfer (Socket.IO)
- 🎯 Targeted multi-device sending
- 📥 Persistent inbox system (survives refresh)
- 🌐 Cross-device support (PC ↔ Mobile)
- 🧠 Automatic device naming

---

## 🏗️ Architecture

### Backend
- Node.js + Express
- Socket.IO (real-time communication)
- Multer (file handling)
- In-memory session + inbox management

### Frontend
- Vanilla JS (no framework)
- Responsive UI
- Drag & drop upload
- QR-based onboarding

---

## 📂 Project Structure
client/
└── index.html

server/
├── src/
│ ├── routes/
│ │ ├── fileRoutes.js
│ │ └── sessionRoutes.js
│ ├── services/
│ │ └── sessionManager.js
│ ├── public/
│ └── index.js
└── package.json


---

## 🚀 Getting Started

### 1. Install dependencies

```bash
cd server
npm install


---

## 🚀 Getting Started

### 1. Install dependencies

```bash
cd server
npm install

2. Run server
node src/index.js
3. Open app
http://localhost:5000
📲 How it works
Create a session on one device
Scan QR or enter session ID on another device
Devices connect in real-time
Select target device(s)
Send files instantly
⚠️ Limitations (Current)
Works best on same network (LAN)
Files stored temporarily on server
No encryption yet
🔮 Future Improvements
🔐 End-to-end encryption
🌍 Internet-based transfer (no same WiFi needed)
⚡ WebRTC peer-to-peer transfer
🖥️ Desktop app (Electron)
📦 File chunking for large transfers
👤 Author

Amir Ndashi