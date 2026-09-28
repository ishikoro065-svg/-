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

  // ルームが存在しなければ作成
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

  // 生存フラグとプレイヤーIDの保持
  ws.isAlive = true;
  ws.myPlayerId = null;

  // クライアントからpongが返ってきたら生存フラグを立てる
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 参加成功メッセージを返信
  ws.send(JSON.stringify({ type: 'join_success' }));

  // 共通の離脱処理（メッセージ受信時・closeイベント時の両方から呼ばれる）
  const handleUserLeave = (leavingPlayerId) => {
    if (!room.clients.has(ws)) return;

    // 1. 部屋のクライアント一覧から削除
    room.clients.delete(ws);

    const targetId = leavingPlayerId || ws.myPlayerId;

    // 2. 他のプレイヤーに「離脱通知」を即時転送（相手画面から0秒で敵メッシュを消す）
    if (targetId) {
      const disconnectMsg = JSON.stringify({
        type: 'disconnect',
        id: targetId
      });

      for (const client of room.clients) {
        if (client.readyState === 1) { // 1 = OPEN
          client.send(disconnectMsg);
        }
      }
    }

    // 3. 部屋の人数チェック
    if (room.clients.size === 0) {
      rooms.delete(roomName);
    } else {
      // まだ誰か残っている場合はゲーム進行中フラグを落として再戦できるようにする
      room.isStarted = false;
    }
  };

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // プレイヤーIDが流れてきたらソケットに保持（close時の保険）
      if (data.id) {
        ws.myPlayerId = data.id;
      }

      // ゲーム開始メッセージの受け取り
      if (data.type === 'start_game') {
        room.isStarted = true;
      }

      // 明示的な離脱メッセージの受け取り（タイトルに戻る・タブ閉じ時）
      if (data.type === 'disconnect') {
        handleUserLeave(data.id);
        ws.close(); // サーバー側からも即座にソケットを閉じる
        return;
      }
    } catch (e) {
      // JSON解析エラー時
    }

    // 自分以外の同じルーム内のクライアントへ転送
    for (const client of room.clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(message.toString());
      }
    }
  });

  // ソケット切断時（ネットワーク切断、ブラウザ終了時）
  ws.on('close', () => {
    if (rooms.has(roomName)) {
      handleUserLeave(ws.myPlayerId);
    }
  });
});

// 30秒ごとにPingを送信して生存確認と接続維持（Keep-Alive）を実行
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
