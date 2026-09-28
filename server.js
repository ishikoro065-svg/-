const { Server } = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new Server({ port: PORT }, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

const rooms = new Map();

wss.on('connection', (ws, req) => {
  const baseURL = req.headers.host ? `http://${req.headers.host}` : 'http://localhost';
  const parsedUrl = new URL(req.url, baseURL);
  const roomName = parsedUrl.searchParams.get('room') || 'default';

  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      isStarted: false,
      clients: new Set()
    });
  }

  const room = rooms.get(roomName);

  if (room.isStarted) {
    ws.send(JSON.stringify({ type: 'error', message: 'room_started' }));
    ws.close();
    return;
  }

  ws.roomName = roomName;
  room.clients.add(ws);

  // ★1. 生存フラグを管理
  ws.isAlive = true;

  // クライアントからpongが返ってきたら生存フラグを立てる
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.send(JSON.stringify({ type: 'join_success' }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'start_game') {
        room.isStarted = true;
      }
    } catch (e) {
      // JSON解析エラー時
    }

    for (const client of room.clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(message.toString());
      }
    }
  });

  ws.on('close', () => {
    if (room) {
      room.clients.delete(ws);
      if (room.clients.size === 0) {
        rooms.delete(roomName);
      }
    }
  });
});

// ★2. 30秒ごとにPingを送信して生存確認と接続維持（Keep-Alive）を行う
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    // 前回送信したPingに対してPongが返っていなければ切断
    if (ws.isAlive === false) {
      return ws.terminate();
    }

    // フラグを一旦falseにしてからPingを送信
    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // 30秒周期

wss.on('close', () => {
  clearInterval(interval);
});
