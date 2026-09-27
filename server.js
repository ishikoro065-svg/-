const { Server } = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new Server({ port: PORT }, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

// ルームごとの状態管理マップ
// 構造: roomName -> { isStarted: boolean, clients: Set<WebSocket> }
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const baseURL = req.headers.host ? `http://${req.headers.host}` : 'http://localhost';
  const parsedUrl = new URL(req.url, baseURL);
  const roomName = parsedUrl.searchParams.get('room') || 'default';

  // ルーム情報が無ければ作成
  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      isStarted: false,
      clients: new Set()
    });
  }

  const room = rooms.get(roomName);

  // 既にゲームが始まっている場合は接続を拒否して切断
  if (room.isStarted) {
    ws.send(JSON.stringify({ type: 'error', message: 'room_started' }));
    ws.close();
    return;
  }

  // ルームにクライアントを追加
  ws.roomName = roomName;
  room.clients.add(ws);

  // 生存確認用：接続した時刻を記録
  ws.lastActive = Date.now();

  // 参加成功メッセージを返信
  ws.send(JSON.stringify({ type: 'join_success' }));

  ws.on('message', (message) => {
    // どんなメッセージでも届いたら「まだ生きている」として時刻を更新
    ws.lastActive = Date.now();

    try {
      const data = JSON.parse(message.toString());
      
      // ゲーム開始メッセージを受信したら、その部屋を「進行中」にする
      if (data.type === 'start_game') {
        room.isStarted = true;
      }
    } catch (e) {
      // JSON解析エラー時はそのまま通過
    }

    // 同じルーム内の自分以外のクライアントへメッセージを転送
    for (const client of room.clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(message.toString());
      }
    }
  });

  ws.on('close', () => {
    if (room) {
      room.clients.delete(ws);

      // ルーム内の人数が0人になったらルームを削除（状態リセット）
      if (room.clients.size === 0) {
        rooms.delete(roomName);
      }
    }
  });
});

// 5秒ごとに全クライアントの生存確認を実行
setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    // 20秒間何の通信も送ってこないクライアントは強制切断（タブ閉じやスリープ対策）
    if (now - ws.lastActive > 20000) {
      ws.terminate();
    }
  });
}, 5000);
