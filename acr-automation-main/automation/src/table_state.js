const EventEmitter = require("events");
const createLogger = require("./utils/logger.js");
const AIAPIClient = require("./aiapi/client.js");
const AIActions = require("./aiapi/protocol.js");
const config = require("./utils/config.js");

// AI
function sortSeatsBySmallBlind(participants, smallBlindSeat) {
    // Sort participants in ascending order to ensure consistent ordering
    const sortedSeats = [...participants].sort((a, b) => a - b);

    // Handle edge case: Small blind is not found in participants
    const smallBlindIndex = sortedSeats.indexOf(smallBlindSeat);
    if (smallBlindIndex === -1) {
        throw new Error(`Small blind seat not found in participants: ${participants.join(",")}`);
    }

    // Return seats ordered starting from the small blind
    return [...sortedSeats.slice(smallBlindIndex), ...sortedSeats.slice(0, smallBlindIndex)];
}

/**
 * Represents the state of a poker hand, including player information, current bets, and card details.
 */
class HandState {
    /**
     * Creates an instance of the class with the specified payload.
     *
     * @param {Object} payload - Forwarded payload from 'HandStart' event.
     * @param {Map} allPlayers - List of all player states at the current point.
     */
    constructor({handNumber, participants, dealerSeat}, allPlayers) {
        this.handNumber = handNumber;
        this.players = new Map(); // (Participating) Seat to player info
        this.street = "None";
        this.seatsThatPosted = [];
        this.holeCards = null;
        this.communityCards = [];
        this.sbSeat = null;
        this.dealerSeat = dealerSeat;
        this.availableActions = new Map();
        this.actionTimestamp = null; // Last action timestamp provided by 'RequestSelection'
        this.actionDate = null;
        this.betChips = 0;
        if (participants !== undefined) {
            this.players = this._initializePlayers(participants, allPlayers);
        }
        this.foldOverride = false; // Flag to cause hero to fold on the next action sequence
        this.waitingForAction = false; // Is the table currently waiting for hero to act?
    }

    /**
     * Initializes the player map based on participants and allPlayers data.
     * @param {Array} participants - Array of seats participating in the hand.
     * @param {Map} allPlayers - Map of all players.
     * @return {Map} A map with seat numbers as keys and player details as values.
     */
    _initializePlayers(participants, allPlayers) {
        const players = new Map();
        participants.forEach((seat) => {
            const playerData = allPlayers.get(seat);
            players.set(seat, this._createPlayer(seat, playerData));
        });
        return players;
    }

    /**
     * Creates a player object with standardized properties.
     * @param {number|string} seat - The seat of the player.
     * @param {Object} playerData - The player information from allPlayers.
     * @return {Object} A player object with relevant properties.
     */
    _createPlayer(seat, playerData) {
        return {
            name: playerData.name,
            country: playerData.country,
            stack: playerData.stack,
            initialStack: playerData.stack,
            cards: [],
            seat,
        };
    }

    /**
     * Sorts and returns the player seat keys based on the small blind position.
     *
     * @return {Array} An array of player seat keys sorted by the small blind position.
     */
    seatsFromSb() {
        const playerKeys = Array.from(this.players.keys());
        return sortSeatsBySmallBlind(playerKeys, this.sbSeat);
    }

    /**
     * Updates the properties of a player at the specified seat with the provided updates.
     *
     * @param {number|string} seat - The identifier for the seat of the player to update.
     * @param {Object} updates - An object containing key-value pairs of properties to update on the player.
     * @return {void}
     */
    updatePlayer(seat, updates) {
        const player = this.players.get(seat);
        if (player) {
            Object.entries(updates).forEach(([key, value]) => {
                if (value !== undefined) {
                    player[key] = value;
                }
            });
        }
    }
}

/**
 * Represents the state of a Table with a specific `socketId` and `tableId`, and provides event-driven
 * functionalities through its `EventEmitter` base class. This class is designed to manage and
 * process network traffic related to the table's state.
 *
 * ACR is strange in that we must manage state on two layers.
 */
class TableState extends EventEmitter {
    constructor(socketId, tableId, externalId) {
        super();
        this.socketId = socketId;
        this.tableId = tableId;
        this.externalId = externalId;
        this.logger = createLogger(`table_state:${this.socketId}`);
        this.hand = null;  // Data specific to the current hand in play
        this.ai = null; // AI API connection
        this.smallBlind = 0;
        this.bigBlind = 0;
        this.heroSeat = 0;
        this.players = new Map(); // Seat to player info
    }

    /**
     * Updates the details of a player at the specified seat in both the table
     * and hand contexts.
     *
     * @param {number} seat - The seat number of the player to update.
     * @param {Object} playerInfo - An object containing the player's updated information.
     * @param {string} [playerInfo.name] - The updated name of the player (if provided).
     * @param {string} [playerInfo.country] - The updated country of the player (if provided).
     * @param {number} [playerInfo.stack] - The updated chip stack of the player (if provided).
     * @return {void}
     */
    updatePlayer(seat, {name, country, stack}) {
        // Update the local state
        const tablePlayer = this.players.get(seat);

        if (name !== undefined) {
            tablePlayer.name = name;
        }
        if (country !== undefined) {
            tablePlayer.country = country;
        }
        if (stack !== undefined) {
            tablePlayer.stack = stack;
        }

        if (this.hand) {
            this.hand.updatePlayer(seat, {name, country, stack});
        }

        //this.logger.debug(`[${seat}] ${tablePlayer.name} (${tablePlayer.country}) with ${tablePlayer.stack} chips`);
    }

    /**
     * Sets the hand's fold override to true and logs a warning with a specified reason.
     *
     * @param {string} reason - The reason for forcing the hand fold override.
     * @return {void}
     */
    async setHandFoldOverride(reason) {
        if (this.hand.waitingForAction && this.hand.street !== "Showdown") {
            this.hand.foldOverride = true;
            this.logger.warn(`Hand is in a buggy state (${reason}); forcing fold override`);
            await this.executeAIAction(AIActions.FOLD);
        }
    }

    async onTableState(payload) {
        const {level, maxSeatCount, sitters = [], mySeat, isParticipant = false, handNumber} = payload;

        // Update blinds
        this.smallBlind = level.smallBlind;
        this.bigBlind = level.bigBlind;
        this.logger.info(`Stakes: ${this.smallBlind}/${this.bigBlind}`);

        // Initialise all seats, even if unoccupied
        for (let i = 0; i < maxSeatCount; ++i) {
            this.players.set(i, {});
        }

        // Initialise sitting players
        for (const sitter of sitters) {
            this.updatePlayer(sitter.seat, {
                name: sitter.name,
                country: sitter.country,
                stack: sitter.chip,
            });
        }

        // Update the hero seat if provided
        if (mySeat) {
            this.heroSeat = mySeat;
            this.logger.info(`Hero seat: ${this.heroSeat} (via 'TableState')`);
        }

        // If we are already sat, then fold
        if (isParticipant) {
            this.logger.info("Hero is already participating in this hand");
            this.hand = new HandState({handNumber});
            this.setHandFoldOverride("ALREADY_PARTICIPATING");
        }
    }

    async onTryJoin(payload) {
        if (payload.request.tableSeat !== undefined) {
            this.heroSeat = payload.request.tableSeat;
            this.logger.info(`Hero seat: ${this.heroSeat} (via 'TryJoin')`);
        } else {
            this.logger.debug(`Hero seat not provided during 'TryJoin'`);
        }
    }

    async onHandStart(payload) {
        if (!payload.isParticipant) {
            return;
        }

        this.hand = new HandState(payload, this.players);
        this.logger.info(`Hand started: ${this.hand.handNumber} with ${this.hand.players.size} players`);

        this._disconnectAI();
    }

    async onHandResult(payload) {
        const {
            potResults = [],
            statistic = {},
            lastChips = {},
            winnerHands = {},
            loserHands = {},
        } = payload;

        if (this.hand) {
            if (this.hand.foldOverride) {
                this.logger.info("HandResult but we have fold override enabled, canceling")
                return;
            }
        }

        // Evaluate the updated stack for each player
        for (const [seat, chips] of Object.entries(lastChips)) {
            // seat is provided as a string, must convert to number
            this.updatePlayer(Number(seat), {stack: chips});
        }

        if (this.hand) {
            const showdownPlayers = this.hand.seatsFromSb().map(seat => {
                return {
                    pid: seat.toString(),
                    payoff: 0,
                    rake: 0,
                    showdown_cards: [],
                }
            });

            // Collect rakes
            for (const {rake, winners} of potResults) {
                const rakeEach = rake / winners.length;

                // Distribute raked amount to each player
                for (const {seat} of winners) {
                    const index = showdownPlayers.findIndex(player => player.pid === seat.toString());
                    // Represent rake as negative
                    showdownPlayers[index].rake -= rakeEach;
                }
            }

            // Collect hands
            for (const {seat, holeCards} of Object.values(winnerHands)) {
                const index = showdownPlayers.findIndex(player => player.pid === seat.toString());
                showdownPlayers[index].showdown_cards = holeCards;
            }
            for (const {seat, holeCards} of Object.values(loserHands)) {
                const index = showdownPlayers.findIndex(player => player.pid === seat.toString());
                showdownPlayers[index].showdown_cards = holeCards;
            }

            // Collect payoffs
            for (const [seat, stat] of Object.entries(statistic)) {
                const index = showdownPlayers.findIndex(player => player.pid === seat);

                if (stat.winChip !== undefined) {
                    // Player won chips, calculate the payoff
                    // win - bet is does take into account rake, so we must account for that too
                    showdownPlayers[index].payoff = stat.winChip - stat.totalBet - showdownPlayers[index].rake;
                } else if (stat.lossChip !== undefined) {
                    // Player lost chips, represent as negative
                    showdownPlayers[index].payoff = -stat.lossChip;
                }
            }

            // Send showdown information then disconnect
            this.aiShowdown(showdownPlayers).then(() => this._disconnectAI());
        }

        this.hand = null;
    }

    async onRound(payload) {
        const STAGE_MAPPING = {
            "FirstBet": "Preflop",
            "SecondBet": "Flop",
            "ThirdBet": "Turn",
            "FourthBet": "River",
            "Showdown": "Showdown",
        };

        this.hand.street = STAGE_MAPPING[payload.currentRound] || "Unknown";
        this.logger.info(`Stage changed to '${this.hand.street}'`);
    }

    async onSelectionResult(payload) {
        const {seat, action, playerChip} = payload;
        const {flag, chip} = action;

        const player = this.players.get(seat);

        // Update to the new player state
        this.updatePlayer(seat, {stack: playerChip});

        if (this.hand && seat === this.heroSeat) {
            this.hand.waitingForAction = false;
        }

        switch (flag) {
            case "PostDead":
            case "PostBlind": {
                if (this.hand) {
                    this.hand.seatsThatPosted.push(seat);
                    this.logger.info(`[${seat}] ${player.name} posted a blind`);
                }
                break;
            }
            case "Fold": {
                this.logger.info(`[${seat}] ${player.name} folded`);
                await this.aiPlayerMove(seat, AIActions.FOLD);
                break;
            }
            case "Call": {
                this.logger.info(`[${seat}] ${player.name} called`);
                await this.aiPlayerMove(seat, AIActions.CALL);
                break;
            }
            case "Check": {
                this.logger.info(`[${seat}] ${player.name} checked`);

                if (player.stack === 0) {
                    // This is actually an allin
                    await this.aiPlayerMove(seat, AIActions.ALLIN, chip);
                } else {
                    await this.aiPlayerMove(seat, AIActions.CHECK, chip);
                }

                break;
            }
            case "Bet": {
                this.logger.info(`[${seat}] ${player.name} bet ${chip} chips`);

                if (player.stack === 0) {
                    // This is actually an allin
                    await this.aiPlayerMove(seat, AIActions.ALLIN, chip);
                } else {
                    await this.aiPlayerMove(seat, AIActions.BET, chip);
                }

                break;
            }
            case "RaiseTo": {
                this.logger.info(`[${seat}] ${player.name} raised to ${chip} chips`);

                if (player.stack === 0) {
                    // This is actually an allin
                    await this.aiPlayerMove(seat, AIActions.ALLIN, chip);
                } else {
                    await this.aiPlayerMove(seat, AIActions.RAISE, chip);
                }

                break;
            }
            case "SmallBlind": {
                if (this.hand) {
                    this.hand.sbSeat = seat;
                }
                break;
            }
            case "BigBlind":
            case "NoShowCards": {
                break;
            }
            case "WaitForBigBlind":
            case "SitOut": {
                // Player has withdrawn participation
                if (this.hand) {
                    if (seat === this.heroSeat) {
                        // Invalidate the hand since we won't be participating
                        this.hand = null;
                        this.logger.info("Hero isn't participating; invalidated hand state");
                    } else {
                        // We must remove them
                        this.hand.players.delete(seat);
                        this.logger.info(`Seat ${seat} isn't participating`);
                    }
                }

                break;
            }
            default: {
                this.logger.warn(`Unhandled action flag: '${flag}'`);
            }
        }
    }

    async onHoleCards(payload) {
        // Check for the bug where we are playing HU and BB is also button
        if ((payload.holeCards.length === 2) && (this.hand.sbSeat !== this.hand.dealerSeat)) {
            await this.setHandFoldOverride("HU_BB_IS_DEALER");
        }

        for (const {seat, cards} of payload.holeCards) {
            if (cards[0] !== "-" || cards[1] !== "-") {
                // Hero hole cards
                this.hand.updatePlayer(seat, {cards});
                this.hand.holeCards = cards;
                this.logger.info(`Hole cards: ${cards.join("")}`);
                break;
            }
        }

        if (!this.hand.holeCards) {
            throw new Error(`'HoleCards' called but hero wasn't provided with any`);
        }

        // Only init the AI API connection after we receive hole cards. It ensures that
        // all players have posted, and we will have the necessary data to begin
        await this.aiInitNewHand();
    }

    async onSeat(payload) {
        const {seat, name, country, chip, id} = payload;
        this.updatePlayer(seat, {name, country, stack: chip});

        if (id === this.externalId) {
            this.heroSeat = seat;
            this.logger.info(`Hero seat: ${this.heroSeat} (via 'Seat')`);
        }
    }

    async onBoardCards(payload) {
        this.hand.communityCards.push(...payload.cards);
        this.logger.info(`Community cards: ${payload.cards.join("")}`);
        await this.aiCommunityCards(payload.cards);
    }

    async onRequestSelection(payload) {
        const {actions, attributes, timestamp} = payload;

        this.hand.availableActions.clear();
        this.hand.actionTimestamp = timestamp;
        this.hand.actionDate = Date.now();
        this.hand.waitingForAction = true;

        for (const action of actions) {
            this.hand.availableActions.set(action.flag, {
                // Not all of these properties may be available
                chip: action.chip,
                min: action.min,
                max: action.max
            });
        }

        const formattedActions = Array.from(this.hand.availableActions).map(([flag, action]) => {
            if (action.chip !== undefined) {
                return `${flag} (${action.chip})`;
            } else if (action.min !== undefined && action.max !== undefined) {
                return `${flag} (${action.min},${action.max})`;
            } else {
                return flag;
            }
        }).join(", ");
        this.logger.info(`Available actions: ${formattedActions || "None"}`);

        if (attributes?.BetChips !== undefined) {
            // This is the number of chips already in front of hero
            this.hand.betChips = attributes.BetChips;
        }

        const canFoldOrCall = this.hand.availableActions.has("Fold") || this.hand.availableActions.has("Call");

        // Check the automatic fold
        if (this.hand.foldOverride && canFoldOrCall) {
            this.logger.warn("Performing fold override");
            this.hand.foldOverride = false; // Make sure we don't accidentally do it twice
            await this.executeAIAction(AIActions.FOLD);
        }

        // Check the wait for big blind
        if (this.hand.availableActions.has("WaitForBigBlind")) {
            this.logger.info(`Executing 'WaitForBigBlind'`);
            await this._executeAction("WaitForBigBlind");
        }
    }

    async onCardHand(payload) {
        const {seat, holeCards} = payload;

        this.hand.updatePlayer(seat, {cards: holeCards});
        const player = this.hand.players.get(seat);

        this.logger.info(`Player ${player.name} shows cards: ${holeCards.join("")}`);
    }

    /**
     * Entrypoint for network traffic.
     *
     * @param direction
     * @param header
     * @param payload
     * @returns {Promise<void>}
     */
    async onTraffic(direction, header, payload) {
        const requiresHand = async func => {
            if (this.hand) {
                await func();
            }
        };
        
        try {
            switch (header.type) {
                case "TableState": {
                    await this.onTableState(payload);
                    break;
                }
                case "TryJoin": {
                    await this.onTryJoin(payload);
                    break;
                }
                case "HandStart": {
                    await this.onHandStart(payload);
                    break;
                }
                case "HandResult": {
                    await this.onHandResult(payload);
                    break;
                }
                case "Round": {
                    await requiresHand(() => this.onRound(payload));
                    break;
                }
                case "SelectionResult": {
                    await this.onSelectionResult(payload);
                    break;
                }
                case "HoleCards": {
                    await requiresHand(() => this.onHoleCards(payload));
                    break;
                }
                case "Seat": {
                    await this.onSeat(payload);
                    break;
                }
                case "BoardCards": {
                    await requiresHand(() => this.onBoardCards(payload));
                    break;
                }
                case "RequestSelection": {
                    await requiresHand(() => this.onRequestSelection(payload));
                    break;
                }
                case "CardHand": {
                    await requiresHand(() => this.onCardHand(payload));
                    break;
                }
                default: {
                    // No need to warn on unknown traffic types
                }
            }
        } catch (error) {
            this.logger.error(
                `Error processing traffic: ${error.message} | type: '${header.type}' payload: ${JSON.stringify(payload)}\n${error.stack}`
            );
        }
    }

    /**
     * Initializes the AI API connection for a new poker hand.
     * Prepares the AI by establishing a connection, providing game details, player data, and private hand information.
     * If an existing AI API connection exists, it is disconnected before starting a new one.
     *
     * @return {Promise<void>} Resolves when the AI API connection is successfully initialized, or rejects if an error occurs during the process.
     */
    async aiInitNewHand() {
        if (!this.hand) {
            this.logger.error(`Cannot initialize AI API connection for new hand; no hand is active`);
            return;
        }
        if (this.hand.foldOverride) {
            // Fold override is enabled, no AI API connection needs to be established
            return;
        }

        this.logger.info(`Initializing AI API connection for new hand`);

        try {
            const sortedPlayers = this.hand.seatsFromSb().map(seat => this.hand.players.get(seat));
            this.logPlayerDetails(sortedPlayers);

            // Disconnect any old connection
            this._disconnectAI()

            const loggerPrefix = `aiapi:${this.socketId}:${this.hand.handNumber}`;
            const {aiApiAddress, aiApiPort} = config;

            this.ai = new AIAPIClient(aiApiAddress, aiApiPort, createLogger(loggerPrefix));
            this.ai.on("action_suggestion", this.executeAIAction.bind(this));
            this.ai.on("disconnect", async () => {
                if (this.hand) {
                    // Disconnected - we should fold now
                    await this.setHandFoldOverride("AI_DISCONNECTED");
                }
            });

            await this.ai.connect();

            const playersPayload = sortedPlayers.map(player => {
                return {
                    pid: player.seat.toString(),
                    stack: player.initialStack
                };
            });
            const postedSeats = this.hand.seatsThatPosted.map(seat => seat.toString());

            await this.ai.sendStartGame(
                "acr_poker",
                this.smallBlind,
                this.bigBlind,
                0, 0, 0,
                this.heroSeat.toString(),
                playersPayload,
                postedSeats,
                true
            );
            await this.ai.sendPrivateHand(this.hand.holeCards);

        } catch (error) {
            if (error.message.includes("Small blind seat not found in participants")) {
                await this.setHandFoldOverride("SB_NOT_POSTED");
            } else {
                this.logger.error(`Error during AI initialization: ${error.message}\n${error.stack}`);
            }

            this._disconnectAI();
        }
    }

    async aiPlayerMove(seat, action, amount = 0) {
        if (!this.ai) return;

        return this.ai.sendPlayerMove(seat.toString(), action, amount);
    }

    async aiCommunityCards(cards) {
        if (!this.ai) return;

        return this.ai.sendDealCommunityCards(cards);
    }

    async aiShowdown(players) {
        if (!this.ai) return;

        return this.ai.sendShowdown(players);
    }

    async executeAIAction(type, amount = 0) {
        try {
            this.logger.info(`AI action suggestion: ${type} (${amount})`);

            while (!this.hand.waitingForAction) {
                // RequestSelection hasn't been called for hero yet
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            const currentDate = Date.now();
            const timeSinceAction = currentDate - this.hand.actionDate;
            
            const delayMin = config.actionDelayMin;
            const delayMax = config.actionDelayMax;
            const expectedDelay = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;

            if (timeSinceAction < expectedDelay) {
                const sleepTime = expectedDelay - timeSinceAction;
                this.logger.info(`Waiting for ${sleepTime}ms before executing action`);
                await new Promise(resolve => setTimeout(resolve, sleepTime));
            }

            switch (type) {
                case AIActions.FOLD: {
                    if (this.hand.availableActions.has("Check")) {
                        this.logger.info("AI suggests folding, but we have a check available; overriding");
                        this._executeAction("Check");
                    } else {
                        this._executeAction("Fold");
                    }
                    break;
                }
                case AIActions.CHECK: {
                    this._executeAction("Check");
                    break;
                }
                case AIActions.CALL: {
                    const action = this.hand.availableActions.get("Call");
                    this._executeAction("Call", action.chip);
                    break;
                }
                case AIActions.BET: {
                    const constraints = this.hand.availableActions.get("Bet");

                    // TODO: Asked about this case in slack already.
                    if (amount < constraints.min) {
                        this.logger.error(
                            `Total to bet (${amount}) is less than minimum (${constraints.min}); folding`
                        );
                        await this.executeAIAction(AIActions.FOLD);
                        break;
                    }

                    this._executeAction("Bet", amount)
                    break;
                }
                case AIActions.RAISE: {
                    const constraints = this.hand.availableActions.get("RaiseTo");
                    if (!constraints) {
                        // This may actually be mapped as a bet
                        await this.executeAIAction(AIActions.BET, amount);
                        break;
                    }

                    // TODO: Asked about this case in slack already.
                    if (amount < constraints.min) {
                        this.logger.error(
                            `Total to raise (${amount}) is less than minimum (${constraints.min}); folding`
                        );
                        await this.executeAIAction(AIActions.FOLD);
                        break;
                    }

                    // AI API suggests the chips to put in above the last bet, whereas ACR
                    // accepts the absolute amount to raise to.
                    this._executeAction("RaiseTo", amount);
                    break;
                }
                case AIActions.ALLIN: {
                    let constraints = this.hand.availableActions.get("RaiseTo");
                    if (constraints) {
                        // Map allin to raise
                        this._executeAction("RaiseTo", constraints.max);
                        break;
                    }

                    constraints = this.hand.availableActions.get("Bet");
                    if (constraints) {
                        // Map allin to bet
                        this._executeAction("Bet", constraints.max);
                        break;
                    }

                    constraints = this.hand.availableActions.get("Call");
                    if (constraints) {
                        // Map allin to call
                        this._executeAction("Call", constraints.chip);
                        break;
                    }

                    this.logger.warn(`No available action for allin?`)
                    break;
                }
                default:
                    this.logger.warn(`Unhandled AI action type: '${type}'`);
            }
        } catch (error) {
            this.logger.error(
                `Exception during action execution in 'onAIActionSuggestion': ${error.message}\n${error.stack}`
            );
        }
    }

    /**
     * Disconnects the AI instance if it exists and sets it to null.
     *
     * @return {void} This method does not return any value.
     */
    _disconnectAI() {
        if (this.ai) {
            this.ai.disconnect();
            this.ai = null;
        }
    }

    /**
     * Platform-level action executor.
     *
     * @param {string} flag - The mandatory flag indicating the type of action to execute.
     * @param {?any} [chip=undefined] - An optional parameter representing additional data for the action.
     * @return {void} This method does not return any value.
     */
    _executeAction(flag, chip = undefined) {
        const action = {flag};
        if (chip !== undefined) {
            action.chip = chip;
        }

        this.emit("messageAsClient", "Selection", {
            action: action,
            timestamp: this.hand.actionTimestamp
        });
    }

    /**
     * Logs the details of each player in the game, including their seat, name, country, and stack of chips.
     *
     * @param {Array} players - An array of seat identifiers representing the players in the game.
     * @return {void} This method does not return any value.
     */
    logPlayerDetails(players) {
        players.forEach(player => {
            this.logger.info(
                `[${player.seat}] ${player.name} (${player.country}) with ${player.stack} chips`
            );
        });
    }
}

module.exports = TableState;
