const { ethers } = require('ethers');

// ABI — only the functions you need
const ABI = [
    "function logTransaction(string,uint256,string,string,uint256,uint256) external",
    "function verifyTransaction(string) view returns (bool, tuple(string,uint256,string,string,uint256,uint256,uint256,address))",
    "event TransactionLogged(string indexed, uint256)"
];

class BlockchainService {
    static getContract() {
        const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545');
        const wallet   = new ethers.Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider);
        return new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);
    }

    static async logTransaction(txData) {
        try {
            const contract = this.getContract();
            const tx = await contract.logTransaction(
                txData.transactionRef,
                ethers.parseUnits(String(txData.amount), 2),       // store as integer (cents)
                txData.fromCurrency,
                txData.toCurrency,
                ethers.parseUnits(String(txData.exchangeRate), 6),  // 6 decimal precision
                ethers.parseUnits(String(txData.fees), 2)
            );
            const receipt = await tx.wait();
            console.log(`⛓️  Blockchain log: ${txData.transactionRef} → tx ${receipt.hash}`);
            return { success: true, txHash: receipt.hash, blockNumber: receipt.blockNumber };
        } catch (error) {
            // Non-blocking — don't fail the transfer if blockchain is down
            console.error('⚠️  Blockchain log failed (non-fatal):', error.message);
            return { success: false, error: error.message };
        }
    }

    static async verifyTransaction(transactionRef) {
        try {
            const contract = this.getContract();
            const [exists, log] = await contract.verifyTransaction(transactionRef);
            return { success: true, exists, log };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = BlockchainService;