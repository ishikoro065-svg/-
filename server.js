const { Server } = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new Server({ port: PORT }, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

// ルーム管理マップ: roomName -> { isStarted: boolean, clients: Set<WebSocket> }
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const baseURL = req.headers.host ? `http://${req.headers.host}` : 'http://localhost';
  const parsedUrl = new URL(req.url, baseURL);
  const roomName = parsedUrl.searchParams.get('room') || 'default';

  // ルームが存在しなければ作成
  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      isStarted: false,
      clients: new Set()
    });
  }

  const room = rooms.get(roomName);

  // ★ ゲームが既に開始されている場合は観戦者(isSpectator)として扱う
  const isSpectator = room.isStarted;

  // クライアント状態の保持
  ws.roomName = roomName;
  ws.isSpectator = isSpectator;
  ws.isAlive = true;
  ws.myPlayerId = null;
  ws.myPlayerName = 'Unknown';

  room.clients.add(ws);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 1. 接続成功通知（自分が観戦者かどうかを送る）
  ws.send(JSON.stringify({ 
    type: 'join_success',
    isSpectator: isSpectator
  }));

  // ★ 部屋の全プレイヤーへ参加者リスト（ID・名前・観戦フラグ）を配信する共通関数
  const broadcastMemberList = () => {
    const members = [];
    for (const client of room.clients) {
      if (client.myPlayerId) {
        members.push({
          id: client.myPlayerId,
          name: client.myPlayerName || 'Unknown',
          isSpectator: !!client.isSpectator
        });
      }
    }

    const memberListMsg = JSON.stringify({
      type: 'member_list',
      members: members
    });

    for (const client of room.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(memberListMsg);
      }
    }
  };

  // ★ 共通の離脱処理（メッセージ受信時およびcloseイベント時に実行）
  const handleUserLeave = (leavingPlayerId) => {
    if (!room.clients.has(ws)) return;

    room.clients.delete(ws);
    const targetId = leavingPlayerId || ws.myPlayerId;

    // 他の全プレイヤーへ切断通知（0秒で画面からメッシュを消す）
    if (targetId) {
      const disconnectMsg = JSON.stringify({
        type: 'disconnect',
        id: targetId
      });

      for (const client of room.clients) {
        if (client.readyState === 1) {
          client.send(disconnectMsg);
        }
      }
    }

    // 最新のメンバーリストを全員に再配布
    broadcastMemberList();

    // 部屋に誰もおらなくなった場合は部屋消去
    if (room.clients.size === 0) {
      rooms.delete(roomName);
    }
  };

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.id) ws.myPlayerId = data.id;
      if (data.name) ws.myPlayerName = data.name;

      // 参加時や名前登録時にメンバーリストを即座に更新・全員に配信
      if (data.type === 'join' || data.type === 'register_name') {
        broadcastMemberList();
        return;
      }

      // ゲーム開始メッセージを受け取ったらフラグをオン
      if (data.type === 'start_game') {
        room.isStarted = true;
      }

      // 離脱メッセージを受け取った場合（タイトルへ戻る、ボタン操作等）
      if (data.type === 'disconnect') {
        handleUserLeave(data.id);
        ws.close();
        return;
      }

      // ★ 観戦者の場合、移動（transform）や攻撃（shoot/hit）メッセージを他人に転送しない
      if (ws.isSpectator) {
        if (data.type === 'transform' || data.type === 'shoot' || data.type === 'hit') {
          return;
        }
      }

    } catch (e) {
      // JSON解析エラーの無効化
    }

    // 自分以外の同じルーム内のクライアントへ転送
    for (const client of room.clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(message.toString());
      }
    }
  });

  // ソケット切断時（タブ閉じ、通信断など）
  ws.on('close', () => {
    if (rooms.has(roomName)) {
      handleUserLeave(ws.myPlayerId);
    }
  });
});

// 30秒ごとにPingを送信して生存確認（Keep-Alive）
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});
