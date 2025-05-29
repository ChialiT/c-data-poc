"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const sdk_1 = __importDefault(require("@irys/sdk"));
const multer_1 = __importDefault(require("multer"));
const ethers_1 = require("ethers"); // Import BigNumber & providers
const eas_sdk_1 = require("@ethereum-attestation-service/eas-sdk");
// Remove Arweave direct import if not used elsewhere, or keep if arweave-js direct calls are made
// import Arweave from 'arweave'; 
dotenv_1.default.config({ path: '../.env.local' });
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({ storage: storage });
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// EVM Wallet for Irys Payments
const serverEvmPrivateKey = process.env.SERVER_EVM_PRIVATE_KEY;
const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
const irysPaymentToken = process.env.IRYS_PAYMENT_TOKEN; // Should be 'base-eth'
const irysNetwork = process.env.IRYS_NETWORK || 'devnet'; // Irys's own network env
// EAS Configuration
const EAS_CONTRACT_ADDRESS_BASE_SEPOLIA = process.env.EAS_SCHEMA_REGISTRY_ADDRESS_BASE_SEPOLIA || "0x4200000000000000000000000000000000000021"; // Default if not in .env
const EAS_SCHEMA_UID = process.env.EAS_SCHEMA_UID_BASE_SEPOLIA;
if (!serverEvmPrivateKey) {
    console.error("SERVER_EVM_PRIVATE_KEY is not set. Check .env.local");
    process.exit(1);
}
if (!baseSepoliaRpcUrl) {
    console.error("BASE_SEPOLIA_RPC_URL is not set. Check .env.local");
    process.exit(1);
}
if (!irysPaymentToken) {
    console.error("IRYS_PAYMENT_TOKEN is not set. Check .env.local (e.g., base-eth)");
    process.exit(1);
}
if (!EAS_SCHEMA_UID) {
    console.error("EAS_SCHEMA_UID_BASE_SEPOLIA is not set in .env.local. Please add it.");
    process.exit(1);
}
let serverEvmWallet;
try {
    serverEvmWallet = new ethers_1.Wallet(serverEvmPrivateKey);
    console.log(`[server]: EVM Wallet loaded for address: ${serverEvmWallet.address}`);
}
catch (error) {
    console.error("Failed to initialize EVM wallet from SERVER_EVM_PRIVATE_KEY:", error);
    process.exit(1);
}
// Arweave JWK (kept for potential direct arweave-js use, not for Irys payment now)
const arweaveKeyRaw = process.env.ARWEAVE_KEY_JWK;
let parsedArweaveKey;
if (arweaveKeyRaw) {
    try {
        parsedArweaveKey = JSON.parse(arweaveKeyRaw);
        console.log('[server]: Arweave key loaded (for potential direct arweave-js use).');
    }
    catch (error) {
        console.warn("Failed to parse ARWEAVE_KEY_JWK. If not using for direct Arweave ops, this might be fine.", error);
    }
}
else {
    console.warn("ARWEAVE_KEY_JWK not found. If not using for direct Arweave ops, this is fine.");
}
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Backend is running' });
});
// Now returns the server's EVM public address used for Irys payments
app.get('/api/publicKey', (req, res) => {
    res.status(200).json({ publicKey: serverEvmWallet.address, type: 'EVM' });
});
const ALLOWED_USERS = ['user1_temp_id', 'user2_temp_id'];
// This endpoint might be deprecated or re-purposed if all uploads are files via /api/uploadPhoto
app.post('/api/signData', async (req, res, next) => {
    // ... (keeping previous implementation, but note its new context) ...
    // This would now upload JSON data using the server's EVM key to pay Irys.
    try {
        const { userId, dataToSign } = req.body;
        if (!userId || !ALLOWED_USERS.includes(userId) && !ethers_1.utils.isAddress(userId)) { // Allow ETH address as userId
            res.status(403).json({ message: 'Forbidden: User not authorized' });
            return;
        }
        if (!dataToSign) {
            res.status(400).json({ message: 'Bad Request: dataToSign is required' });
            return;
        }
        console.log(`User '${userId}' authorized. Received JSON data to upload:`, dataToSign);
        const irys = new sdk_1.default({
            network: irysNetwork,
            token: irysPaymentToken,
            key: serverEvmPrivateKey,
            config: { providerUrl: baseSepoliaRpcUrl }
        });
        const dataBuffer = Buffer.from(JSON.stringify(dataToSign));
        const tags = [{ name: "Content-Type", value: "application/json" }];
        console.log(`Attempting to upload JSON data to Irys (${irysNetwork}, paying with ${irysPaymentToken}) with tags:`, tags);
        const receipt = await irys.upload(dataBuffer, { tags });
        console.log(`JSON Data uploaded to Irys. Receipt ID: ${receipt.id}`);
        res.status(200).json({
            message: 'JSON Data uploaded to Arweave via Irys successfully (paid with EVM token)',
            arweaveTxId: receipt.id,
            timestamp: receipt.timestamp
        });
    }
    catch (error) {
        console.error('Error in /api/signData:', error);
        next(error);
    }
});
app.post('/api/uploadPhoto', upload.single('photoFile'), async (req, res, next) => {
    try {
        const userId = req.body.userId;
        if (!userId || !ALLOWED_USERS.includes(String(userId)) && !ethers_1.utils.isAddress(String(userId))) { // Allow ETH address as userId
            res.status(403).json({ message: 'Forbidden: User not authorized' });
            return;
        }
        if (!req.file) {
            res.status(400).json({ message: 'Bad Request: No photo file provided.' });
            return;
        }
        const photoFile = req.file;
        console.log(`User '${userId}' authorized. Received photo to upload: ${photoFile.originalname}, Size: ${photoFile.size}, Type: ${photoFile.mimetype}`);
        const irys = new sdk_1.default({
            network: irysNetwork,
            token: irysPaymentToken,
            key: serverEvmPrivateKey,
            config: { providerUrl: baseSepoliaRpcUrl }
        });
        // Balance check (important for EVM payments too)
        try {
            const balance = await irys.getLoadedBalance(); // Gets balance in atomic units of irysPaymentToken
            console.log(`Irys node balance for EVM key (token: ${irysPaymentToken}): ${balance.toString()} atomic units`);
            // Conversion to human-readable depends on the token's decimals (e.g., 18 for ETH)
            // Assuming 18 decimals for ETH-like tokens for this log message
            const balanceInStandardUnit = parseFloat(balance.toString()) / Math.pow(10, 18);
            console.log(`Irys node balance in standard units: ${balanceInStandardUnit.toFixed(6)} ${irysPaymentToken}`);
            // A more robust cost estimation would be needed here for production
            if (balance.isZero()) { // Simplified check
                console.warn("Warning: Irys node balance for EVM key is zero.");
            }
        }
        catch (balanceError) {
            console.error("Error fetching Irys node balance for EVM key:", balanceError);
        }
        const tags = [{ name: "Content-Type", value: photoFile.mimetype }];
        console.log(`Attempting to upload photo to Irys (${irysNetwork}, paying with ${irysPaymentToken}) with tags:`, tags);
        const receipt = await irys.upload(photoFile.buffer, { tags });
        console.log(`Photo uploaded to Irys. Receipt ID: ${receipt.id}`);
        res.status(200).json({
            message: 'Photo uploaded to Arweave via Irys successfully (paid with EVM token)',
            arweaveTxId: receipt.id,
            originalName: photoFile.originalname,
            mimeType: photoFile.mimetype,
            size: photoFile.size,
            timestamp: receipt.timestamp
        });
    }
    catch (error) {
        console.error('Error in /api/uploadPhoto:', error);
        next(error);
    }
});
// New endpoint to fund the Irys node for the server's EVM wallet
app.post('/api/fundIrysNode', async (req, res, next) => {
    try {
        const { amount } = req.body;
        let amountToFundStr = amount || '0.005';
        console.log(`Attempting to fund Irys node with ${amountToFundStr} ${irysPaymentToken}`);
        const irys = new sdk_1.default({
            network: irysNetwork,
            token: irysPaymentToken,
            key: serverEvmPrivateKey,
            config: { providerUrl: baseSepoliaRpcUrl }
        });
        const amountInAtomicUnits = ethers_1.utils.parseUnits(amountToFundStr, 18);
        // Pass the atomic amount as a string to irys.fund()
        const fundTx = await irys.fund(amountInAtomicUnits.toString());
        const fundedAmountInStandard = ethers_1.utils.formatUnits(fundTx.quantity.toString(), 18);
        console.log(`Successfully funded Irys node. Amount: ${fundedAmountInStandard} ${irysPaymentToken}, Transaction ID: ${fundTx.id}`);
        const balanceAfterFund = await irys.getLoadedBalance();
        const balanceInStandardUnit = ethers_1.utils.formatUnits(balanceAfterFund.toString(), 18);
        console.log(`New Irys node balance: ${balanceInStandardUnit} ${irysPaymentToken}`);
        res.status(200).json({
            message: `Successfully funded Irys node with ${fundedAmountInStandard} ${irysPaymentToken}`,
            irysTxId: fundTx.id,
            newBalance: `${balanceInStandardUnit} ${irysPaymentToken}`
        });
    }
    catch (error) {
        console.error('Error in /api/fundIrysNode:', error);
        next(error);
    }
});
app.post('/api/createAttestation', async (req, res, next) => {
    try {
        const { recipient, // User's ETH address (who the attestation is about)
        photoTakenDate, // string (ISO format)
        coordinates, // string[] (e.g., ["lat", "long"])
        arweaveTxId, // string
        thumbnailHash // string
         } = req.body;
        console.log("[/api/createAttestation] Received data:", req.body);
        // Validate required fields
        if (!recipient || !photoTakenDate || !coordinates || !arweaveTxId || !thumbnailHash) {
            res.status(400).json({ message: "Missing required fields for attestation." });
            return;
        }
        if (!ethers_1.utils.isAddress(recipient)) {
            res.status(400).json({ message: "Invalid recipient ETH address." });
            return;
        }
        if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(c => typeof c === 'string')) {
            res.status(400).json({ message: "Coordinates must be an array of two strings." });
            return;
        }
        if (!baseSepoliaRpcUrl) {
            throw new Error("BASE_SEPOLIA_RPC_URL is not configured.");
        }
        if (!EAS_SCHEMA_UID) { // Should have been checked at startup, but good to have here
            throw new Error("EAS_SCHEMA_UID_BASE_SEPOLIA is not configured.");
        }
        const provider = new ethers_1.providers.JsonRpcProvider(baseSepoliaRpcUrl);
        const signer = serverEvmWallet.connect(provider); // Use the globally defined serverEvmWallet
        const eas = new eas_sdk_1.EAS(EAS_CONTRACT_ADDRESS_BASE_SEPOLIA);
        eas.connect(signer);
        // Define the schema structure as per your EASSscan page
        // string photoTakenDate,string[] coordinates,string arweaveTxId,string thumbnailHash
        const schemaEncoder = new eas_sdk_1.SchemaEncoder("string photoTakenDate,string[] coordinates,string arweaveTxId,string thumbnailHash");
        const encodedData = schemaEncoder.encodeData([
            { name: "photoTakenDate", value: photoTakenDate, type: "string" },
            { name: "coordinates", value: coordinates, type: "string[]" },
            { name: "arweaveTxId", value: arweaveTxId, type: "string" },
            { name: "thumbnailHash", value: thumbnailHash, type: "string" }
        ]);
        console.log("[/api/createAttestation] Attempting to create attestation with data:", {
            recipient,
            schema: EAS_SCHEMA_UID,
            data: encodedData,
        });
        const tx = await eas.attest({
            schema: EAS_SCHEMA_UID,
            data: {
                recipient: recipient,
                expirationTime: eas_sdk_1.NO_EXPIRATION, // Use NO_EXPIRATION from SDK (it's 0n)
                revocable: true, // As per your schema on EASSscan
                data: encodedData,
            },
        });
        console.log("[/api/createAttestation] Attestation transaction submitted, tx object:", tx);
        // tx.wait() returns the UID of the new attestation (string)
        const newAttestationUID = await tx.wait();
        // After tx.wait(), the transaction object should be populated with the receipt
        const receipt = tx.receipt; // Explicit cast
        if (!receipt) {
            throw new Error("Transaction receipt not found after waiting. This should not happen.");
        }
        const transactionHash = receipt.transactionHash;
        console.log("[/api/createAttestation] Attestation created. New UID:", newAttestationUID, "Tx Hash:", transactionHash);
        res.status(201).json({
            message: 'Attestation created successfully on Base Sepolia',
            attestationUid: newAttestationUID,
            txHash: transactionHash
        });
    }
    catch (error) {
        console.error('Error in /api/createAttestation:', error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        // Check for common Ethers errors or contract revert reasons if possible
        // if (error.data) { console.error("Error data:", error.data); }
        // if (error.transactionHash) { console.error("Error TX hash:", error.transactionHash); }
        res.status(500).json({ message: "Failed to create attestation", error: errorMessage });
        next(error);
    }
});
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err.stack);
    if (res.headersSent) {
        next(err);
        return;
    }
    let errorMessage = 'Internal Server Error';
    if (err instanceof Error) {
        errorMessage = err.message;
    }
    res.status(500).json({ message: 'Internal Server Error', error: errorMessage });
});
app.listen(port, () => {
    console.log(`[server]: Backend server running at http://localhost:${port}`);
    // Startup check for EVM wallet used for Irys
    if (serverEvmWallet.address) {
        console.log(`[server]: Primary Irys payment wallet (EVM): ${serverEvmWallet.address}`);
        // Optional: Perform a balance check for this EVM wallet on Irys at startup
        // This is a good idea to catch funding issues early.
        const checkBalanceAtStartup = async () => {
            try {
                const irys = new sdk_1.default({
                    network: irysNetwork,
                    token: irysPaymentToken,
                    key: serverEvmPrivateKey,
                    config: { providerUrl: baseSepoliaRpcUrl }
                });
                const balance = await irys.getLoadedBalance();
                const balanceInStandardUnit = parseFloat(balance.toString()) / Math.pow(10, 18); // Assuming 18 decimals
                console.log(`[server]: Startup Irys balance check (token: ${irysPaymentToken}): ${balanceInStandardUnit.toFixed(6)}`);
            }
            catch (e) {
                console.error("[server]: Error checking Irys balance at startup for EVM key:", e.message);
            }
        };
        checkBalanceAtStartup();
    }
});
