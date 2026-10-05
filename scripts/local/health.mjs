import { connect } from "node:net";
await Promise.all([3000, 3001, 3002].map(port => new Promise((resolve, reject) => {
  const socket = connect({ host: "127.0.0.1", port });
  socket.setTimeout(3000);
  socket.once("connect", () => { socket.destroy(); resolve(); });
  socket.once("error", reject);
  socket.once("timeout", () => { socket.destroy(); reject(new Error(`Port ${port} unavailable`)); });
})));
