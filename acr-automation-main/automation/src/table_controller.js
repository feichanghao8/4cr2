const tableManager = require('./table_manager.js');
const socketManager = require('./socket_manager.js');
const logger = require("./utils/logger.js")("table_controller");
const trafficLogger = require("./utils/traffic_logger.js")("table_controller");
const msgpack = require("msgpack");

/**
 * The TableController class is responsible for managing and controlling the behavior
 * and state of tables within the application. This includes handling operations
 * such as data manipulation, table updates, and event responses.
 */
class TableController {
    constructor() {}

    /**
     * Registers event listeners for the provided table state. Sets up handlers
     * to process messages sent as a client or server through the associated
     * socket pair.
     *
     * @param {Object} state - The state object containing socket information and event handlers.
     * @return {void}
     */
    registerEvents(state) {
        state.on("messageAsClient", (type, payload) => {
            const pair = socketManager.get(state.socketId);

            if (!pair) {
                logger.warn(`Message from client to be simulated, but no socket pair found for socket: ${state.socketId}`);
                return;
            }

            const {serverConnection} = pair;
            const message = {
                header: {channel: 1, type: type},
                payload: payload,
            };

            trafficLogger.info(`[${state.socketId}] ARTIFICIAL OUT ${JSON.stringify(message)}`);
            serverConnection.emit("message", msgpack.pack(message));
        });
        state.on("messageAsServer", (type, payload) => {
            const pair = socketManager.get(state.socketId);

            if (!pair) {
                logger.warn(`Message from server to be simulated, but no socket pair found for socket: ${state.socketId}`);
                return;
            }

            const {clientConnection} = pair;
            clientConnection.emit("message", msgpack.pack({
                header: {channel: 1, type: type},
                payload: payload,
            }));
        });
    }

    /**
     * Handles the "Enter" event type for processing traffic.
     *
     * @param {string} socketId - The unique identifier for the socket.
     * @param {Object} payload - The payload containing the game number.
     */
    handleEnterEvent(socketId, payload) {
        const gameNumber = payload["gameNumber"];
        const externalId = payload["externalId"];
        const tableState = tableManager.addTable(socketId, gameNumber, externalId);
        logger.info(`Table added for socket: ${socketId}, table id: ${tableState.tableId}`);
        this.registerEvents(tableState);
    }

    /**
     * Processes a disconnection of a socket.
     *
     * @param {string} socketId - The ID of the socket.
     */
    processDisconnect(socketId) {
        // Delete a table associated with this socket, if it exists
        if (tableManager.removeTable(socketId)) {
            logger.info(`Table removed for socket: ${socketId}`);
        }
    }

    /**
     * Processes incoming traffic based on the specified direction, socket ID, header, and payload.
     *
     * @param {string} direction - The direction of traffic; "IN" or "OUT.
     * @param {string} socketId - The unique identifier for the client socket associated with the traffic.
     * @param {Object} header - The header object containing metadata about the traffic, such as type and related properties.
     * @param {Object} payload - The payload of the traffic, containing the actual data being processed.
     * @return {Promise} Resolves when the traffic is successfully processed or rejects with an error if processing fails.
     */
    async processTraffic(direction, socketId, header, payload) {
        try {
            if (header.type === "Enter") {
                this.handleEnterEvent(socketId, payload);
            }

            const tableState = tableManager.get(socketId);
            if (!tableState) {
                // No table associated, resolve the promise
                return Promise.resolve();
            }

            return tableState.onTraffic(direction, header, payload);
        } catch (err) {
            logger.error(`Error processing traffic for socket ${socketId}: ${err.message}`);
            return Promise.reject(err);
        }
    }
}

module.exports = new TableController();
