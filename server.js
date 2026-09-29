const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// 部屋（ルーム）ごとの状態管理
// structure: { roomId: { isStarted: boolean, players: Map<ws, playerData> } }
const rooms = new Map();

// プレイヤー一覧を全員にブロードキャスト（配信）する関数
function broadcastMemberList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const members = [];
  room.players.forEach((player) => {
    members.push({
      id: player.id,
      name: player.name,
      isSpectator: !!player.isSpectator
    });
  });

  const payload = JSON.stringify({
    type: 'member_list',
    members: members
  });

  room.players.forEach((_, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(payload);
    }
  });
}

// プレイヤー離脱時の共通処理
function handleUserLeave(ws) {
  if (!ws.roomId || !rooms.has(ws.roomId)) return;

  const room = rooms.get(ws.roomId);
  const leavingPlayer = room.players.get(ws);

  if (leavingPlayer) {
    room.players.delete(ws);

    // 部屋にいる他のプレイヤーへ離脱を通知
    const leaveMsg = JSON.stringify({
      type: 'leave',
      id: leavingPlayer.id
    });

    room.players.forEach((_, clientWs) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(leaveMsg);
      }
    });

    // 部屋が空になったら部屋削除、残っているならメンバーリスト更新
    if (room.players.size === 0) {
      rooms.delete(ws.roomId);
    } else {
      broadcastMemberList(ws.roomId);
    }
  }

  ws.roomId = null;
}

wss.on('connection', (ws) => {
  // Keep-alive (Ping-Pong) 設定
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // --- 1. ルーム参加 (join) ---
      if (data.type === 'join') {
        const roomId = data.roomId || 'default';
        
        if (!rooms.has(roomId)) {
          rooms.set(roomId, { isStarted: false, players: new Map() });
        }

        const room = rooms.get(roomId);

        // 既にゲームが開始されている部屋に入った場合は「観戦者」フラグを立てる
        const isSpectator = room.isStarted;

        ws.roomId = roomId;
        ws.myPlayerId = data.id;
        ws.isSpectator = isSpectator;

        room.players.set(ws, {
          id: data.id,
          name: data.name || 'Unknown',
          isSpectator: isSpectator
        });

        // 本人に参加成功通知（自分が観戦者かどうかを渡す）
        ws.send(JSON.stringify({
          type: 'join_success',
          id: data.id,
          isSpectator: isSpectator
        }));

        // 全員に最新の参加者リストを送信
        broadcastMemberList(roomId);
        return;
      }

      // 部屋に参加していない場合は処理しない
      if (!ws.roomId || !rooms.has(ws.roomId)) return;
      const room = rooms.get(ws.roomId);

      // --- 2. ゲーム開始フラグ設定 (start_game) ---
      if (data.type === 'start_game') {
        room.isStarted = true;
        return;
      }

      // --- 3. 明示的な離脱 (disconnect) ---
      if (data.type === 'disconnect') {
        handleUserLeave(ws);
        return;
      }

      // ★ 観戦者の操作制限 ★
      // 観戦者からの位置同期(transform)、攻撃(shoot/hit)メッセージは他の人に転送しない
      if (ws.isSpectator) {
        if (data.type === 'transform' || data.type === 'shoot' || data.type === 'hit') {
          return;
        }
      }

      // --- 4. その他のゲームプレイメッセージの転送 (transform, shoot, hit, die 等) ---
      const payload = JSON.stringify(data);
      room.players.forEach((_, clientWs) => {
        // 送信者本人以外、かつ接続が開いているクライアントに転送
        if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(payload);
        }
      });

    } catch (e) {
      console.error('Message handling error:', e);
    }
  });

  // 切断（ウィンドウ閉じ・回線切れ等）
  ws.on('close', () => {
    handleUserLeave(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    handleUserLeave(ws);
  });
});

// 30秒ごとにPingを送信して無通信による自動切断を防止
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

// サーバー起動
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
