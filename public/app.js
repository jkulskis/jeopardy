
const SpeechToText = {
  result: null,
  init: () => {
    var SpeechRecognition = SpeechRecognition || webkitSpeechRecognition;
    SpeechToText.listener = new SpeechRecognition();
    SpeechToText.listener.onstart = SpeechToText.onstart;
    SpeechToText.listener.onend = SpeechToText.onend;
    SpeechToText.listener.onspeechend = SpeechToText.onspeechend;
    SpeechToText.listener.onresult = SpeechToText.onresult;
    SpeechToText.listener.onerror = SpeechToText.onerror;
    SpeechToText.listener.continuous = false;
    SpeechToText.listener.lang = "en-US";
    SpeechToText.listener.interimResults = false;
  },
  onstart: () => {
    SpeechToText.result = null;
    console.log("Starting Speech Recognition");
  },
  onspeechend: () => {
    console.log("Speech Ended");
    SpeechToText.listener.stop();
  },
  onresult: (event) => {
    let final_transcript = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      final_transcript += event.results[i][0].transcript;
    }
    SpeechToText.result = final_transcript;
    console.log(`Result: ${final_transcript}`);
  },
  onend: () => {
    console.log("Ended Speech Recognition: Buzzing Out");
    IO.socket.emit("buzzOut", {
      gameID: App.Game.gameID,
      answer: SpeechToText.result,
    });
  },
  onerror: (event) => {
    console.log("Error with speech Recognition:");
    console.log(`${event.error}`);
  },
  start: () => {
    SpeechToText.listener.start();
  },
  stop: () => {
    SpeechToText.listener.stop();
  },
};

const IO = {
  init: () => {
    IO.socket = io();
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
    IO.socket.on("inquireOtherAnswers", App.inquireOtherAnswers);
    IO.socket.on("playerTimerStopCountdown", (data) => {
      App.playerTimerStopCountdown(data.playerID);
    });
    IO.socket.on("scoreQuestion", (data) => {
      App.scoreQuestion(data.players);
    });
    IO.socket.on("updateScoreBoardConfirming", (data) => {
      App.updateScoreBoardConfirming(data.playerID, data.playerInfo);
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
    App.Player.id = IO.socket.id;
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
  timer: {
    intervalFunction: null,
    intervalFunctionID: null,
    interval: null,
    currentTime: null,
    clear: () => {
      clearInterval(App.timer.intervalFunctionID);
      App.timer.intervalFunction = null;
      App.timer.interval = null;
      App.timer.currentTime = null;
    },
    stop: () => {
      clearInterval(App.timer.intervalFunctionID);
    },
    start: () => {
      App.timer.intervalFunctionID = setInterval(
        App.timer.intervalFunction,
        App.timer.interval
      );
    },
  },

  setTimer: (interval, currentTime, callback) => {
    App.timer.clear();
    App.timer.interval = interval;
    App.timer.currentTime = currentTime;
    App.timer.intervalFunction = () => {
      currentTime -= interval;
      callback(currentTime);
      if (currentTime === 0) {
        App.timer.stop();
      }
    };
    App.timer.start();
  },

  // runs once when everything loads for the first time
  init: () => {
    App.cacheElements();
    App.showInitScreen();
    App.mobile = window.matchMedia(
      "only screen and (max-width: 760px)"
    ).matches;
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
    App.clueChoose.enable();
  },

  clueChoose: {
    enable: () => {
      App.$doc.on("click", ".cell.clue", function () {
        App.clueClick.onClueClick($(this).attr("id"));
      });
      // if voice recognition is on
      SpeechToText.onend = App.clueChoose.onClueSpoken;
      SpeechToText.init();
      SpeechToText.start();
    },
    disable: () => {
      App.$doc.off("click");
    },
    onClueClick: (clueID) => {
      if (App.Player.hasTurn) {
        IO.socket.emit("clueChosen", {
          gameID: App.Game.gameID,
          clueID: clueID,
        });
      }
    },
    onClueSpoken: () => {
      console.log("On Clue Spoken triggered");
      words = SpeechToText.result.toLowerCase().split(" ");
      value = null;
      for (var valueIndex = words.length - 2; valueIndex >= 0; --valueIndex)
        if (words[valueIndex] === "for") value = parseInt(words[valueIndex + 1]);
      if (value === null) {
        console.log("Couldn't get the value, try again");
        category = words.slice(0, valueIndex).join(" ");
        similarCategory = stringSimilarity.findBestMatch(category, [...App.Game.clueMap.keys()]);
        console.log(similarCategory);
        console.log(value)
      }
    },
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
    $("body").addClass("in-game");
  },

  createBoard: (board, round) => {
    $("#questionScreen").addClass("hidden");
    $("#gameBoard").removeClass("hidden");
    $("#questionBox").empty(); // in case there is lag when we show it again
    multiplier = round === "round1" ? 1 : 2;
    let c = 0;
    $("#gameBoard").empty();
    App.Game.clueMap = new Map();
    for (let category in board) {
      App.Game.clueMap.set(category, {});
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
          `<div id="${clue["id"]}" class="cell clue noselect" value="${
            clue["value"] * multiplier
          }" col="${c}" row="${r}">$${clue["value"] * multiplier}</div>`
        );
        App.Game.clueMap.get(category)[clue["value"] * multiplier] = clue["id"];
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
    App.clueChoose.enable();
  },

  updateScoreBoard: (players, reset) => {
    if (reset) {
      $("#scoreBoard").empty();
    }
    players.forEach((player) => {
      console.log(JSON.stringify(player));
      if (reset) {
        $("#scoreBoard").append(
          `<div id="card-${player.id}" class="score-card"></div>`
        );
        $(`#card-${player.id}`).append(
          `<div class="name-label noselect">${player.name}</div>`
        );
        $(`#card-${player.id}`).append(
          `<div class="score-label noselect">${player.score}</div>`
        );
        $(`#card-${player.id}`).append(
          `<div id="timer-${player.id}" class="playerTimer"></div>`
        );
        for (let i = 0; i < 9; i++)
          $(`#timer-${player.id}`).append(
            `<span class="timerBlock noselect">&nbsp;</span>`
          );
      } else {
        $(`#card-${player.id} .score-label`).text(player.score);
      }
    });
    // $(".name-label").fitText(1.5, {
    //   minFontSize: "12px",
    //   maxFontSize: "22px",
    // });
    // $(".score-label").fitText(1.5, {
    //   minFontSize: "12px",
    //   maxFontSize: "22px",
    // });
  },

  showClue: (question) => {
    // console.log(question);
    $("#gameBoard").addClass("hidden");
    $("#questionBox").empty(); // remove anything left over here
    $("#questionBox").append(
      `<span id="questionText" class="clue-card-span">${question}</span>`
    );
    $("#questionBox").append(
      `<div id="clueDivider" class="divider hidden"></div>`
    );
    $("#questionBox").append(
      `<span id="answerText" class="clue-card-span">&nbsp;</span>`
    );
    $("#questionScreen").removeClass("hidden");
    // $("#questionText").fitText(1, { maxFontSize: "95px" });
    App.Game.setScreen("waitingPlayerBuzz");
    $(document).on("click keyup", (e) => {
      //console.log(e.keyCode);
      if (
        e.keyCode === 32 ||
        (e.handleObj.type === "click" && e.button === 0)
      ) {
        App.pressAnswerBuzzer();
      }
    });
  },

  pressAnswerBuzzer: () => {
    console.log(App.Player.buzzedIn);
    if (App.Game.screen === "waitingPlayerBuzz" && !App.Player.buzzedIn) {
      IO.socket.emit("buzzIn", { gameID: App.Game.gameID });
      // even if they're not the first to buzz in, it will still be answering
      // if someone beat them to it
      App.Game.setScreen("playerBuzzedIn");
    } else if (App.Game.screen === "playerBuzzedIn" && App.Player.buzzedIn) {
      IO.socket.emit("buzzOut", {
        gameID: App.Game.gameID,
        answer: SpeechToText.result,
      });
    }
  },

  playerTimerCountdown: (playerID) => {
    App.timer.clear();
    App.Game.buzzedPlayerID = playerID;
    if (App.Player.id === playerID) {
      App.Player.buzzedIn = true;
      SpeechToText.start();
    }
    playerTimer = $(`#timer-${playerID}`);
    playerTimer.attr("class", "playerTimer time-5000");
    App.setTimer(1000, 5000, (currentTime) => {
      if (!currentTime) playerTimer.attr("class", "playerTimer");
      else playerTimer.attr("class", `playerTimer time-${currentTime}`);
    });
    // start to make timer go
  },

  playerTimerStopCountdown: (playerID) => {
    if (App.Player.id === playerID) {
      SpeechToText.stop();
    }
    App.timer.clear();
    App.Game.buzzedPlayerID = null;
    // no one will be buzzed in if this is sent
    App.Player.buzzedIn = false;
    playerTimer = $(`#timer-${playerID}`);
    // set the timer back to a normal non-buzzed class
    playerTimer.attr("class", "playerTimer");
  },

  inquireOtherAnswers: (data) => {
    // for now, just show a status. May change this later
    App.Game.setScreen("waitingPlayerBuzz");
    App.Game.buzzedPlayerID = null;
    App.Player.buzzedIn = false;
    App.showStatus(`${data.timeout / 1000} seconds left to buzz in`);
    App.setTimer(1000, data.timeout, (currentTime) => {
      if (!currentTime) App.showStatus("Time's up!");
      else App.showStatus(`${currentTime / 1000} seconds left to buzz in`);
    });
  },

  showClueAnswer: (answer) => {
    $("#clueDivider").removeClass("hidden");
    $("#answerText").text(answer);
    // $("#answerText").fitText(1, { maxFontSize: "95px" });
    App.clueChoose.disable();
  },

  updateScoreBoardConfirming: (playerID, playerInfo) => {
    // updates the colors and makes the owner have a more click
    // friendly pallet with the confirming class
    buzzStatus = playerInfo.buzzStatus;
    scoreState = playerInfo.scoreState;
    score = playerInfo.score;
    if (App.Player.isOwner) $(`#card-${playerID}`).addClass("confirming");
    $(`#card-${playerID} .score-label`).attr(
      "class",
      `score-label ${scoreState} noselect`
    );
    $(`#card-${playerID} .score-label`).text(score);
  },

  scoreQuestionClick: {
    enable: () => {
      $(".score-card.confirming").on("click", (e) => {
        // if (e.target != this) return; // on the child
        if (e.button === 0) {
          playerID = e.target.closest(".score-card").id.slice(5);
          IO.socket.emit("modifyPlayerScore", {
            gameID: App.Game.gameID,
            playerID: playerID,
          });
        }
      });
    },
    disable: () => {
      $(".score-card.confirming").off("click");
    },
  },

  clueCompletedPress: {
    enable: () => {
      App.$doc.on("click keyup", (e) => {
        // space...may change this later
        if (e.keyCode === 32 || e.button === 0)
          if (e.button === 0) {
            if (App.mobile) {
              if (!e.target.matches("#questionScreen, #questionScreen *"))
                return;
            } else {
              // allow copying the text
              if (!e.target.matches("#questionScreen")) return;
            }
          }
        IO.socket.emit("clueCompleted", {
          gameID: App.Game.gameID,
          reset: true,
        });
        App.scoreQuestionClick.disable();
        App.clueCompletedPress.disable();
      });
    },
    disable: () => {
      App.$doc.off("click keyup");
    },
  },

  scoreQuestion: (players) => {
    for (let playerID in players) {
      App.updateScoreBoardConfirming(playerID, players[playerID]);
    }
    App.scoreQuestionClick.enable();
    App.clueCompletedPress.enable();
  },

  Player: {
    // player that starts the game
    id: null,
    isOwner: false,
    hasTurn: false,
    buzzedIn: false,
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
    clueMap: null,

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

SpeechToText.init();
IO.init();
App.init();
