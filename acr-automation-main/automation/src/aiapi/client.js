const net = require("net");
const EventEmitter = require("events");
const {Mutex} = require("async-mutex");

class AIAPIClient extends EventEmitter {
    constructor(host, port, logger) {
        super();
        this.host = host;
        this.port = port;
        this.logger = logger;
        this.mutex = new Mutex(); // Exclusive processing of packets must be guaranteed
    }

    /**
     * Handles incoming data from the socket, processes it, and emits appropriate events or logs errors.
     *
     * @param {Buffer|string} data - The data received from the socket, expected to be in JSON format.
     * @return {void} This method does not return a value but processes the data and may emit events or log messages.
     */
    _processSocketData(data) {
        try {
            this.logger.debug(`Received: ${data.toString()}`);
            const response = JSON.parse(data.toString());

            if (response["success"] === false) {
                this.logger.error(`Error from AI API: ${response["error_msg"]}`);

            } else if ("ai_action" in response) {
                const aiAction = response["ai_action"];
                const betType = aiAction["bet_type"];
                const amount = aiAction["amount"];

                this.logger.info(`Action suggested: ${JSON.stringify(aiAction)}`);
                this.emit("action_suggestion", betType, amount);
            }

        } catch (err) {
            this.logger.error(`Error parsing response: ${err}`);
        } finally {
            this._releaseMutexIfLocked();
        }
    }

    /**
     * Releases the mutex if it is currently locked.
     *
     * @return {void} Does not return a value.
     */
    _releaseMutexIfLocked() {
        if (this.mutex.isLocked()) {
            this.mutex.release();
        }
    }

    /**
     * Establishes a connection to the socket server and initializes event listeners
     * for handling server responses, errors, and disconnections.
     *
     * @return {Promise<void>} A promise that resolves when the connection is successfully established,
     * or rejects if an error occurs during the connection attempt.
     */
    async connect() {
        const release = await this.mutex.acquire();

        try {
            this.socket = new net.Socket();

            await new Promise((resolve, reject) => {
                // Attempt to connect to AI API
                this.socket.connect(this.port, this.host, () => {
                    this.logger.info(`Connected at ${this.host}:${this.port}`);
                    resolve();
                })

                // Handle errors
                this.socket.on("error", (err) => {
                    this.logger.error(`Error: ${err}`);
                    this._releaseMutexIfLocked();
                    reject(err);
                });

                // Handle closing
                this.socket.on("close", () => {
                    this.logger.info(`Server connection closed`);
                    this._releaseMutexIfLocked();
                    this.emit("disconnect");
                    this.socket = null;
                });

                // Handle received data
                this.socket.on("data", this._processSocketData.bind(this));
            });
        } finally {
            this.mutex.release();
        }
    }

    /**
     * Disconnects the current socket connection to the AI API, if it exists.
     *
     * @return {Promise<void>} A promise that resolves after the disconnection is complete,
     *                         or immediately if no connection exists.
     */
    disconnect() {
        return new Promise((resolve, reject) => {
            if (this.socket) {
                this.socket.end(() => {
                    this.socket = null;
                    this.logger.info(`Disconnected from AI API`);
                    resolve();
                });
            } else {
                // No connection to close
                resolve();
            }
        });
    }

    async _send(message) {
        if (!this.socket) {
            return;
            //throw new Error("Cannot send data as client is not connected");
        }

        return new Promise((resolve, reject) => {
            try {
                const jsonString = JSON.stringify(message);
                this.logger.debug(`Sending: ${jsonString}`);

                this.socket.write(jsonString, (err) => {
                    if (err) {
                        this.logger.error(`Error writing data: ${err}`);
                        this._releaseMutexIfLocked();
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } catch (err) {
                this.logger.error(`Error sending data: ${err}`);
                reject(err);
            }
        });
    }

    /**
     * Sends a message while ensuring that no other messages are sent simultaneously
     * by acquiring a mutex lock.
     *
     * @param {Object} message - The message object to be sent.
     * @return {Promise<*>} A promise that resolves with the response from the _send method.
     */
    async _sendWithMutex(message) {
        // Lock the mutex so that no other message can be sent simultaneously
        const release = await this.mutex.acquire();

        // Send the message without releasing the mutex
        return this._send(message);
    }

    async sendStartGame(
        platformName,
        sb,
        bb,
        ante,
        straddle,
        cashDrop,
        heroPlayerId,
        players,
        postedExtrasIds = [],
        raise_to = false
    ) {
        return this._sendWithMutex({
            message_type: "start_game",
            game_type: "cash",
            platform_name: platformName,
            sb: sb,
            bb: bb,
            ante: ante,
            straddle: straddle,
            cashdrop: cashDrop,
            ai_player_pid: heroPlayerId,
            n_players: players.length,
            player_info: players,
            post_a_blind_pids: postedExtrasIds,
            raise_to: raise_to,
        });
    }

    async sendPrivateHand(
        cards
    ) {
        return this._sendWithMutex({
            message_type: "private_hand",
            private_hand: cards,
        });
    }

    async sendDealCommunityCards(
        cards
    ) {
        return this._sendWithMutex({
            message_type: "deal_community_cards",
            deal_community_cards: cards,
        });
    }

    async sendPlayerMove(
        playerId,
        actionType,
        amount
    ) {
        return this._sendWithMutex({
            message_type: "player_move",
            action: {
                player_pid: playerId,
                bet_type: actionType,
                amount: amount,
            }
        });
    }

    async sendShowdown(
        players
    ) {
        return this._sendWithMutex({
            message_type: "showdown",
            showdown_info: players,
        });
    }
}

module.exports = AIAPIClient;
