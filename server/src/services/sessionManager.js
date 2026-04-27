const sessions = {};
const inboxes = {}; // socketId → [files]

function createSession(ownerSocketId) {
    const sessionId = Math.floor(10000 + Math.random() * 90000).toString();

    sessions[sessionId] = {
        owner: ownerSocketId,
        ownerSocketId: ownerSocketId, // ✅ explicit alias used by fileRoutes
        devices: []                   // ✅ owner is NOT pushed here — guests only
    };

    return sessionId;
}

function addDevice(sessionId, device) {
    if (sessions[sessionId]) {
        sessions[sessionId].devices.push(device);
    }
}

function getSession(sessionId) {
    return sessions[sessionId];
}

function addToInbox(socketId, file) {
    if (!inboxes[socketId]) {
        inboxes[socketId] = [];
    }
    inboxes[socketId].push(file);
}

function getInbox(socketId) {
    return inboxes[socketId] || [];
}

module.exports = { createSession, addDevice, getSession, addToInbox, getInbox };