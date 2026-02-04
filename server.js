/**
 * Simple WebRTC Signaling Server
 * Works locally and on cloud platforms (Railway / Render)
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// IMPORTANT: use environment port for cloud deployment
const PORT = process.env.PORT || 3000;

// Basic HTTP route (for health check)
app.get("/", (req, res) => {
    res.send("✅ WebRTC Signaling Server is running");
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on("connection", (socket) => {
    console.log("🟢 Client connected");

    socket.on("message", (message) => {
        console.log("📩 Received:", message.toString());

        // Broadcast message to all clients except sender
        wss.clients.forEach((client) => {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    socket.on("close", () => {
        console.log("🔴 Client disconnecteds");
    });

    socket.on("error", (err) => {
        console.error("❌ WebSocket error:", err);
    });
});

// Start server
server.listen(PORT, () => {
    console.log("=======================================");
    console.log("✅ WebRTC Signaling Server Started");
    console.log(`🌐 HTTP  : http://localhost:${PORT}`);
    console.log(`🔌 WS   : ws://localhost:${PORT}`);
    console.log("=======================================");
});
