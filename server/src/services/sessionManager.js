// ══════════════════════════════════════════════════════════
//  SESSION MANAGER
//  Handles sessions, inboxes, and OS transfer queues.
//  All data is in-memory. Redis upgrade path is clearly
//  marked with TODO comments for when you're ready.
// ══════════════════════════════════════════════════════════

const sessions = {};  // sessionId → session object
const inboxes  = {};  // socketId  → [file objects]
const osQueues = {};  // code      → queue object

// ── Regular sessions ──────────────────────────────────────
function createSession(ownerSocketId) {
    const sessionId = Math.floor(10000 + Math.random() * 90000).toString();

    sessions[sessionId] = {
        owner:         ownerSocketId,
        ownerSocketId: ownerSocketId,
        devices:       [],
        createdAt:     Date.now(),
        lastActiveAt:  Date.now()   // updated on every join/file event
    };

    return sessionId;
}

function addDevice(sessionId, device) {
    if (!sessions[sessionId]) return;
    sessions[sessionId].devices.push(device);
    sessions[sessionId].lastActiveAt = Date.now();
}

function getSession(sessionId) {
    const s = sessions[sessionId];
    if (!s) return null;
    s.lastActiveAt = Date.now(); // mark as active on access
    return s;
}

// ── Inbox ─────────────────────────────────────────────────
function addToInbox(socketId, file) {
    if (!inboxes[socketId]) inboxes[socketId] = [];
    inboxes[socketId].push({ ...file, receivedAt: Date.now() });
}

function getInbox(socketId) {
    return inboxes[socketId] || [];
}

// ── OS Transfer queues ────────────────────────────────────
function createOsQueue() {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    osQueues[code] = {
        files:     [],
        createdAt: Date.now(),
        claimed:   false
    };
    return code;
}

function addToOsQueue(code, file) {
    if (!osQueues[code]) return false;
    osQueues[code].files.push(file);
    return true;
}

function getOsQueue(code) {
    return osQueues[code] || null;
}

function markOsQueueClaimed(code) {
    if (osQueues[code]) osQueues[code].claimed = true;
}

// ── Cleanup expired data ──────────────────────────────────

// Called by the daily cron job in index.js
// Removes sessions idle for more than 24 hours
function cleanExpiredSessions() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const id of Object.keys(sessions)) {
        if (sessions[id].lastActiveAt < cutoff) {
            delete sessions[id];
            removed++;
        }
    }

    // Also clean OS queues older than 48h
    const osCutoff = Date.now() - 48 * 60 * 60 * 1000;
    for (const code of Object.keys(osQueues)) {
        if (osQueues[code].createdAt < osCutoff) {
            delete osQueues[code];
        }
    }

    // Clean inboxes with files older than 24h
    for (const socketId of Object.keys(inboxes)) {
        inboxes[socketId] = inboxes[socketId].filter(
            f => !f.receivedAt || f.receivedAt > cutoff
        );
        if (inboxes[socketId].length === 0) delete inboxes[socketId];
    }

    return removed;
}

// Diagnostic — useful for your /health endpoint
function getStats() {
    return {
        sessions: Object.keys(sessions).length,
        inboxes:  Object.keys(inboxes).length,
        osQueues: Object.keys(osQueues).length
    };
}

module.exports = {
    // Session
    createSession,
    addDevice,
    getSession,
    // Inbox
    addToInbox,
    getInbox,
    // OS Transfer
    createOsQueue,
    addToOsQueue,
    getOsQueue,
    markOsQueueClaimed,
    // Maintenance
    cleanExpiredSessions,
    getStats
};