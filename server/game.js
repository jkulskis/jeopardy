let io;
let players = {};
let games = {};

const Player = (socket) => ({
  id: socket.id,
  name: null,
  isOwner: false,
  gameID: null, // null if not in a game, otherwise the gameID
  score: 0,
  disconnected: false,
});

const Game = (socket, gameID) => ({
  id: gameID,
  ownerID: socket.id,
  players: {},
  status: "lobby",
});

exports.playerConnected = (sio, socket) => {
  io = sio;
  if (socket.id in players) {
    players[socket.id].disconnected = false;
  } else {
    players[socket.id] = Player(socket.id);
  }
  socket.emit("connected", {
    message: `Connected, id is: ${socket.id}`,
  });
  initGame(socket);
  socket.emit("debug", players);
  socket.emit("debug", `# of Players: ${Object.keys(players).length}`);
  socket.emit("debug", games);
  socket.emit("debug", `# of Games: ${Object.keys(games).length}`);
};

exports.playerDisconnected = (socket) => {
  players[socket.id].disconnected = true;

  // give the player 60 seconds to reconnect
  setTimeout(() => {
    if (players[socket.id].disconnected) {
      if (socket.id in players)
        if (players[socket.id].gameID !== null) {
          // remove from game
          // check first that the game exists, it may have
          // been deleted already
          if (players[socket.id].gameID in games) {
            delete games[players[socket.id].gameID].players[socket.id];
            if (
              Object.keys(games[players[socket.id].gameID].players).length === 0
            )
              delete games[players[socket.id].gameID];
            else {
              if (games[players[socket.id].gameID].status === "lobby") {
                resetLobby(
                  players[socket.id].gameID,
                  players[socket.id].isOwner
                );
              }
            }
          }
        }
      delete players[socket.id]; // remove from player list
    }
  }, 1000);
};

initGame = (socket) => {
  socket.on("createGame", createGame);
  socket.on("joinGame", joinGame);
  socket.on("leaveGame", leaveGame);
};

/**
 *
 * @param {name: playerName, gameID: id of game} data
 */
function joinGame(data) {
  if (!(data.name && /\S/.test(data.name))) {
    return this.emit("showError", {error: `Choose a Better Name!`})
  }
  players[this.id].name = data.name;
  result = { gameID: data.gameID, error: null };
  result["playerNames"] = [];
  if (data.gameID in games) {
    for (let playerID in games[data.gameID].players) {
      result["playerNames"].push(players[playerID].name);
      if (data.name == players[playerID].name) {
        result.error = "Someone in this game already has that name";
        return this.emit("showError", result);
      }
    }
  } else {
    result.error = "This game ID does not exist";
    return this.emit("showError", result);
  }
  this.join(data.gameID);
  players[this.id].gameID = data.gameID;
  games[data.gameID].players[this.id] = players[this.id];
  this.broadcast
    .to(data.gameID)
    .emit("updateLobby", { names: [data.name], reset: false });
  // contains player names, can make the lobby if no error, else will have
  // an error, and notify the client that it was a failure joining
  this.emit("gameJoined", result);
}

/**
 *
 * @param {gameID: *} data
 */
function leaveGame(data) {
  if (!("gameID" in data) || !(data.gameID in games)) {
    console.log("Invalid leave game");
    return;
  }
  this.leave(data.gameID);
  players[this.id].gameID = null;
  changeOwner = false;
  if (games[data.gameID].ownerID === this.id) {
    changeOwner = true;
    players[this.id].isOwner = false;
  }
  delete games[data.gameID].players[this.id];
  if (Object.keys(games[data.gameID].players).length === 0) {
    delete games[data.gameID];
    return;
  }
  resetLobby(data.gameID, changeOwner);
}

/**
 * @param socket: socket to broadcast with
 * @param gameID: gameID to reset lobby of
 */
resetLobby = (gameID, changeOwner) => {
  playerNames = [];
  for (let playerID in games[gameID].players) {
    if (changeOwner) {
      // update the first available player to be the new owner
      players[playerID].isOwner = true;
      games[gameID].ownerID = playerID;
      changeOwner = false;
    }
    playerNames.push(players[playerID].name);
  }
  io.to(gameID).emit("updateLobby", { names: playerNames, reset: true });
};
/**
 *
 * @param {name: playerName} data
 */
function createGame(data) {
  if (!(data.name && /\S/.test(data.name))) {
    return this.emit("showError", {error: `Choose a Better Name!`})
  }
  let gameID = (Math.random() * 100000) | 0;
  games[gameID] = Game(this, gameID);
  games[gameID].players[this.id] = players[this.id];
  games[gameID].ownerID = this.id;
  players[this.id].name = data.name;
  players[this.id].gameID = gameID;
  // save the owner socket ID as well as the game ID so that we can
  // check to make sure who the owner is when owner actions take place
  this.emit("newGameCreated", gameID);
  this.join(gameID.toString());
}
