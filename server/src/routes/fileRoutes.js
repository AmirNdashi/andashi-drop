const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ✅ All requires at the top
const { addToInbox, getSession, getInbox } = require("../services/sessionManager");

const router = express.Router();

// ✅ Ensure uploads folder exists BEFORE multer is configured
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir); // ✅ folder guaranteed to exist
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + "-" + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ storage });

// ── Upload to session folder ──
router.post("/upload", upload.single("file"), (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
    }

    // ✅ Guard against multer failure
    if (!req.file) {
        return res.status(400).json({ error: "No file received" });
    }

    const sessionPath = path.join(uploadDir, sessionId);

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    const oldPath = req.file.path;
    const newPath = path.join(sessionPath, req.file.filename);
    fs.renameSync(oldPath, newPath);

    // ✅ Emit before responding
    const io = req.app.get("io");
    io.to(sessionId).emit("file-uploaded", { filename: req.file.filename });

    res.json({ message: "File uploaded to session", filename: req.file.filename });
});

// ── Send file directly to target device(s) ──
router.post("/send", upload.single("file"), (req, res) => {
    const { targetSocketIds, sendToOwner, sessionId } = req.body;

    // ✅ Guard against multer failure
    if (!req.file) {
        return res.status(400).json({ error: "No file received" });
    }

    const io = req.app.get("io");

    const fileData = {
        name: req.file.originalname,
        path: req.file.filename
    };

    let targets = [];

    if (sendToOwner === "true") {
        const session = getSession(sessionId);
        if (!session) {
            return res.status(400).json({ error: "Session not found" });
        }
        targets = [session.ownerSocketId];
    } else if (targetSocketIds) {
        try {
            targets = JSON.parse(targetSocketIds);
        } catch(e) {
            return res.status(400).json({ error: "Invalid targetSocketIds format" });
        }
    } else {
        return res.status(400).json({ error: "No target specified" });
    }

    targets.forEach(socketId => {
        addToInbox(socketId, fileData);
        io.to(socketId).emit("receive-file", fileData);
    });

    res.json({ message: "File sent successfully" });
});

// ── Inbox ──
router.get("/inbox/:socketId", (req, res) => {
    const inbox = getInbox(req.params.socketId);
    res.json(inbox);
});

// ── List session files ──
router.get("/list/:sessionId", (req, res) => {
    const sessionPath = path.join(uploadDir, req.params.sessionId);

    if (!fs.existsSync(sessionPath)) {
        return res.json([]);
    }

    fs.readdir(sessionPath, (err, files) => {
        if (err) return res.status(500).json({ error: "Unable to read files" });

        res.json(files.map(file => ({
            name: file,
            url: `/api/files/download/${req.params.sessionId}/${file}`
        })));
    });
});

// ── Download ──
router.get("/download/:sessionId/:filename", (req, res) => {
    const { sessionId, filename } = req.params;
    const filePath = path.join(uploadDir, sessionId, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    res.download(filePath);
});

// ── Download inbox file (direct send) ──
router.get("/download/:filename", (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    res.download(filePath);
});

module.exports = router;