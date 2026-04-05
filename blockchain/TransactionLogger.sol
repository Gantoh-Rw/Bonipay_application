// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TransactionLogger {
    struct TransferLog {
        string  transactionRef;
        uint256 amount;
        string  fromCurrency;
        string  toCurrency;
        uint256 exchangeRate;
        uint256 fees;
        uint256 timestamp;
        address loggedBy;
    }

    mapping(string => TransferLog) public logs;
    string[] public transactionRefs;
    address public owner;

    event TransactionLogged(string indexed transactionRef, uint256 timestamp);

    constructor() { owner = msg.sender; }

    function logTransaction(
        string memory transactionRef,
        uint256 amount,
        string memory fromCurrency,
        string memory toCurrency,
        uint256 exchangeRate,
        uint256 fees
    ) public {
        require(bytes(logs[transactionRef].transactionRef).length == 0, "Already logged");

        logs[transactionRef] = TransferLog({
            transactionRef: transactionRef,
            amount:         amount,
            fromCurrency:   fromCurrency,
            toCurrency:     toCurrency,
            exchangeRate:   exchangeRate,
            fees:           fees,
            timestamp:      block.timestamp,
            loggedBy:       msg.sender
        });

        transactionRefs.push(transactionRef);
        emit TransactionLogged(transactionRef, block.timestamp);
    }

    function verifyTransaction(string memory transactionRef) public view returns (bool exists, TransferLog memory log) {
        log = logs[transactionRef];
        exists = bytes(log.transactionRef).length > 0;
    }
}