const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// Storage config (Ubuntu safe pathing)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, "../uploads"));
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + "-" + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ storage });

// Upload endpoint
router.post("/upload", upload.single("file"), (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
    }

    const sessionPath = path.join(__dirname, "../uploads", sessionId);

    // Ensure session folder exists
    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    const oldPath = req.file.path;
    const newPath = path.join(sessionPath, req.file.filename);

    // Move file into session folder
    fs.renameSync(oldPath, newPath);

    res.json({
        message: "File uploaded to session",
        filename: req.file.filename
    });
    const io = req.app.get("io");

// Notify all devices in session
io.to(sessionId).emit("file-uploaded", {
    filename: req.file.filename
});
});

const { addToInbox } = require("../services/sessionManager");

const { getSession } = require("../services/sessionManager");

router.post("/send", upload.single("file"), (req, res) => {
    let { targetSocketIds, sendToOwner, sessionId } = req.body;

    const io = req.app.get("io");

    const fileData = {
        name: req.file.originalname,
        path: req.file.filename
    };

    let targets = [];

    // 🔥 CASE 1: CLIENT → send to owner automatically
    if (sendToOwner === "true") {

        const session = getSession(sessionId);

        if (!session) {
            return res.status(400).json({ error: "Session not found" });
        }

        targets = [session.ownerSocketId];
    }

    // 🔥 CASE 2: OWNER → send to selected devices
    else if (targetSocketIds) {
        targets = JSON.parse(targetSocketIds);
    }

    // ❌ no valid target
    else {
        return res.status(400).json({ error: "No target specified" });
    }

    // 🚀 SEND TO ALL TARGETS
    targets.forEach(socketId => {

        // Save to inbox
        addToInbox(socketId, fileData);

        // Real-time delivery
        io.to(socketId).emit("receive-file", fileData);
    });

    res.json({ message: "File sent successfully" });
});

const { getInbox } = require("../services/sessionManager");

router.get("/inbox/:socketId", (req, res) => {
    const { socketId } = req.params;
    const inbox = getInbox(socketId);
    res.json(inbox);
});

router.get("/list/:sessionId", (req, res) => {
    const { sessionId } = req.params;

    const sessionPath = path.join(__dirname, "../uploads", sessionId);

    if (!fs.existsSync(sessionPath)) {
        return res.json([]);
    }

    fs.readdir(sessionPath, (err, files) => {
        if (err) {
            return res.status(500).json({ error: "Unable to read files" });
        }

        const fileList = files.map(file => ({
            name: file,
            url: `/api/files/download/${sessionId}/${file}`
        }));

        res.json(fileList);
    });
});

router.get("/download/:sessionId/:filename", (req, res) => {
    const { sessionId, filename } = req.params;

    const filePath = path.join(__dirname, "../uploads", sessionId, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    res.download(filePath);
});

module.exports = router;