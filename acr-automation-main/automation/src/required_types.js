
const requiredMessageTypes = new Set([
    "Enter",
    "TableState",
    "TryJoin",
    "HandStart",
    "HandResult",
    "Round",
    "SelectionResult",
    "HoleCards",
    "Seat",
    "BoardCards",
    "RequestSelection",
    "CardHand"
]);

module.exports = requiredMessageTypes;
