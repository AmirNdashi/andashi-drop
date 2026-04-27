const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const fileRoutes = require("./routes/fileRoutes");
const sessionRoutes = require("./routes/sessionRoutes");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Static frontend
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/api/files", fileRoutes);
app.use("/api/sessions", sessionRoutes);

// Socket logic
io.on("connection", (socket) => {
    console.log("Device connected:", socket.id);

    socket.on("register-device", () => {
        socket.emit("registered", socket.id);
    });

    socket.on("join-session", (sessionId) => {
        socket.join(sessionId);
        console.log(`Socket joined session: ${sessionId}`);
    });
});

// Make io accessible globally
app.set("io", io);

// Start server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});