const { Server } = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new Server({ port: PORT }, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

const clients = new Set();

// connectionイベントの第2引数(req)から接続時のURL情報を取得できるようにする
wss.on('connection', (ws, req) => {
  // URLパラメータから「あいことば（room）」を取得（ない場合は空文字とする）
  const baseURL = req.headers.host ? `http://${req.headers.host}` : 'http://localhost';
  const parsedUrl = new URL(req.url, baseURL);
  const room = parsedUrl.searchParams.get('room') || '';

  // 接続してきたクライアントオブジェクトにルーム名を記録
  ws.room = room;
  
  clients.add(ws);

  ws.on('message', (message) => {
    for (const client of clients) {
      // 自分以外、かつ接続中、かつ「同じルーム（あいことば）にいる」クライアントにのみ送信
      if (client !== ws && client.readyState === 1 && client.room === ws.room) {
        client.send(message.toString());
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});
