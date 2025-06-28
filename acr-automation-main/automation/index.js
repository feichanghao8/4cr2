const http = require("http");
const express = require("express");
const SioServer = require("socket.io").Server;
const logger = require("./src/utils/logger.js")("index");
const config = require("./src/utils/config.js");

const spoofing = require("./src/spoofing.js");

// Create the local server for any inbound connection from which any patched
// ACR will connect
const app = express();
const server = http.createServer(app);

// Mount the spoofing endpoints
app.use("/", spoofing);

if (config.enableTableAutomation) {
    const {onConnection: onImitatingConnection} = require("./src/socket_controller.js");

    // Mount the Socket.IO man-in-the-middle (MITM) server
    const imitatingServer = new SioServer(server, {
        allowEIO3: true,
        pingInterval: 60000,
        maxHttpBufferSize: 5e8,
        connectionStateRecovery: {
            maxDisconnectionDuration: 2 * 60 * 1000,
            skipMiddlewares: true,
        }
    });

    imitatingServer.on("connection", onImitatingConnection);
}

server.listen(2020, () => {
    logger.info("Server listening on port 2020!");

    // Launch the game automatically in any case
    launchGameApplication().catch(err => {
        logger.error(err);
        process.exit(1);
    })
});

async function launchGameApplication() {

}
