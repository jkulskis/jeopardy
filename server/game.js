let io;
let gameSocket;

exports.initGame = (sio, socket) => {
  io = sio;
  gameSocket = socket;
  gameSocket.emit("connected", { message: `Connected, id is: ${gameSocket.id}` });
};
