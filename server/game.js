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

const gameStatus = {
  LOBBY: "lobby", // game is still in lobby phase
  PLAYERBUZZED: "playerBuzzed", // a player buzzed in
  WAITINGBUZZ: "waitingBuzz", // we are waiting for a player to buzz in
  WAITINGCLUE: "waitingClue", // we are waiting for a clue to be chosen
  SCORING: "scoring", // the round is being scored
};

function Game(socket, gameID) {
  this.id = gameID;
  this.ownerID = socket.id;
  this.numAnsweredQuestions = 0;
  this.roundSizes = { round1: 0, round2: 0 };
  // id of the player who's turn it is (they get to choose the next clue)
  this.turnPlayerID = socket.id;
  // set this to the player ID we want to change to...only actually set the new
  // turn player ID once the scoring is complete
  this.newTurnPlayerID = null;
  // id of the player that is currently buzzed in
  this.buzzedPlayerID = null;
  // ids of ther players that have answered the last question
  this.buzzedPlayerIDs = new Map();
  this.currentClueID = null;
  this.currentClueValue = null;
  this.currentRound = "round1";
  this.players = {};
  this.getNumPlayers = () => Object.keys(this.players).length;
  this.status = gameStatus.LOBBY;
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
      round = i < 6 ? "round1" : "round2";
      clientRound = this.clientBoard[round];
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
        this.roundSizes[round] += 1;
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
    inquireOtherAnswers({ gameID: this.id });
  };
  this.buzzedPlayerTimeoutHandler = null;

  this.waitingForAnswersTimeout = () => {
    sendClueAnswer({ gameID: this.id });
    emitScoreQuestion({ gameID: this.id });
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
              if (
                games[players[socket.id].gameID].status === gameStatus.LOBBY
              ) {
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
  if (name.length > 19) {
    socket.emit("showError", {
      error: "Name must be less than 20 characters long",
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
  socket.on("buzzOut", buzzOut);
  socket.on("modifyPlayerScore", modifyPlayerScore);
  socket.on("clueCompleted", afterClueCompleted);
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
  updateScoreBoard({ gameID: data.gameID, reset: true });
  emitBoard({ pSock: pSock, gameID: data.gameID, round: "round1" });
}

/**
 *
 * @param {gameID: id of game, round: *} data
 */
function emitBoard(data) {
  game = games[data.gameID];
  clientBoard = game.clientBoard;
  roundChanged = false;
  if (game.numAnsweredQuestions === game.roundSizes[game.currentRound]) {
    if (game.currentRound === "round1") game.currentRound = "round2";
    game.numAnsweredQuestions = 0;
    roundChanged = true;
    if (game.getNumPlayers() > 1) {
      game.newTurnPlayerID = null;
      for (let playerID in game.players) {
        if (
          game.newTurnPlayerID === null ||
          game.players[game.newTurnPlayerID].score >
            game.players[playerID].score
        )
          game.newTurnPlayerID = playerID;
      }
    }
  }
  io.to(data.gameID).emit("createBoard", {
    board: clientBoard[game.currentRound],
    round: game.currentRound,
  });
  io.to(data.gameID).emit("debug", clientBoard);
  if (game.newTurnPlayerID) {
    if (game.newTurnPlayerID === game.turnPlayerID) game.newTurnPlayerID = null;
    else game.turnPlayerID = game.newTurnPlayerID;
  }
  io.to(game.turnPlayerID).emit("playerHasTurn");
  turnPlayerName = game.players[game.turnPlayerID].name;
  if (game.getNumPlayers() > 1) {
    if (roundChanged) {
      io.to(data.gameID).emit("showStatus", {
        message: `Welcome to Round 2, points are doubled. ${turnPlayerName} now has Control of the Board!`,
      });
    } else if (game.newTurnPlayerID) {
      io.to(data.gameID).emit("showStatus", {
        message: `${turnPlayerName} now has Control of the Board!`,
      });
    } else {
      io.to(data.gameID).emit("showStatus", {
        message: `${turnPlayerName}'s turn!`,
      });
    }
  } else {
    if (roundChanged) {
      io.to(data.gameID).emit("showStatus", {
        message: "Welcome to Round 2, points are doubled!",
      });
    } else {
      io.to(data.gameID).emit("showStatus", {
        message: "Choose a Clue",
      });
    }
  }
  game.status = gameStatus.WAITINGCLUE;
}

/**
 *
 * @param {gameID: *, reset: true if reforming the score board} data
 */
function updateScoreBoard(data) {
  playerScores = [];
  for (let playerID in games[data.gameID].players) {
    player = games[data.gameID].players[playerID];
    playerScores.push({
      id: player.id,
      name: player.name,
      score: player.score,
    });
  }
  io.to(data.gameID).emit("updateScoreBoard", {
    reset: data.reset,
    players: playerScores,
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
  if (game.clueMap.get(clueID).answered) return 1;
  if (game.status !== gameStatus.WAITINGCLUE) return 1;
  // DEBUG
  io.to(data.gameID).emit("debug", "10s waiting for answers timeout");
  game.waitingForAnswersTimeoutHandler = createTimeout(
    game.waitingForAnswersTimeout,
    10000
  );
  io.to(data.gameID).emit("inquireOtherAnswers", { timeout: 10000 });
  game.currentClueID = clueID;
  game.currentClueValue = game.clueMap.get(game.currentClueID).value;
  if (game.currentRound === "round2") game.currentClueValue *= 2;
  clue = game.clueMap.get(clueID);
  clue.answered = 1;
  clue.clientClue.answered = 1; // mark as answered since it will be "answered" no matter what happens after it is shown
  game.numAnsweredQuestions += 1;
  // sending as object just in case we want to send other info like show #, date, etc.
  io.to(data.gameID).emit("showClue", {
    question: clue.question,
  });
  game.status = gameStatus.WAITINGBUZZ;
}

function buzzIn(data) {
  if (errorDataGamePlayer(data, this)) return 1;
  game = games[data.gameID];
  if (game.buzzedPlayerID !== null) return 1;
  if (game.buzzedPlayerIDs.has(this.id)) return 1; // can't buzz in twice
  if (game.status !== gameStatus.WAITINGBUZZ) return 1;
  game.status = gameStatus.PLAYERBUZZED;
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
  // set the buzz status to timeout...if they end up buzzing out, change
  // this to complete
  game.buzzedPlayerIDs.set(game.buzzedPlayerID, {
    name: buzzedPlayerName,
    buzzStatus: "timeout",
  });
  // start the player's personal timer to answer the question
  game.buzzedPlayerTimeoutHandler = createTimeout(
    game.buzzedPlayerTimeout,
    5000
  );
}

function gradeAnswer(data) {
  playerAnswer = data.answer
    .replace(/what is\s/g, "")
    .replace(/who is/g, "")
    .replace(/the/g, "")
    .replace(/ a /g, "")
    .replace(/\s/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  game = games[data.gameID];
  correctAnswer = game.clueMap.get(game.currentClueID).answer.toLowerCase();
  // planning on making this more robust + room for error
  console.log(correctAnswer);
  console.log(playerAnswer);
  if (correctAnswer.includes(playerAnswer)) {
    return true; // correct
  }
  return false; // incorrect
}

function buzzOut(data) {
  if (errorDataGamePlayer(data, this)) return 1;
  game = games[data.gameID];
  if (game.status !== gameStatus.PLAYERBUZZED) return 1;
  if (game.buzzedPlayerID !== this.id) return 1;

  io.to(data.gameID).emit("playerTimerStopCountdown", {
    playerID: game.buzzedPlayerID,
  });
  buzzedPlayerName = game.players[game.buzzedPlayerID].name;
  while (hasKeys(data, "answer") && data.answer !== null) {
    if (!gradeAnswer(data)) break;
    io.to(data.gameID).emit("showStatus", {
      message: `${buzzedPlayerName} Answered Correctly!`,
    });
    sendClueAnswer({ gameID: game.id });
    game.buzzedPlayerIDs.set(game.buzzedPlayerID, {
      name: buzzedPlayerName,
      buzzStatus: "correct",
    });
    return emitScoreQuestion({ gameID: game.id });
  }
  io.to(data.gameID).emit("showStatus", {
    message: `${buzzedPlayerName} Finished Answering!`,
  });
  // stop the timeout for all answers (timeout if no one buzzes in)
  game.buzzedPlayerTimeoutHandler.clear();
  game.buzzedPlayerIDs.set(game.buzzedPlayerID, {
    name: buzzedPlayerName,
    buzzStatus: "uncertain",
  });
  inquireOtherAnswers({ gameID: data.gameID });
}

function inquireOtherAnswers(data) {
  game = games[data.gameID];
  game.buzzedPlayerID = null;
  if (game.getNumPlayers() === game.buzzedPlayerIDs.size) {
    game.gameStatus = gameStatus.SCORING;
    sendClueAnswer({ gameID: game.id });
    emitScoreQuestion({ gameID: game.id });
    return 0;
  }
  game.status = gameStatus.WAITINGBUZZ;
  // wait a second so that the time's up message doesn't get covered
  setTimeout(() => {
    // could have buzzed in during this 1 second timeframe
    // if that is so, then don't need to wait for new answers
    if (game.status !== gameStatus.WAITINGBUZZ) return;
    io.to(game.id).emit("inquireOtherAnswers", { timeout: 3000 });
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
}

function emitScoreQuestion(data) {
  game = games[data.gameID];
  for (let [playerID, playerInfo] of game.buzzedPlayerIDs.entries()) {
    if (["timeout", "uncertain"].includes(playerInfo.buzzStatus)) {
      // early guess they lose points if timeout...having it red automatically
      // should also discourage players from not buzzing out, which should
      // ultimately make the games run faster
      game.players[playerID].score -= game.currentClueValue;
      game.buzzedPlayerIDs.get(playerID)["scoreState"] = "negative";
    } else {
      game.players[playerID].score += game.currentClueValue;
      game.buzzedPlayerIDs.get(playerID)["scoreState"] = "positive";
    }
    game.buzzedPlayerIDs.get(playerID)["score"] = game.players[playerID].score;
  }
  updateScoreBoard({ gameID: data.gameID });
  io.to(game.id).emit("scoreQuestion", {
    players: Object.fromEntries(game.buzzedPlayerIDs),
  });
  game.status = gameStatus.SCORING;
  message = game.buzzedPlayerIDs.size === 0 ? "" : "Confirming Player Scores:";
  setTimeout(() => {
    if (game.status === gameStatus.WAITINGCLUE) return;
    io.to(game.id).emit("showStatus", {
      message: `${message} Waiting for game owner`,
    });
    io.to(game.ownerID).emit("showStatus", {
      message: `${message} Press Space to Continue`,
    });
  }, 0);
}

function modifyPlayerScore(data) {
  if (errorDataGamePlayer(data, this)) return 1;
  game = games[data.gameID];
  if (game.status !== gameStatus.SCORING) return 1;
  if (game.ownerID !== this.id) return 1;
  if (game.buzzedPlayerIDs.has(data.playerID));

  playerScoreState = game.buzzedPlayerIDs.get(data.playerID)["scoreState"];
  newPlayerScoreState = null;
  if (playerScoreState === "negative") {
    newPlayerScoreState = "positive";
    if (game.newTurnPlayerID === data.playerID) game.newTurnPlayerID = null;
    game.players[data.playerID].score += 2 * game.currentClueValue;
  } else if (playerScoreState === "neutral") {
    newPlayerScoreState = "negative";
    if (game.turnPlayerID !== data.playerID)
      game.newTurnPlayerID = data.playerID;
    game.players[data.playerID].score -= game.currentClueValue;
  } else if (playerScoreState === "positive") {
    if (game.newTurnPlayerID === data.playerID) game.newTurnPlayerID = null;
    newPlayerScoreState = "neutral";
    game.players[data.playerID].score -= game.currentClueValue;
  }
  game.buzzedPlayerIDs.get(data.playerID)["scoreState"] = newPlayerScoreState;
  game.buzzedPlayerIDs.get(data.playerID)["score"] =
    game.players[data.playerID].score;
  io.to(game.id).emit("updateScoreBoardConfirming", {
    playerID: data.playerID,
    playerInfo: game.buzzedPlayerIDs.get(data.playerID),
  });
}

function afterClueCompleted(data) {
  if (errorDataGamePlayer(data, this)) return 1;
  game = games[data.gameID];
  if (game.ownerID !== this.id) return 1;
  if (game.currentClueID === null) return 1;
  game.currentClueID = null;
  game.currentClueValue = null;
  game.buzzedPlayerIDs = new Map();
  updateScoreBoard({ gameID: data.gameID, reset: true });
  emitBoard({
    pSock: this,
    gameID: game.id,
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
