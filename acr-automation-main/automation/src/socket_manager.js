
class SocketManager {
    constructor() {
        this.sockets = new Map();
    }

    /**
     * Adds a pair of socket connections to the internal storage with a unique identifier.
     *
     * @param {string} id - The ID of the client socket.
     * @param {Object} clientConnection - The client-side connection object.
     * @param {Object} serverConnection - The server-side connection object.
     * @return {void}
     */
    addSocketPair(id, clientConnection, serverConnection) {
        this.sockets.set(id, {
            clientConnection,
            serverConnection
        });
    }

    /**
     * Retrieves a socket pair associated with a given socket ID.
     *
     * @param {string|number} id - The unique identifier of the socket pair to retrieve.
     * @return {Object|null} The socket pair associated with the given identifier, or null if none exists.
     */
    get(id) {
        return this.sockets.get(id) || null;
    }

    /**
     * Removes a socket pair identified by the provided id.
     *
     * @param {string|number} id - The identifier of the socket pair to be removed.
     * @return {boolean} Returns true if the socket pair was found and removed, otherwise false.
     */
    removeSocketPair(id) {
        const socketPair = this.get(id);

        if (socketPair) {
            const { clientSocket, serverSocket } = socketPair;

            // Disconnect both
            if (clientSocket) clientSocket.disconnect(true);
            if (serverSocket) serverSocket.disconnect(true);

            this.sockets.delete(id);
            return true;
        }

        return false;
    }
}

module.exports = new SocketManager();
