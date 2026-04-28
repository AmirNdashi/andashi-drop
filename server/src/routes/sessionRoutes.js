const express = require("express");
const router  = express.Router();
const QRCode  = require("qrcode");
const os      = require("os");

const { createSession, getSession } = require("../services/sessionManager");

// ── Create session ────────────────────────────────────────
router.post("/create", (req, res) => {
    const { socketId } = req.body;
    if (!socketId) return res.status(400).json({ error: "socketId required" });

    const sessionId = createSession(socketId);
    const io = req.app.get("io");
    io.to(socketId).socketsJoin(sessionId);

    res.json({ sessionId });
});

// ── Join session ──────────────────────────────────────────
router.post("/join", (req, res) => {
    const { sessionId, deviceName, socketId } = req.body;
    const session = getSession(sessionId);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (socketId === session.ownerSocketId) return res.json({ message: "You are the owner" });

    const exists = session.devices.find(d => d.socketId === socketId);
    if (!exists) session.devices.push({ socketId, name: deviceName });

    const io = req.app.get("io");
    io.to(socketId).socketsJoin(sessionId);
    io.to(session.ownerSocketId).emit("device-update", session.devices);

    res.json({ message: "Joined session successfully" });
});

// ── Get session info ──────────────────────────────────────
router.get("/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Not found" });
    res.json(session);
});

// ── QR code ───────────────────────────────────────────────
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (let name of Object.keys(interfaces)) {
        for (let net of interfaces[name]) {
            if (net.family === "IPv4" && !net.internal) return net.address;
        }
    }
    return "localhost";
}

router.get("/qr/:sessionId", async (req, res) => {
    const baseUrl = process.env.BASE_URL || `http://${getLocalIP()}:5000`;
    const url = `${baseUrl}/?session=${req.params.sessionId}`;
    try {
        const qrImage = await QRCode.toDataURL(url);
        res.json({ qr: qrImage, url });
    } catch(err) {
        res.status(500).json({ error: "QR generation failed" });
    }
});

module.exports = router;