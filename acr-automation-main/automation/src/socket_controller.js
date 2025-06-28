const socketManager = require("./socket_manager.js");
const tableController = require("./table_controller.js");
const msgpack = require("msgpack");
const logger = require("./utils/logger.js")("socket_controller");
const trafficLogger = require("./utils/traffic_logger.js")("socket_controller");
const requiredMessageTypes = require("./required_types.js");

const onConnection = async clientConnection => {
    const socketId = clientConnection.id;

    try {
        logger.info(`New client connected: ${socketId}`);
        trafficLogger.debug(`New client connected: ${socketId}`);

        logger.debug(`Client handshake: ${JSON.stringify(clientConnection.handshake)}`);

        // Connect to the real Socket.IO server
        const serverConnection = await initialiseRealConnection(clientConnection);

        // Track the state of this socket
        socketManager.addSocketPair(socketId, clientConnection, serverConnection);

        // Forward traffic between the real client and a real server
        await forwardNetworkTraffic(clientConnection, serverConnection);

        // Forward disconnects
        clientConnection.on("disconnect", (reason) => {
            logger.info(`Client disconnected: ${socketId}: ${reason || "unknown reason"}`);
            trafficLogger.debug(`Client disconnected: ${socketId}`);

            if (socketManager.removeSocketPair(socketId)) {
                tableController.processDisconnect(socketId);
            }
        });
        serverConnection.on("disconnect", (reason) => {
            logger.info(`Server disconnected: ${socketId}: ${reason || "unknown reason"}`);
            trafficLogger.debug(`Server disconnected: ${socketId}`);

            if (socketManager.removeSocketPair(socketId)) {
                tableController.processDisconnect(socketId);
            }
        });
    } catch (error) {
        logger.error(`Error connecting client: ${socketId} - ${error.message}`);
    }
};

/**
 * Extracts and cleans query parameters by removing specified keys.
 * @param {object} query - The query object from the client connection.
 * @returns {string} - The cleaned query as a URL-encoded string.
 */
const cleanQuery = query => {
    const excludedKeys = ["EIO", "transport", "realurl"];
    return Object.keys(query)
        .filter(key => !excludedKeys.includes(key))
        .map(key => `${key}=${query[key]}`)
        .join('&');
};

/**
 * Establishes and initializes a real-time connection to the upstream Socket.IO server
 * specified by the 'realurl' query parameter from the client connection.
 */
const initialiseRealConnection = async clientConnection => {
    const ForkedSocketClient = require("../forked/sio-client.js");

    // Extract the real URL from the query
    const realUrl = clientConnection.handshake.query["realurl"];
    const cleanedQuery = cleanQuery(clientConnection.handshake.query);

    const serverConnection = ForkedSocketClient(realUrl, {
        query: cleanedQuery,
        forceNew: true,
        reconnection: true,
        timeout: 30000,
        rememberUpgrade: true,
        requestTimeout: 30000,
        transports: ["websocket"],
        extraHeaders: {
            "user-agent": clientConnection.handshake.headers["user-agent"],
            "origin": clientConnection.handshake.headers["origin"],
        }
    });

    // Wait for the connection to the upstream server
    await new Promise((resolve, reject) => {
        serverConnection.on("connect", () => {
            logger.info(`Connected to upstream server at ${realUrl}: ${clientConnection.id}`);
            resolve();
        });
        serverConnection.on("connect_error", error => {
            logger.error(`Failed to connect to upstream server: ${realUrl} - Error: ${error.message}`);
            clientConnection.disconnect();
            reject(error);
        });
    });

    return serverConnection;
};

/**
 * Forwards network traffic between the client and server connections.
 * Logs traffic and updates tables.
 */
const forwardNetworkTraffic = (clientConnection, serverConnection) => {
    const socketId = clientConnection.id;

    // Forward client -> server
    clientConnection.on("message", raw => {
        serverConnection.emit("message", raw);

        try {
            const message = msgpack.unpack(new Uint8Array(raw));

            if (requiredMessageTypes.has(message.header.type)) {
                trafficLogger.info(`[${socketId}] OUT ${JSON.stringify(message)}`);

                // Emit the message to the table controller
                tableController.processTraffic("OUT", socketId, message.header, message.payload).then(() => {});
            }
        } catch (err) {}
    });
    clientConnection.on("message.extension", raw => {
        serverConnection.emit("message.extension", raw);
    });

    // Special type emitted by the client when it finishes parsing an AVRO message
    clientConnection.on("avro", raw => {
        //trafficLogger.info(`[${socketId}] AVRO ${raw}`);
    });

    // Forward server -> client
    serverConnection.on("message", raw => {
        clientConnection.emit("message", raw);

        try {
            const message = msgpack.unpack(new Uint8Array(raw));

            if (requiredMessageTypes.has(message.header.type)) {
                trafficLogger.info(`[${socketId}] IN  ${JSON.stringify(message)}`);

                // Emit the message to the table controller
                tableController.processTraffic("IN", socketId, message.header, message.payload).then(() => {});
            }
        } catch (err) {}
    });
    serverConnection.on("message.extension", raw => {
        clientConnection.emit("message.extension", raw);
    });
};

module.exports = { onConnection };
