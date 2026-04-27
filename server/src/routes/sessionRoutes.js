const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const os = require("os");

const { createSession, getSession, addDevice } = require("../services/sessionManager");

// ── Create session ──
router.post("/create", (req, res) => {
    const { socketId } = req.body;

    if (!socketId) {
        return res.status(400).json({ error: "socketId required" });
    }

    const sessionId = createSession(socketId);

    const io = req.app.get("io");

    // Make owner join the socket room
    io.to(socketId).socketsJoin(sessionId);

    // ✅ Owner is NOT added to session.devices — devices list is guests only
    res.json({ sessionId });
});

// ── Join session ──
router.post("/join", (req, res) => {
    const { sessionId, deviceName, socketId } = req.body;

    const session = getSession(sessionId);

    if (!session) {
        return res.status(404).json({ error: "Session not found" });
    }

    // ✅ Block owner from joining as a guest device
    if (socketId === session.ownerSocketId) {
        return res.json({ message: "You are the owner" });
    }

    // Prevent duplicate entries
    const exists = session.devices.find(d => d.socketId === socketId);
    if (!exists) {
        session.devices.push({ socketId, name: deviceName });
    }

    const io = req.app.get("io");

    // Guest joins socket room
    io.to(socketId).socketsJoin(sessionId);

    // ✅ Notify ONLY the owner about the updated device list
    io.to(session.ownerSocketId).emit("device-update", session.devices);

    res.json({ message: "Joined session successfully" });
});

// ── Get session info ──
router.get("/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
        return res.status(404).json({ error: "Not found" });
    }
    res.json(session);
});

// ── QR code generation ──
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (let name of Object.keys(interfaces)) {
        for (let net of interfaces[name]) {
            if (net.family === "IPv4" && !net.internal) {
                return net.address;
            }
        }
    }
    return "localhost";
}

router.get("/qr/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const ip = getLocalIP();
    const url = `http://${ip}:5000/?session=${sessionId}`;
    try {
        const qrImage = await QRCode.toDataURL(url);
        res.json({ qr: qrImage, url });
    } catch (err) {
        res.status(500).json({ error: "QR generation failed" });
    }
});

module.exports = router;