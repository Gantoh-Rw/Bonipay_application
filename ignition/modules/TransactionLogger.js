const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("TransactionLoggerModule", (m) => {
  const transactionLogger = m.contract("TransactionLogger");
  return { transactionLogger };
});
