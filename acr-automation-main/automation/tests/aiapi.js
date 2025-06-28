const AIAPIClient = require("../src/aiapi/client.js");
const createLogger = require("../src/utils/logger.js");

(async () => {
    const logger = createLogger("main");

    logger.info("Connecting...");

    const client = new AIAPIClient("35.198.253.168", 9923, createLogger("aiapi_client"));
    client.on("action_suggestion", (type, amount) => {
        logger.info(`Action suggestion: ${type} for ${amount}`);
    });

    await client.connect();

    await client.sendStartGame(
        "testing",
        1,
        2,
        0,
        0,
        0,
        "00000000-0000-0000-0000-0000f8046900",
        [
            {
                pid: "00000000-0000-0000-0000-0000f8046900",
                stack: 200
            },
            {
                pid: "00000000-0000-0000-0000-0000ee395000",
                stack: 202
            },
            {
                pid: "00000000-0000-0000-0000-00001a705600",
                stack: 255
            },
            {
                pid: "00000000-0000-0000-0000-0000e2206200",
                stack: 265
            },
            {
                pid: "00000000-0000-0000-0000-0000195a5f00",
                stack: 148
            },
            {
                pid: "00000000-0000-0000-0000-0000aeaf3300",
                stack: 420
            }
        ]
    );

    await client.sendPrivateHand(["4c", "9c"]);

    await client.sendPlayerMove(
        "00000000-0000-0000-0000-00001a705600",
        "raises",
        3
    );

    await client.sendPlayerMove(
        "00000000-0000-0000-0000-0000e2206200",
        "calls",
        0
    );

    await client.sendPlayerMove(
        "00000000-0000-0000-0000-0000195a5f00",
        "folds",
        0
    );

    await client.sendPlayerMove(
        "00000000-0000-0000-0000-0000aeaf3300",
        "calls",
        0
    );
})();
