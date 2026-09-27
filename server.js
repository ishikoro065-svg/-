const { Server } = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new Server({ port: PORT }, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('message', (message) => {
    for (const client of clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(message.toString());
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});
