const crypto = require("crypto");
const questions = require(`${__dirname}/../data/processed_jeopardy_questions.json`);
let categories = Object.keys(questions);
let io;
let players = {};
let games = {};

// creates a timeout handler that can prematurely clear/trigger the
// function connected to the timeout
// inspired by https://stackoverflow.com/a/36790119/10231083
createTimeout = (f, delay) => {
  let timeoutFunction = setTimeout(f, delay);
  return {
    clear: () => {
      clearTimeout(timeoutFunction);
    },
    trigger: () => {
      clearTimeout(timeoutFunction);
      timeoutFunction();
    },
  };
};

function Player(socketID) {
  this.id = socketID;
  this.name = null;
  this.isOwner = false;
  this.gameID = null; // null if not in a game, otherwise the game's ID
  this.score = 0;
  this.disconnected = false;
}

function Game(socket, gameID) {
  this.id = gameID;
  this.ownerID = socket.id;
  // id of the player who's turn it is (they get to choose the next clue)
  this.turnPlayerID = socket.id;
  // id of the player that is currently buzzed in
  this.buzzedPlayerID = null;
  // ids of ther players that have answered the last question
  this.buzzedPlayerIDs = new Map();
  this.currentClueID = null;
  this.currentRound = "round1";
  this.players = {};
  this.getNumPlayers = () => Object.keys(this.players).length;
  this.status = "lobby";
  // r1 & r2 have categories as keys, and these categories have question values as keys
  // which lead to lists of questions...final just has a final jeopardy question
  // the client board only has category names and ids of questions as keys
  // with 0 as unanswered and 1 as answered
  this.clientBoard = { round1: {}, round2: {}, final: {} };
  // this is a map to have O(1) ability to check if a clue ID is valid,
  // and if so then grab that question's attributes
  this.clueMap = new Map();

  this.fillBoards = () => {
    chosenCategories = new Map();
    category = categories[(categories.length * Math.random()) << 0];
    for (let i = 0; i < 12; i++) {
      // make sure we didn't already choose this category + isn't final jeopardy
      while (chosenCategories.has(category) || category === "final") {
        category = categories[(categories.length * Math.random()) << 0];
      }
      chosenCategories.set(category, 0);
      // add questions from this category to the board
      clientRound = i < 6 ? this.clientBoard.round1 : this.clientBoard.round2;
      clientRound[category] = [];
      for (let value in questions[category]) {
        // list that are at this value...we will choose a random one from it
        clueList = questions[category][value];
        randomValueClue = clueList[(clueList.length * Math.random()) << 0];
        randomValueClue["answered"] = 0;
        clientClue = {
          id: randomValueClue["id"],
          value: randomValueClue["value"],
          answered: 0,
        };
        clientRound[category].push(clientClue);
        randomValueClue["clientClue"] = clientClue;
        this.clueMap.set(randomValueClue["id"], randomValueClue);
      }
    }
    randomFinal =
      questions["final"][(questions["final"].length * Math.random()) << 0];
    this.clientBoard.final = randomFinal["id"];
    this.clueMap.set(randomFinal["id"], randomFinal);
  };

  this.getCurrentAnswer = () => {
    clue = this.clueMap.get(this.currentClueID);
    clue.answered = 1;
    return clue.answer;
  };

  // every time a player buzzes in, this timeout
  // function is set to run
  this.buzzedPlayerTimeout = () => {
    buzzedPlayerName = this.players[this.buzzedPlayerID].name;
    io.to(gameID).emit("showStatus", {
      message: `Time is up for ${buzzedPlayerName}!`,
    });
    this.buzzedPlayerID = null;
    if (this.getNumPlayers() === this.buzzedPlayerIDs.size) {
      io.to(this.id).emit("scoreQuestion", { players: this.buzzedPlayerIDs });
    } else {
      inquireOtherAnswers({ gameID: this.id });
    }
  };
  this.buzzedPlayerTimeoutHandler = null;

  this.waitingForAnswersTimeout = () => {
    if (!this.buzzedPlayerIDs.size) {
      sendClueAnswer({ gameID: this.id });
    } else {
      sendClueAnswer({ gameID: this.id });
      io.to(this.id).emit("scoreQuestion", { players: this.buzzedPlayerIDs });
    }
  };
  this.waitingForAnswersTimeoutHandler = null;
}

exports.playerConnected = (sio, socket) => {
  io = sio;
  if (socket.id in players) {
    players[socket.id].disconnected = false;
  } else {
    players[socket.id] = new Player(socket.id);
  }
  socket.emit("connected", {
    message: `Connected, id is: ${socket.id}`,
  });
  initSession(socket);
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

defined = (...objs) => {
  objs.forEach((obj) => {
    if (obj === undefined) {
      console.log(`Object ${obj} is not defined`);
      return false;
    }
  });
  return true;
};

// check if an object has certain keys
hasKeys = (obj, ...keys) => {
  for (key of keys) {
    if (!(key in obj)) {
      console.log(`Object ${JSON.stringify(obj)} does not have key ${key}`);
      return false;
    }
  }
  return true;
};

nameCheck = (name, socket) => {
  if (!(name && /\S/.test(name))) {
    socket.emit("showError", { error: "Enter a Name" });
    return false;
  }
  if (!/^[\w\-\s]+$/.test(name)) {
    socket.emit("showError", {
      error: "Name contains invalid characters",
    });
    return false;
  }
  if (name.length > 11) {
    socket.emit("showError", {
      error: "Name must be less than 12 characters long",
    });
    return false;
  }
  return true;
};

gameExists = (gameID) => {
  return gameID in games;
};

errorDataGamePlayer = (data, pSock) => {
  // make sure the data parameter is fulfilled
  if (!defined(data)) return 1;
  // make sure there is a gameID key
  if (!hasKeys(data, "gameID")) return 1;
  // make sure the gameID is valid
  if (!gameExists(data.gameID)) return 1;
  // make sure the player is in the game
  if (!(pSock.id in games[data.gameID].players)) return 1;
  // if we made it this far past all the checks, return 0
  return 0;
};

initSession = (socket) => {
  socket.on("createGame", createGame);
  socket.on("joinGame", joinGame);
  socket.on("leaveGame", leaveGame);
  socket.on("startGame", startGame);
  socket.on("clueChosen", clueChosen);
  socket.on("buzzIn", buzzIn);
  socket.on("getClueAnswer", sendClueAnswer);
  socket.on("clueComplete", afterClueCompleted);
};

function startGame(data) {
  pSock = this;
  if (errorDataGamePlayer(data, pSock)) return 1;
  // make sure that the player is in the game and that they are an owner
  if (players[pSock.id].isOwner === false) return 1;
  // player must be owner of this particular game to start it
  if (games[data.gameID].ownerID !== pSock.id) return 1;

  io.to(data.gameID).emit("startGame");
  games[data.gameID].fillBoards();
  games[data.gameID].currentRound = "round1";
  emitBoard({ pSock: pSock, gameID: data.gameID, round: "round1" });
  updateScoreboard({ gameID: data.gameID, gameStarted: true });
}

/**
 *
 * @param {pSock: socket of player, gameID: id of game, round: *, solo: emit board to pSock only} data
 */
function emitBoard(data) {
  game = games[data.gameID];
  clientBoard = game.clientBoard;
  if (!data.solo) {
    io.to(data.gameID).emit("createBoard", {
      board: clientBoard[game.currentRound],
      round: game.currentRound,
    });
    io.to(data.gameID).emit("debug", clientBoard);
  } else {
    pSock.emit("createBoard", {
      board: clientBoard[data.currentRound],
      round: game.currentRound,
    });
  }
  io.to(game.turnPlayerID).emit("playerHasTurn");
  turnPlayerName = game.players[game.turnPlayerID].name;
  console.log(game.getNumPlayers());
  if (game.getNumPlayers() > 1)
    io.to(data.gameID).emit("showStatus", {
      message: `${turnPlayerName}'s turn!`,
    });
  // data.pSock.emit("debug", {
  //   board: clientBoard[data.round],
  //   round: data.round,
  // });
}

/**
 *
 * @param {gameID: *, gameStarted: true/false, playerIDs: IDs of players to update} data
 */
function updateScoreboard(data) {
  playerScores = [];
  if (data.gameStarted) {
    for (let playerID in games[data.gameID].players) {
      player = games[data.gameID].players[playerID];
      playerScores.push({
        id: player.id,
        name: player.name,
        score: player.score,
      });
    }
    return io
      .to(data.gameID)
      .emit("updateScoreBoard", { reset: true, players: playerScores });
  }
  data.playerIDs.forEach((playerID) => {
    player = games[data.gameID].players[playerID];
    playerScores.push({
      id: player.id,
      name: player.name,
      score: player.score,
    });
    return io
      .to(data.gameID)
      .emit("updateScoreBoard", { players: playerScores });
  });
}

/**
 *
 * @param {clueID: ID of the chosen clue, gameID: id of game} data
 */
function clueChosen(data) {
  if (errorDataGamePlayer(data, this)) return 1;
  clueID = data.clueID;
  game = games[data.gameID];
  if (game.turnPlayerID !== this.id) return 1;
  if (!hasKeys(data, "clueID")) return 1;
  if (game.clueMap.has(clueID) === false) return 1;
  // DEBUG
  io.to(data.gameID).emit("debug", "10s waiting for answers timeout");
  game.waitingForAnswersTimeoutHandler = createTimeout(
    game.waitingForAnswersTimeout,
    10000
  );
  io.to(data.gameID).emit("inquireOtherAnswers", { timeout: 10000 });
  game.currentClueID = clueID;
  clue = game.clueMap.get(clueID);
  clue.clientClue.answered = 1;
  // sending as object just in case we want to send other info like show #, date, etc.
  io.to(data.gameID).emit("showClue", {
    question: clue.question,
  });
}

function buzzIn(data) {
  if (errorDataGamePlayer(data, this)) return 1;
  game = games[data.gameID];
  if (game.buzzedPlayerID !== null) return 1;
  if (game.buzzedPlayerIDs.has(this.id)) return 1; // can't buzz in twice
  game.buzzedPlayerID = this.id;
  buzzedPlayerName = game.players[game.buzzedPlayerID].name;
  io.to(data.gameID).emit("playerTimerCountdown", {
    playerID: game.buzzedPlayerID,
  });
  io.to(data.gameID).emit("showStatus", {
    message: `${buzzedPlayerName} just buzzed in!`,
  });
  // stop the timeout for all answers (timeout if no one buzzes in)
  game.waitingForAnswersTimeoutHandler.clear();
  game.buzzedPlayerIDs.set(game.buzzedPlayerID, buzzedPlayerName);
  // start the player's personal timer to answer the question
  game.buzzedPlayerTimeoutHandler = createTimeout(
    game.buzzedPlayerTimeout,
    5000
  );
}

function inquireOtherAnswers(data) {
  setTimeout(() => {
    game = games[data.gameID];
    io.to(data.gameID).emit("inquireOtherAnswers", { timeout: 3000 });
    io.to(data.gameID).emit("debug", "3s waiting for answers timeout");
    game.waitingForAnswersTimeoutHandler = createTimeout(
      game.waitingForAnswersTimeout,
      3000
    );
  }, 1000);
}

function sendClueAnswer(data) {
  if (!gameExists(data.gameID)) return 1;
  game = games[data.gameID];
  if (game.currentClueID === null) return 1;
  io.to(data.gameID).emit("showClueAnswer", {
    answer: game.getCurrentAnswer(),
  });
  game.currentClueID = null;
}

function afterClueCompleted(data) {
  if (errorDataGamePlayer(data, this)) return 1;
  game = games[data.gameID];
  if (game.currentClueID !== null) return 1;
  emitBoard({
    pSock: this,
    gameID: data.gameID,
    round: game.currentRound,
  });
}

/**
 *
 * @param {name: playerName, gameID: id of game} data
 */
function joinGame(data) {
  if (!defined(data)) return 1;
  if (!hasKeys(data, "name", "gameID")) return 1;
  if (!nameCheck(data.name, this)) return 1;
  players[this.id].name = data.name;
  data.gameID = data.gameID.toUpperCase();
  result = { gameID: data.gameID, error: null };
  result["playerNames"] = [];
  if (data.gameID in games) {
    for (let playerID in games[data.gameID].players) {
      if (data.name == players[playerID].name) {
        result.error = "Someone in this game already has that name";
        return this.emit("showError", result);
      }
      if (players[playerID].isOwner)
        result["playerNames"].push(players[playerID].name + " (Owner)");
      else result["playerNames"].push(players[playerID].name);
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
      // let the client know that they are the new owner
      io.to(playerID).emit("makeOwner");
      changeOwner = false;
    }
    if (players[playerID].isOwner)
      playerNames.push(players[playerID].name + " (Owner)");
    else playerNames.push(players[playerID].name);
  }
  io.to(gameID).emit("updateLobby", { names: playerNames, reset: true });
};
/**
 *
 * @param {name: playerName} data
 */
function createGame(data) {
  if (!defined(data)) return 1;
  if (!hasKeys(data, "name")) return 1;
  if (!nameCheck(data.name, this)) return 1;
  // 6 char string, since each byte is converted to 2 chars
  let gameID = "";
  // Just in case there is a collision...
  while (!gameID || gameID in games) {
    gameID = crypto.randomBytes(3).toString("hex").toUpperCase();
  }
  // replace 0 with other characters since it looks the same as 0
  gameID = gameID.replace(/0/g, "G");
  games[gameID] = new Game(this, gameID);
  games[gameID].players[this.id] = players[this.id];
  games[gameID].ownerID = this.id;
  players[this.id].isOwner = true;
  players[this.id].name = data.name;
  players[this.id].gameID = gameID;
  // save the owner socket ID as well as the game ID so that we can
  // check to make sure who the owner is when owner actions take place
  this.emit("newGameCreated", gameID);
  this.join(gameID.toString());
}
