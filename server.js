/**
 * WebRTC Signaling Server (Railway Compatible)
 * - Room-based
 * - Non-local
 * - Works across different networks
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// Railway / cloud must use process.env.PORT
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("✅ WebRTC Signaling Server Running");
});

const wss = new WebSocket.Server({ server });

// roomId -> Set of sockets
const rooms = new Map();

wss.on("connection", (ws) => {
    console.log("🟢 Client connected");

    ws.on("message", (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            console.error("❌ Invalid JSON");
            return;
        }

        const { type, roomId } = msg;

        // JOIN ROOM
        if (type === "join") {
            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set());
            }

            rooms.get(roomId).add(ws);
            ws.roomId = roomId;

            console.log(`👥 Joined room: ${roomId}`);
            return;
        }

        // RELAY SIGNALING MESSAGE
        if (!ws.roomId || !rooms.has(ws.roomId)) return;

        rooms.get(ws.roomId).forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(msg));
            }
        });
    });

    ws.on("close", () => {
        const roomId = ws.roomId;
        if (roomId && rooms.has(roomId)) {
            rooms.get(roomId).delete(ws);
            if (rooms.get(roomId).size === 0) {
                rooms.delete(roomId);
            }
        }
        console.log("🔴 Client disconnected");
    });

    ws.on("error", (err) => {
        console.error("❌ WS Error:", err);
    });
});

server.listen(PORT, () => {
    console.log("==================================");
    console.log("🚀 WebRTC Signaling Server Online");
    console.log(`🌐 PORT: ${PORT}`);
    console.log("==================================");
});
