const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const archiver = require("archiver");

const {
    addToInbox, getSession, getInbox,
    addToOsQueue, getOsQueue, markOsQueueClaimed
} = require("../services/sessionManager");

const router = express.Router();

// ── Ensure uploads folder exists before multer runs ───────
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const osDir = path.join(__dirname, "../uploads/os-transfer");
if (!fs.existsSync(osDir)) fs.mkdirSync(osDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const osStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, osDir),
    filename:    (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload   = multer({ storage });
const osUpload = multer({ storage: osStorage });

// ═══════════════════════════════════════════════════════════
//  REGULAR SESSION ROUTES
// ═══════════════════════════════════════════════════════════

// ── Upload to session folder ──────────────────────────────
router.post("/upload", upload.single("file"), (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "Session ID required" });
    if (!req.file)  return res.status(400).json({ error: "No file received" });

    const sessionPath = path.join(uploadDir, sessionId);
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    fs.renameSync(req.file.path, path.join(sessionPath, req.file.filename));

    const io = req.app.get("io");
    io.to(sessionId).emit("file-uploaded", { filename: req.file.filename });

    res.json({ message: "File uploaded to session", filename: req.file.filename });
});

// ── Send file directly to target device(s) ───────────────
router.post("/send", upload.array("files", 50), (req, res) => {
    const { targetSocketIds, sendToOwner, sessionId } = req.body;

    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: "No files received" });

    const io = req.app.get("io");
    let targets = [];

    if (sendToOwner === "true") {
        const session = getSession(sessionId);
        if (!session) return res.status(400).json({ error: "Session not found" });
        targets = [session.ownerSocketId];
    } else if (targetSocketIds) {
        try { targets = JSON.parse(targetSocketIds); }
        catch(e) { return res.status(400).json({ error: "Invalid targetSocketIds" }); }
    } else {
        return res.status(400).json({ error: "No target specified" });
    }

    // Deliver every file to every target
    req.files.forEach(file => {
        const fileData = { name: file.originalname, path: file.filename };
        targets.forEach(socketId => {
            addToInbox(socketId, fileData);
            io.to(socketId).emit("receive-file", fileData);
        });
    });

    res.json({
        message: `${req.files.length} file(s) sent successfully`,
        count: req.files.length
    });
});

// ── Inbox ─────────────────────────────────────────────────
router.get("/inbox/:socketId", (req, res) => {
    res.json(getInbox(req.params.socketId));
});

// ── List session files ────────────────────────────────────
router.get("/list/:sessionId", (req, res) => {
    const sessionPath = path.join(uploadDir, req.params.sessionId);
    if (!fs.existsSync(sessionPath)) return res.json([]);

    fs.readdir(sessionPath, (err, files) => {
        if (err) return res.status(500).json({ error: "Unable to read files" });
        res.json(files.map(file => ({
            name: file,
            url:  `/api/files/download/${req.params.sessionId}/${file}`
        })));
    });
});

// ── Download session file ─────────────────────────────────
router.get("/download/:sessionId/:filename", (req, res) => {
    const filePath = path.join(uploadDir, req.params.sessionId, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    res.download(filePath);
});

// ── Download inbox file ───────────────────────────────────
router.get("/download/:filename", (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    res.download(filePath);
});


// ═══════════════════════════════════════════════════════════
//  OS TRANSFER ROUTES
// ═══════════════════════════════════════════════════════════

// ── Create an OS transfer queue and return the 6-digit code ─
router.post("/os-transfer/create", (req, res) => {
    const { createOsQueue } = require("../services/sessionManager");
    const code = createOsQueue();
    res.json({ code, message: "OS transfer queue created" });
});

// ── Upload one or more files into the OS queue ────────────
router.post("/os-transfer/send", osUpload.array("files", 50), (req, res) => {
    const { code } = req.body;

    if (!code) return res.status(400).json({ error: "Transfer code required" });
    if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: "No files received" });

    const queue = getOsQueue(code);
    if (!queue) return res.status(404).json({ error: "Transfer code not found or expired" });
    if (queue.claimed) return res.status(400).json({ error: "This transfer has already been claimed" });

    req.files.forEach(file => {
        addToOsQueue(code, {
            originalName: file.originalname,
            storedName:   file.filename,
            size:         file.size
        });
    });

    res.json({
        message: `${req.files.length} file(s) queued successfully`,
        code,
        fileCount: queue.files.length
    });
});

// ── Check status of an OS queue (is it ready? how many files?) ─
router.get("/os-transfer/status/:code", (req, res) => {
    const queue = getOsQueue(req.params.code);
    if (!queue) return res.status(404).json({ error: "Code not found or expired" });

    res.json({
        code:      req.params.code,
        fileCount: queue.files.length,
        claimed:   queue.claimed,
        files:     queue.files.map(f => ({ name: f.originalName, size: f.size }))
    });
});

// ── Claim all files — returns a zip of everything ────────
router.get("/os-transfer/claim/:code", async (req, res) => {
    const { code } = req.params;
    const queue = getOsQueue(code);

    if (!queue) return res.status(404).json({ error: "Code not found or expired" });
    if (queue.claimed) return res.status(400).json({ error: "Already claimed" });
    if (queue.files.length === 0) return res.status(400).json({ error: "No files in queue yet" });

    // If only one file, download it directly
    if (queue.files.length === 1) {
        const file = queue.files[0];
        const filePath = path.join(osDir, file.storedName);

        if (!fs.existsSync(filePath))
            return res.status(404).json({ error: "File missing on server" });

        markOsQueueClaimed(code);
        return res.download(filePath, file.originalName);
    }

    // Multiple files — bundle as zip
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="andashi-drop-${code}.zip"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(res);

    queue.files.forEach(file => {
        const filePath = path.join(osDir, file.storedName);
        if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: file.originalName });
        }
    });

    archive.finalize();
    markOsQueueClaimed(code);
});

module.exports = router;