const sessions = {};
const inboxes  = {};   // socketId → [files]
const osQueues = {};   // osCode  → { files[], createdAt, claimed }

// ── Regular sessions ──────────────────────────────────────
function createSession(ownerSocketId) {
    const sessionId = Math.floor(10000 + Math.random() * 90000).toString();
    sessions[sessionId] = {
        owner: ownerSocketId,
        ownerSocketId,
        devices: []
    };
    return sessionId;
}

function addDevice(sessionId, device) {
    if (sessions[sessionId]) sessions[sessionId].devices.push(device);
}

function getSession(sessionId) {
    return sessions[sessionId] || null;
}

// ── Inbox (direct device-to-device) ──────────────────────
function addToInbox(socketId, file) {
    if (!inboxes[socketId]) inboxes[socketId] = [];
    inboxes[socketId].push(file);
}

function getInbox(socketId) {
    return inboxes[socketId] || [];
}

// ── OS Transfer queue ─────────────────────────────────────
// Files are held on the server until the other OS claims them.
// Code is 6 digits so it is easy to type after rebooting.

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

// Auto-clean queues older than 48 hours
setInterval(() => {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    Object.keys(osQueues).forEach(code => {
        if (osQueues[code].createdAt < cutoff) delete osQueues[code];
    });
}, 60 * 60 * 1000);

module.exports = {
    createSession, addDevice, getSession,
    addToInbox, getInbox,
    createOsQueue, addToOsQueue, getOsQueue, markOsQueueClaimed
};