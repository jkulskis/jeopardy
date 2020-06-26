const IO = {
  init: () => {
    IO.socket = io();
    App.Player.sockID = IO.sockID;
    IO.bindEvents();
  },

  bindEvents: () => {
    // connection
    IO.socket.on("connected", IO.onConnected);
    // intro screen
    IO.socket.on("newGameCreated", IO.onNewGameCreated);
    IO.socket.on("gameJoined", IO.onGameJoined);
    // lobby
    IO.socket.on("updateLobby", IO.onUpdateLobby);
    // gameplay
    IO.socket.on("startGame", IO.onStartGame);
    IO.socket.on("createBoard", IO.onCreateBoard);
    IO.socket.on("updateScoreBoard", IO.onUpdateScoreBoard);
    IO.socket.on("showClue", IO.onShowClue);
    IO.socket.on("showClueAnswer", IO.onShowClueAnswer);
    IO.socket.on("playerHasTurn", IO.onTurn);
    IO.socket.on("playerTimerCountdown", IO.onPlayerTimerCountdown);
    IO.socket.on("inquireOtherAnswers", (data) => {
      App.inquireOtherAnswers(data);
    });
    // other
    IO.socket.on("makeOwner", IO.onMakeOwner);
    IO.socket.on("showStatus", IO.onShowStatus);
    // debug/errors
    IO.socket.on("debug", IO.debug);
    IO.socket.on("showError", IO.onError);
  },

  onConnected: (data) => {
    console.log(data.message);
  },

  onMakeOwner: () => {
    App.Player.isOwner = true;
  },

  debug: (data) => {
    if (typeof data === "string") console.log(data);
    else {
      console.log(`${JSON.stringify(data, undefined, 2)}`);
    }
  },

  onError: (data) => {
    App.showError(data.error);
  },

  onNewGameCreated: (gameID) => {
    App.Player.isOwner = true;
    App.Player.hasTurn = true;
    App.Game.init(gameID, true);
    App.showLobbyScreen(gameID);
  },

  /**
   * @param data {gameID: *, playerNames: *, error: *}
   */
  onGameJoined: (data) => {
    App.showLobbyScreen(data.gameID, data.playerNames);
    App.Game.init(data.gameID, false);
  },
  /**
   * @param {names: *, reset: bool} data
   */
  onUpdateLobby: (data) => {
    if (data.reset) App.resetPlayerNames();
    data.names.forEach((name) => App.addPlayerName(name));
    App.lobbyOwnerToggle();
  },

  onStartGame: (data) => {
    App.startGame();
  },

  /**
   *
   * @param {board: board to create, round: round we are on} data
   */
  onCreateBoard: (data) => {
    // reset having a trun, emit to the one who has a turn and then
    // remove the nohover class
    App.Player.hasTurn = false;
    App.createBoard(data.board, data.round);
    $(".cell.clue").addClass("nohover");
  },

  onTurn: (data) => {
    App.Player.hasTurn = true;
    $(".cell.clue").removeClass("nohover");
  },

  onUpdateScoreBoard: (data) => {
    App.updateScoreBoard(data.players, data.reset);
  },

  onShowClue: (data) => {
    App.showClue(data.question);
  },

  onShowClueAnswer: (data) => {
    App.showClueAnswer(data.answer);
  },

  onShowStatus: (data) => {
    App.showStatus(data.message);
  },

  onPlayerTimerCountdown: (data) => {
    App.playerTimerCountdown(data.playerID);
  },
};

const App = {
  // runs once when everything loads for the first time
  init: () => {
    App.cacheElements();
    App.showInitScreen();
    App.bindEvents();

    // initialize the fastclick library
    FastClick.attach(document.body);
  },
  // creates references to important on-screen elements
  cacheElements: () => {
    App.$doc = $(document);

    // Templates
    App.$gameArea = $("#gameArea");
    App.$templateIntroScreen = $("#intro-screen-template").html();
    App.$templateLobby = $("#lobby-template").html();
    App.$templateGamePlay = $("#gamePlay-template").html();
  },

  showError: (error) => {
    if ($("#errorMessage").length) {
      $("#errorMessage").stop().show().animate({ opacity: "100" }).text(error);
      setTimeout(() => $("#errorMessage").fadeOut(3000), 500);
    } else {
      alert(error);
    }
  },

  showStatus: (message) => {
    $("#gameStatus").text(message);
  },

  showInitScreen: () => {
    App.$gameArea.html(App.$templateIntroScreen);
    // check first so as to not get rid of the placeholder if the name is empty
    if (App.Player.name) $("#playerName").val(App.Player.name);
  },

  showLobbyScreen: (gameID, playerNames) => {
    App.$gameArea.html(App.$templateLobby);
    if (playerNames !== undefined) {
      playerNames.forEach((name) => App.addPlayerName(name));
      App.addPlayerName(App.Player.name);
    } else {
      // if no other names, must be creating a game, and must be owner
      App.addPlayerName(App.Player.name + " (Owner)");
    }

    $("#gameURL").text(window.location.href);
    $("#gameID").text(gameID);
    App.lobbyOwnerToggle();
  },

  lobbyOwnerToggle: () => {
    // only the owner can start the game
    if (App.Player.isOwner) {
      $("#btnStartGame").show();
    } else {
      $("#btnStartGame").hide();
    }
  },

  resetPlayerNames: () => {
    $("#players").empty();
  },

  addPlayerName: (name) => {
    $("#players").append(`<li>${name}</li>`);
  },

  bindEvents: () => {
    // init screen
    App.$doc.on("click", "#btnCreateGame", App.onCreateClick);
    App.$doc.on("click", "#btnLeaveGame", App.onLeaveClick);
    App.$doc.on("click", "#btnJoinGame", App.onJoinClick);
    // lobby screen
    App.$doc.on("click", "#btnStartGame", App.onStartClick);
    App.$doc.on("change", "#playerName", App.Player.saveName);
    // gamePlay screen
    App.$doc.on("click", ".cell.clue", function () {
      App.onClueClick($(this).attr("id"));
    });
  },

  onClueClick: (clueID) => {
    if (App.Player.hasTurn)
      IO.socket.emit("clueChosen", { gameID: App.Game.gameID, clueID: clueID });
  },

  onStartClick: () => {
    IO.socket.emit("startGame", { gameID: App.Game.gameID });
  },

  onCreateClick: () => {
    IO.socket.emit("createGame", { name: App.Player.name });
  },

  onJoinClick: () => {
    IO.socket.emit("joinGame", {
      name: App.Player.name,
      gameID: $("#gameID").val(),
    });
  },

  onLeaveClick: () => {
    IO.socket.emit("leaveGame", { gameID: App.Game.gameID });
    App.Game.reset();
    App.showInitScreen();
  },

  startGame: () => {
    App.$gameArea.html(App.$templateGamePlay);
  },

  createBoard: (board, round) => {
    $("#questionScreen").addClass("hidden");
    $("#questionBox").empty(); // in case there is lag when we show it again
    multiplier = round === "round1" ? 1 : 2;
    let c = 0;
    $("#gameBoard").empty();
    for (let category in board) {
      $("#gameBoard").append(
        `<div id="c${c}" col="${c}" class="category"></div>`
      );
      $(`#c${c}`).append(
        `<div id="cheader${c}" class="cell header noselect" col="${c}">${category}</div>`
      );
      // clue[0] is the ID of this question's clue
      let r = 0;
      board[category].forEach((clue) => {
        $(`#c${c}`).append(
          `<div id="${
            clue["id"]
          }" class="cell clue noselect" col="${c}" row="${r}">$${
            clue["value"] * multiplier
          }</div>`
        );
        if (clue["answered"] === 1) {
          clueCell = $(`#${clue["id"]}`);
          clueCell.addClass("answered");
          clueCell.empty();
        }
        r += 1;
      });
      c += 1;
    }
    $(".cell.header").fitText(0.8);
    $(".cell.clue").fitText(0.4);
  },

  updateScoreBoard: (players, reset) => {
    if (reset) {
      players.forEach((player) => {
        console.log(JSON.stringify(player));
        $("#scoreBoard").append(
          `<div id="${player.id}" class="score-card"></div>`
        );
        $(`#${player.id}`).append(
          `<div class="name-label">${player.name}</div>`
        );
        $(`#${player.id}`).append(
          `<div class="score-label">${player.score}</div>`
        );
        $(`#${player.id}`).append(
          `<div id="timer-${player.id}" class="timer"></div>`
        );
        for (let i = 0; i < 9; i++)
          $(`#timer-${player.id}`).append(
            `<span class="timerBlock">&nbsp;</span>`
          );
      });
    }
    $(".name-label").fitText(1.5, {
      minFontSize: "12px",
      maxFontSize: "22px",
    });
    $(".score-label").fitText(1.5, {
      minFontSize: "12px",
      maxFontSize: "22px",
    });
  },

  showClue: (question) => {
    // console.log(question);
    $("#questionBox").empty(); // remove anything left over here
    $("#questionScreen").removeClass("hidden");
    $("#questionBox").append(
      `<span id="questionText" class="clue-card-span">${question}</span>`
    );
    $("#questionBox").append(
      `<div id="clueDivider" class="divider hidden"></div>`
    );
    $("#questionBox").append(
      `<span id="answerText" class="clue-card-span">&nbsp;</span>`
    );
    $("#questionText").fitText(1, { maxFontSize: "95px" });
    App.Game.setScreen("qWaiting");
    $(document).on("keyup", (e) => {
      //console.log(e.keyCode);
      if (e.keyCode === 32) {
        App.pressAnswerBuzzer();
      }
    });
  },

  pressAnswerBuzzer: () => {
    if (App.Game.screen === "qWaiting" && !App.Player.buzzedIn) {
      // App.getClueAnswer();
      IO.socket.emit("buzzIn", { gameID: App.Game.gameID });
      // even if they're not the first to buzz in, it will still be answering
      // if someone beat them to it
      App.Game.setScreen("qAnswering");
      // $(document).off("keyup");
      // App.clueComplete();
    }
  },

  playerTimerCountdown: (playerID) => {
    App.Game.buzzedPlayerID = playerID;
    console.log("5s countdown starts now");
    // start to make timer go
  },

  inquireOtherAnswers: (data) => {
    // for now, just show a status. May change this later
    App.Game.setScreen("qWaiting");
    App.Game.buzzedPlayerID = null;
    countdown = (s) => {
      setTimeout((s) => {
        App.showStatus(`${s} seconds to buzz in a different answer`);
        if (s) countdown(s - 1);
      }, 1000);
    };
    countdown(3);
  },

  getClueAnswer: () => {
    if ($("answerText").children().length === 0)
      IO.socket.emit("getClueAnswer", { gameID: App.Game.gameID });
  },

  showClueAnswer: (answer) => {
    $("#clueDivider").removeClass("hidden");
    $("#answerText").text(answer);
    $("#answerText").fitText(1, { maxFontSize: "95px" });
  },

  clueComplete: () => {
    IO.socket.emit("clueComplete", { gameID: App.Game.gameID });
  },

  Player: {
    // player that starts the game
    // TODO: random player that is still in the game after previoujs owner leaves
    isOwner: false,
    hasTurn: false,
    buzzedIn: false,
    // socket.io socket object id. Unique for each player.
    // Generated by the browser when the player initially connects to the server
    sockID: "",
    // screen name of the player
    name: "",

    saveName: () => {
      App.Player.name = $("#playerName").val();
    },
  },
  Game: {
    // identical to ID of the socket.io room of the game
    gameID: null,
    screen: null,
    buzzedPlayerID: null,

    init: (gameID, isOwner) => {
      App.Game.gameID = gameID;
      App.Player.isOwner = isOwner;
    },

    reset: () => {
      App.Game.gameID = null;
      App.Game.screen = null;
      App.Player.isOwner = false;
    },

    setScreen: (screen) => {
      App.Game.screen = screen;
    },
  },
};

IO.init();
App.init();
