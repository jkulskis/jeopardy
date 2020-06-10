const http = require("http");
const express = require("express");
const socketio = require("socket.io");

const app = express();
const clientPath = `${__dirname}/../public`;

app.use(express.static(clientPath));

const gameClient = require("./game");

const server = http.createServer(app);

const io = socketio(server);

io.on("connection", (socket) => {
  //console.log(`new connection from ${socket.id}`);
  gameClient.playerConnected(io, socket);
  socket.on("disconnect", () => {
    gameClient.playerDisconnected(socket);
  });
});

server.on("error", (err) => {
  console.error("Server error:", err);
});

port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log("Server started on port", port);
});
