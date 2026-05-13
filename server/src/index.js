const express    = require("express");
const cors       = require("cors");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");
const fs         = require("fs");
const compression = require("compression");
const rateLimit  = require("express-rate-limit");
const cron       = require("node-cron");
const webpush    = require("web-push");

const fileRoutes    = require("./routes/fileRoutes");
const sessionRoutes = require("./routes/sessionRoutes");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 20 * 1024 * 1024
});

const PORT = process.env.PORT || 5000;

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ══════════════════════════════════════════════════════════
//  WEB PUSH
//  To generate keys, run once locally:
//  node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log(JSON.stringify(k))"
//  Then add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to Railway env vars
// ══════════════════════════════════════════════════════════
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        "mailto:amiridirisu22@gmail.com",
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log("[Push] VAPID configured ✓");
} else {
    console.warn("[Push] VAPID keys not set — push notifications disabled");
}

const pushSubscriptions = {}; // socketId → PushSubscription
const transfers = {};         // transferId → transfer state

// ══════════════════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════════════════
app.use(cors());
app.use(compression());
app.use(express.json());
app.set("trust proxy", 1);

// ══════════════════════════════════════════════════════════
//  RATE LIMITERS
// ══════════════════════════════════════════════════════════
const make = (max, windowMs, msg) => rateLimit({
    windowMs, max,
    standardHeaders: true, legacyHeaders: false,
    message: { error: msg }
});

app.use("/api/",                          make(200, 60000,  "Too many requests."));
app.use("/api/sessions/join",             make(10,  60000,  "Too many join attempts. Wait 1 minute."));
app.use("/api/sessions/create",           make(20,  60000,  "Too many sessions created."));
app.use("/api/files/send",                make(60,  60000,  "Upload rate limit reached."));
app.use("/api/files/upload",              make(60,  60000,  "Upload rate limit reached."));
app.use("/api/files/os-transfer/status",  make(15,  60000,  "Too many code checks."));
app.use("/api/files/os-transfer/claim",   make(5,   60000,  "Too many claim attempts."));

// ══════════════════════════════════════════════════════════
//  PUSH SUBSCRIPTION ENDPOINTS
// ══════════════════════════════════════════════════════════
app.get("/api/push/vapid-key", (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

app.post("/api/push/subscribe", (req, res) => {
    const { socketId, subscription } = req.body;
    if (!socketId || !subscription)
        return res.status(400).json({ error: "Missing socketId or subscription" });
    pushSubscriptions[socketId] = subscription;
    console.log(`[Push] Subscribed: ${socketId}`);
    res.json({ message: "Push subscription saved" });
});

app.delete("/api/push/unsubscribe", (req, res) => {
    const { socketId } = req.body;
    if (socketId) delete pushSubscriptions[socketId];
    res.json({ message: "Unsubscribed" });
});

async function pushNotify(socketId, title, body, url = "/") {
    const sub = pushSubscriptions[socketId];
    if (!sub || !process.env.VAPID_PUBLIC_KEY) return;
    try {
        await webpush.sendNotification(sub, JSON.stringify({ title, body, url }));
    } catch(e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
            delete pushSubscriptions[socketId]; // expired subscription
        }
    }
}

// ══════════════════════════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════════════════════════
app.get("/health", (req, res) => {
    res.json({
        status:    "ok",
        uptime:    Math.floor(process.uptime()) + "s",
        memory:    Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
        transfers: Object.keys(transfers).length,
        pushSubs:  Object.keys(pushSubscriptions).length,
        timestamp: new Date().toISOString()
    });
});

// ══════════════════════════════════════════════════════════
//  STATIC + API ROUTES
// ══════════════════════════════════════════════════════════
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/files",    fileRoutes);
app.use("/api/sessions", sessionRoutes);

app.set("io", io);
app.set("pushNotify", pushNotify);

// ══════════════════════════════════════════════════════════
//  SOCKET LOGIC
// ══════════════════════════════════════════════════════════
io.on("connection", (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    socket.on("register-device", () => {
        socket.emit("registered", socket.id);
    });

    socket.on("join-session", (sessionId) => {
        socket.join(sessionId);
    });

    // ── Chunked transfer start ────────────────────────────
    socket.on("file-transfer-start", ({ transferId, fileName, fileSize, totalChunks, targets }) => {
        if (!transferId || !fileName || totalChunks > 5000 || fileSize > 500 * 1024 * 1024) {
            socket.emit("file-transfer-error", { transferId, error: "Invalid parameters" });
            return;
        }

        transfers[transferId] = {
            fileName, fileSize, totalChunks,
            chunks: new Array(totalChunks),
            received: 0, targets,
            senderId: socket.id,
            startedAt: Date.now()
        };

        targets.forEach(targetId => {
            io.to(targetId).emit("file-transfer-incoming", {
                transferId, fileName, fileSize, totalChunks, from: socket.id
            });
        });

        socket.emit("file-transfer-ready", { transferId });
    });

    // ── Chunk received ────────────────────────────────────
    socket.on("file-chunk", ({ transferId, chunkIndex, chunk }) => {
        const t = transfers[transferId];
        if (!t) return;

        // Deduplicate
        if (t.chunks[chunkIndex]) {
            socket.emit("chunk-ack", { transferId, chunkIndex });
            return;
        }

        t.chunks[chunkIndex] = Buffer.from(chunk);
        t.received++;

        // Forward immediately — recipient starts receiving now
        t.targets.forEach(targetId => {
            io.to(targetId).emit("file-chunk", {
                transferId, chunkIndex, chunk, totalChunks: t.totalChunks
            });
        });

        socket.emit("chunk-ack", { transferId, chunkIndex });

        // All chunks in — assemble and save
        if (t.received === t.totalChunks) {
            const safe     = t.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
            const filename = Date.now() + "-" + safe;
            const filePath = path.join(uploadDir, filename);

            fs.writeFile(filePath, Buffer.concat(t.chunks), async () => {
                const { addToInbox } = require("./services/sessionManager");

                for (const targetId of t.targets) {
                    io.to(targetId).emit("file-transfer-complete", {
                        transferId, fileName: t.fileName, downloadPath: filename
                    });

                    addToInbox(targetId, { name: t.fileName, path: filename });

                    // Push notification if recipient is in background
                    await pushNotify(
                        targetId,
                        "📥 New file received",
                        `${t.fileName} is ready to download`,
                        "/"
                    );
                }

                socket.emit("file-transfer-done", { transferId });
                delete transfers[transferId];
            });
        }
    });

    // ── Cancel ────────────────────────────────────────────
    socket.on("file-transfer-cancel", ({ transferId }) => {
        const t = transfers[transferId];
        if (!t) return;
        t.targets.forEach(id => io.to(id).emit("file-transfer-cancelled", { transferId }));
        delete transfers[transferId];
    });

    socket.on("disconnect", () => {
        // Cancel all pending transfers from this sender
        Object.keys(transfers).forEach(id => {
            if (transfers[id].senderId === socket.id) {
                transfers[id].targets.forEach(tid =>
                    io.to(tid).emit("file-transfer-cancelled", { transferId: id })
                );
                delete transfers[id];
            }
        });
        delete pushSubscriptions[socket.id];
        console.log(`[Socket] Disconnected: ${socket.id}`);
    });
});

// ══════════════════════════════════════════════════════════
//  SCHEDULED CLEANUP
// ══════════════════════════════════════════════════════════

// Every hour — delete files older than 24h
cron.schedule("0 * * * *", () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let deleted = 0;

    const cleanDir = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            try {
                const stat = fs.statSync(full);
                if (stat.isDirectory()) {
                    cleanDir(full);
                    if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
                } else if (stat.mtimeMs < cutoff) {
                    fs.unlinkSync(full);
                    deleted++;
                }
            } catch(e) { /* already gone */ }
        }
    };

    cleanDir(uploadDir);
    console.log(`[Cleanup] Hourly: removed ${deleted} file(s)`);
});

// Every 10 minutes — remove stale chunk transfers (hung > 10min)
cron.schedule("*/10 * * * *", () => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    let cleaned = 0;
    for (const id of Object.keys(transfers)) {
        if (transfers[id].startedAt < cutoff) { delete transfers[id]; cleaned++; }
    }
    if (cleaned > 0) console.log(`[Cleanup] Removed ${cleaned} stale transfer(s)`);
});

// Every day at 3am — expire old sessions
cron.schedule("0 3 * * *", () => {
    try {
        const { cleanExpiredSessions } = require("./services/sessionManager");
        const removed = cleanExpiredSessions();
        console.log(`[Cleanup] Daily: removed ${removed} expired session(s)`);
    } catch(e) { /* function may not exist yet */ }
});

// ══════════════════════════════════════════════════════════
server.listen(PORT, () => {
    console.log(`ANDASHI-DROP running on port ${PORT}`);
});