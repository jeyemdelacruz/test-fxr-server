/**
 * Production-ready WebRTC Signaling Server (Railway/Render friendly)
 * - Express health check
 * - WebSocket signaling on /ws
 * - Broadcast to room peers only (join/leave)
 * - Optional clientId
 * - Heartbeat ping/pong keepalive
 * - Binds to 0.0.0.0 and uses process.env.PORT
 *
 * Client connect (Railway):
 *   const ws = new WebSocket("wss://YOUR-PROJECT.up.railway.app/ws");
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// ---------- Health check ----------
app.get("/", (req, res) => {
  res.status(200).send("✅ WebRTC Signaling Server is running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

// ---------- WebSocket server ----------
const wss = new WebSocket.Server({
  server,
  path: "/ws", // important: stable ws path for proxies
});

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

// Track rooms: roomId -> Set<ws>
const rooms = new Map();

// Attach metadata to each socket
function attachSocket(ws) {
  ws.id = newId();
  ws.roomId = null;
  ws.isAlive = true;
}

// Send safely
function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

// Broadcast to a room (optionally exclude sender)
function broadcastRoom(roomId, payload, excludeWs = null) {
  const set = rooms.get(roomId);
  if (!set) return;
  for (const client of set) {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      client.send(JSON.stringify(payload));
    }
  }
}

// Remove ws from its current room
function leaveRoom(ws) {
  const roomId = ws.roomId;
  if (!roomId) return;

  const set = rooms.get(roomId);
  if (set) {
    set.delete(ws);

    // notify others
    broadcastRoom(roomId, { type: "peer-left", peerId: ws.id }, ws);

    // cleanup empty rooms
    if (set.size === 0) rooms.delete(roomId);
  }

  ws.roomId = null;
}

// Join/create room
function joinRoom(ws, roomId) {
  if (!roomId || typeof roomId !== "string") {
    send(ws, { type: "error", message: "roomId is required" });
    return;
  }

  // leave existing room first
  leaveRoom(ws);

  let set = rooms.get(roomId);
  if (!set) {
    set = new Set();
    rooms.set(roomId, set);
  }

  set.add(ws);
  ws.roomId = roomId;

  // send ack + peer list
  const peers = [];
  for (const client of set) {
    if (client !== ws) peers.push(client.id);
  }

  send(ws, {
    type: "joined",
    roomId,
    peerId: ws.id,
    peers,
  });

  // notify others
  broadcastRoom(roomId, { type: "peer-joined", peerId: ws.id }, ws);
}

// ---------- Heartbeat (keepalive) ----------
function heartbeat() {
  this.isAlive = true;
}

const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try {
        leaveRoom(ws);
      } catch {}
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // ignore
    }
  }
}, 30000);

wss.on("close", () => clearInterval(heartbeatInterval));

// ---------- Connection handler ----------
wss.on("connection", (ws, req) => {
  attachSocket(ws);

  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket.remoteAddress;

  console.log(`🟢 WS connected id=${ws.id} ip=${ip}`);

  ws.on("pong", heartbeat);

  // Optional: send hello
  send(ws, { type: "hello", peerId: ws.id });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    // Expected message formats:
    // { type: "join", roomId: "abc" }
    // { type: "leave" }
    // { type: "signal", to?: "peerId", data: { sdp / candidate / ... } }
    // { type: "broadcast", data: any }  (optional)

    const type = msg?.type;

    if (type === "join") {
      joinRoom(ws, msg.roomId);
      return;
    }

    if (type === "leave") {
      leaveRoom(ws);
      send(ws, { type: "left" });
      return;
    }

    if (type === "signal") {
      // Must be in a room
      if (!ws.roomId) {
        send(ws, { type: "error", message: "Join a room first" });
        return;
      }

      // If "to" provided, send direct to that peer; else broadcast
      const payload = {
        type: "signal",
        from: ws.id,
        data: msg.data ?? null,
      };

      const to = msg.to;
      if (to && typeof to === "string") {
        const set = rooms.get(ws.roomId);
        if (!set) return;

        let target = null;
        for (const client of set) {
          if (client.id === to) {
            target = client;
            break;
          }
        }

        if (!target) {
          send(ws, { type: "error", message: `Peer not found: ${to}` });
          return;
        }

        send(target, payload);
      } else {
        broadcastRoom(ws.roomId, payload, ws);
      }

      return;
    }

    if (type === "broadcast") {
      if (!ws.roomId) {
        send(ws, { type: "error", message: "Join a room first" });
        return;
      }
      broadcastRoom(
        ws.roomId,
        { type: "broadcast", from: ws.id, data: msg.data ?? null },
        ws
      );
      return;
    }

    send(ws, { type: "error", message: `Unknown type: ${type}` });
  });

  ws.on("close", () => {
    console.log(`🔴 WS disconnected id=${ws.id}`);
    try {
      leaveRoom(ws);
    } catch {}
  });

  ws.on("error", (err) => {
    console.error(`❌ WS error id=${ws.id}:`, err);
  });
});

// ---------- Start ----------
server.listen(PORT, "0.0.0.0", () => {
  console.log("=======================================");
  console.log("✅ WebRTC Signaling Server Started");
  console.log(`🌐 HTTP : http://localhost:${PORT}/ (local only)`);
  console.log(`🔌 WS   : ws://localhost:${PORT}/ws (local only)`);
  console.log("🚀 Deploy: use wss://YOUR-DOMAIN/ws");
  console.log("=======================================");
});
