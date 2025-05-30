import dotenv from 'dotenv';
import path from 'path'; // Import path for absolute path logging

// === BEGIN DOTENV CONFIG ===
// Ensure this is the VERY FIRST executable code to load environment variables
const envPath = path.resolve(__dirname, '../../.env.local'); // Get absolute path for logging
console.log(`[dotenv] Attempting to load .env file from: ${envPath}`);
const envConfig = dotenv.config({ path: envPath });

if (envConfig.error) {
  console.error('[dotenv] Error loading .env file:', envConfig.error);
} else {
  // Avoid logging all parsed variables directly in production or if sensitive
  if (process.env.NODE_ENV === 'development') {
    console.log('[dotenv] .env file loaded. Parsed keys:', envConfig.parsed ? Object.keys(envConfig.parsed) : 'No .env file found or empty');
  }
  // Optional: Add specific checks for critical variables if needed *after* loading
  if (process.env.NODE_ENV !== 'test') { // Don't do this for tests as they might set vars differently
    if (!process.env.SERVER_EVM_PRIVATE_KEY) { // Check after dotenv.config has run
        console.warn('[dotenv] SERVER_EVM_PRIVATE_KEY was NOT found after dotenv.config().');
    }
    if (!process.env.IRYS_PRIVATE_KEY) { // Check after dotenv.config has run
        console.warn('[dotenv] IRYS_PRIVATE_KEY was NOT found after dotenv.config().');
    }
  }
}
// === END DOTENV CONFIG ===

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { ethers, Wallet, JsonRpcProvider, parseUnits, formatUnits, isAddress, NonceManager, BigNumberish } from 'ethers';
import { EAS, SchemaEncoder, NO_EXPIRATION } from "@ethereum-attestation-service/eas-sdk";
import irysApiRouter from './routes/irysApi'; // Adjust path if your file is elsewhere
import { getUploader } from './services/irysService'; // ---> ADD THIS IMPORT

// Remove Arweave direct import if not used elsewhere, or keep if arweave-js direct calls are made
// import Arweave from 'arweave'; 

const app: Express = express();
const port = process.env.PORT || 3001;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount the Irys API router
app.use('/api/irys', irysApiRouter);

// EVM Wallet for Irys Payments (now intended for Ethereum Mainnet)
const serverEvmPrivateKey = process.env.SERVER_EVM_PRIVATE_KEY;
const ethereumMainnetRpcUrl = process.env.ETHEREUM_MAINNET_RPC_URL; // Changed from baseSepoliaRpcUrl
const irysPaymentToken = process.env.IRYS_PAYMENT_TOKEN; // Should be 'ethereum' for mainnet
const irysNetwork = process.env.IRYS_NETWORK || 'devnet'; // Irys's own network env

// EAS Configuration (remains Optimism Sepolia for client-side EAS)
// These might be primarily for client-side reference if backend EAS ops are deprecated
const EAS_CONTRACT_ADDRESS_OP_SEPOLIA = process.env.EAS_CONTRACT_ADDRESS_OP_SEPOLIA || "0x4200000000000000000000000000000000000021";
const EAS_SCHEMA_UID_OP_SEPOLIA = process.env.EAS_SCHEMA_UID_OP_SEPOLIA;

if (!serverEvmPrivateKey) {
    console.error("SERVER_EVM_PRIVATE_KEY is not set. This account needs ETH on Ethereum Mainnet for Irys funding. Check .env.local");
    process.exit(1);
}
if (!ethereumMainnetRpcUrl) {
    console.error("ETHEREUM_MAINNET_RPC_URL is not set. Check .env.local");
    process.exit(1);
}
if (!irysPaymentToken) {
    console.error("IRYS_PAYMENT_TOKEN is not set (e.g., 'ethereum'). Check .env.local");
    process.exit(1);
}
// Keep EAS config checks if any backend component might still use them, or if they are critical for reference
// if (!EAS_SCHEMA_UID_OP_SEPOLIA) { 
//     console.error("EAS_SCHEMA_UID_OP_SEPOLIA is not set in .env.local. Please add it.");
//     process.exit(1);
// }

let serverEvmWalletSigner: Wallet; 
let mainnetProvider: JsonRpcProvider; // Renamed from baseProvider

// Export for use in other services if needed (though irysService directly uses env vars now)
export let exportedServerEvmWalletSigner: Wallet;
export let exportedMainnetProvider: JsonRpcProvider; // Renamed

try {
    // Initialize provider for Ethereum Mainnet
    mainnetProvider = new JsonRpcProvider(ethereumMainnetRpcUrl);
    const rawWallet = new Wallet(serverEvmPrivateKey);
    serverEvmWalletSigner = rawWallet.connect(mainnetProvider);
    
    exportedServerEvmWalletSigner = serverEvmWalletSigner;
    exportedMainnetProvider = mainnetProvider; // Renamed
    
    console.log(`[server]: EVM Wallet loaded and connected for address: ${serverEvmWalletSigner.address} (Intended for Ethereum Mainnet)`);
} catch (error) {
    console.error("Failed to initialize EVM wallet from SERVER_EVM_PRIVATE_KEY or connect to Ethereum Mainnet provider:", error);
    process.exit(1);
}

// Arweave JWK (kept for potential direct arweave-js use, not for Irys payment now)
const arweaveKeyRaw = process.env.ARWEAVE_KEY_JWK;
let parsedArweaveKey: any;
if (arweaveKeyRaw) {
    try {
        parsedArweaveKey = JSON.parse(arweaveKeyRaw);
        console.log('[server]: Arweave key loaded (for potential direct arweave-js use).');
    } catch (error) {
        console.warn("Failed to parse ARWEAVE_KEY_JWK. If not using for direct Arweave ops, this might be fine.", error);
    }
} else {
    console.warn("ARWEAVE_KEY_JWK not found. If not using for direct Arweave ops, this is fine.");
}

app.get('/', (req, res) => {
  res.status(200).send('C-Data POC Backend is running!');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Now returns the server's EVM public address used for Irys payments
app.get('/api/publicKey', (req: Request, res: Response) => {
    // Ensure serverEvmWalletSigner is initialized before accessing its address
    if (serverEvmWalletSigner) {
        res.status(200).json({ publicKey: serverEvmWalletSigner.address, type: 'EVM' });
    } else {
        res.status(500).json({ message: "Server EVM wallet not initialized" });
    }
});

const ALLOWED_USERS = ['user1_temp_id', 'user2_temp_id'];

// This endpoint might be deprecated or re-purposed if all uploads are files via /api/uploadPhoto
app.post('/api/signData', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { userId, dataToSign } = req.body; 
        if (!userId || !ALLOWED_USERS.includes(userId) && !isAddress(userId)) { 
            res.status(403).json({ message: 'Forbidden: User not authorized' });
            return;
        }
        if (!dataToSign) {
            res.status(400).json({ message: 'Bad Request: dataToSign is required' });
            return;
        }
        console.log(`User '${userId}' authorized. Received JSON data to upload:`, dataToSign);
        
        const uploader = await getUploader(); // Use the new service

        const dataBuffer = Buffer.from(JSON.stringify(dataToSign));
        const tags = [{ name: "Content-Type", value: "application/json" }];
        console.log(`Attempting to upload JSON data to Irys (${irysNetwork}, paying with ${irysPaymentToken}) with tags:`, tags);
        
        // The new uploader.uploadData() might be the method for raw data/buffers
        // Or uploader.upload() if it's smart enough. Check new SDK docs for exact method.
        // Assuming uploadData for now based on common patterns for new SDKs
        const receipt = await uploader.uploadData(dataBuffer, { tags });
        
        console.log(`JSON Data uploaded to Irys. Receipt ID: ${receipt.id}`);
        res.status(200).json({
            message: 'JSON Data uploaded to Arweave via Irys successfully (paid with EVM token)',
            arweaveTxId: receipt.id,
            timestamp: receipt.timestamp // Check if new SDK receipt has timestamp directly
        });
    } catch (error) {
        console.error('Error in /api/signData:', error);
        next(error);
    }
});

app.post('/api/uploadPhoto', upload.single('photoFile'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Extract signed metadata and signature from the request body
        const { metadataToSign, signature, userEOA: clientUserEOA } = req.body;

        // Basic validation for new fields
        if (!metadataToSign || typeof metadataToSign !== 'string') {
            res.status(400).json({ success: false, error: 'Bad Request: metadataToSign (string) is required.' });
            return;
        }
        if (!signature || typeof signature !== 'string') {
            res.status(400).json({ success: false, error: 'Bad Request: signature (string) is required.' });
            return;
        }
        if (!clientUserEOA || !isAddress(clientUserEOA)) {
             res.status(400).json({ success: false, error: 'Bad Request: userEOA (address string) is required.' });
            return;
        }

        // TODO: Consider stricter validation of the signature against the metadataToSign and userEOA if needed for security.
        // For now, we assume the client has handled this and we are just storing the provided signature.

        if (!req.file) {
            res.status(400).json({ success: false, error: 'Bad Request: No photo file provided.' });
            return;
        }
        const photoFile = req.file;
        console.log(`Received photo to upload: ${photoFile.originalname}, Size: ${photoFile.size}, Type: ${photoFile.mimetype}`);
        console.log(`User EOA (from client): ${clientUserEOA}`);
        console.log(`Signed Metadata (string): ${metadataToSign}`);
        console.log(`Signature: ${signature}`);
        
        const uploader = await getUploader();

        try {
            const balanceAtomic = await uploader.getLoadedBalance(); 
            const balanceInStandardUnit = uploader.utils.fromAtomic(balanceAtomic);
            console.log(`Irys node balance: ${balanceAtomic.toString()} atomic units (${balanceInStandardUnit.toString()} ${irysPaymentToken})`);
            if (balanceAtomic.isZero()) { 
                console.warn("Warning: Irys node balance is zero. Upload will likely fail.");
            }
        } catch (balanceError) {
            console.error("Error fetching Irys node balance:", balanceError);
            // Decide if you want to proceed if balance check fails
        }

        const tags = [
            { name: "Content-Type", value: photoFile.mimetype },
            { name: "App-Name", value: "C-Data-POC" }, // Example app tag
            { name: "User-EOA", value: clientUserEOA },
            { name: "Signed-Metadata-JSON", value: metadataToSign }, // Store the JSON string of metadata
            { name: "EOA-Signature", value: signature } // Store the EOA signature
        ];
        console.log(`Attempting to upload photo to Irys (${irysNetwork}, paying with ${irysPaymentToken}) with tags:`, tags);
        
        const receipt = await uploader.upload(photoFile.buffer, { tags });
        console.log(`Photo uploaded to Irys. Receipt ID: ${receipt.id}`);
        
        res.status(200).json({
            success: true, // Add success field
            message: 'Photo uploaded to Arweave via Irys successfully',
            arweaveTxId: receipt.id,
            originalName: photoFile.originalname,
            mimeType: photoFile.mimetype,
            size: photoFile.size,
            timestamp: receipt.timestamp 
        });
    } catch (error: any) { // Explicitly type error as any to access .message
        console.error('Error in /api/uploadPhoto:', error);
        // Ensure a JSON response for errors too
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message || 'Internal server error during photo upload' });
        }
        // next(error); // next(error) might send HTML error page if not handled by a dedicated error middleware
    }
});

app.post('/api/fundIrysNode', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { amount } = req.body;
        let amountToFundStr = amount || '0.005';

        console.log(`Attempting to fund Irys node with ${amountToFundStr} ${irysPaymentToken}`);

        const uploader = await getUploader(); // Use the new service

        // Use uploader.utils.toAtomic for converting amount to fund
        const amountInAtomicUnits = uploader.utils.toAtomic(new BigNumber(amountToFundStr), irysPaymentToken);

        const fundTx = await uploader.fund(amountInAtomicUnits.toString()); // fund likely expects string or BigNumber

        // uploader.utils.fromAtomic for displaying funded amount
        const fundedAmountInStandard = uploader.utils.fromAtomic(new BigNumber(fundTx.quantity), irysPaymentToken);
        console.log(`Successfully funded Irys node. Amount: ${fundedAmountInStandard.toString()} ${irysPaymentToken}, Transaction ID: ${fundTx.id}`);

        const balanceAfterFundAtomic = await uploader.getLoadedBalance();
        const balanceInStandardUnit = uploader.utils.fromAtomic(balanceAfterFundAtomic, irysPaymentToken);
        console.log(`New Irys node balance: ${balanceInStandardUnit.toString()} ${irysPaymentToken}`);

        res.status(200).json({
            message: `Successfully funded Irys node with ${fundedAmountInStandard.toString()} ${irysPaymentToken}`,
            irysTxId: fundTx.id,
            newBalance: `${balanceInStandardUnit.toString()} ${irysPaymentToken}`
        });

    } catch (error) {
        console.error('Error in /api/fundIrysNode:', error);
        next(error);
    }
});

app.post('/api/createAttestation', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const {
            recipient, 
            photoTakenDate, 
            coordinates, 
            arweaveTxId, 
            thumbnailHash 
        } = req.body;

        console.log("[/api/createAttestation] Received data:", req.body);

        if (!recipient || !photoTakenDate || !coordinates || !arweaveTxId || !thumbnailHash) {
            res.status(400).json({ message: "Missing required fields for attestation." });
            return;
        }
        // Use ethers.isAddress for validation
        if (!isAddress(recipient)) { 
            res.status(400).json({ message: "Invalid recipient ETH address." });
            return;
        }
        if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(c => typeof c === 'string')) {
            res.status(400).json({ message: "Coordinates must be an array of two strings." });
            return;
        }

        if (!ethereumMainnetRpcUrl) {
            throw new Error("ETHEREUM_MAINNET_RPC_URL is not configured.");
        }
        if (!EAS_SCHEMA_UID_OP_SEPOLIA) { 
            throw new Error("EAS_SCHEMA_UID_OP_SEPOLIA is not configured.");
        }
        if (!serverEvmWalletSigner) { // Ensure signer is initialized
            throw new Error("Server EVM signer not initialized.");
        }

        const eas = new EAS(EAS_CONTRACT_ADDRESS_OP_SEPOLIA);
        // Use NonceManager with the connected signer
        const signerWithNonceManager = new NonceManager(serverEvmWalletSigner);
        eas.connect(signerWithNonceManager);

        const schemaEncoder = new SchemaEncoder("string photoTakenDate,string[] coordinates,string arweaveTxId,string thumbnailHash");
        const encodedData = schemaEncoder.encodeData([
            { name: "photoTakenDate", value: photoTakenDate, type: "string" },
            { name: "coordinates", value: coordinates, type: "string[]" },
            { name: "arweaveTxId", value: arweaveTxId, type: "string" },
            { name: "thumbnailHash", value: thumbnailHash, type: "string" },
        ]);

        console.log("[/api/createAttestation] Schema UID:", EAS_SCHEMA_UID_OP_SEPOLIA);
        console.log("[/api/createAttestation] Encoded attestation data:", encodedData);

        const tx = await eas.attest({
            schema: EAS_SCHEMA_UID_OP_SEPOLIA,
            data: {
                recipient: recipient,
                expirationTime: NO_EXPIRATION, 
                revocable: true, 
                data: encodedData,
            },
        });

        console.log("[/api/createAttestation] Attestation transaction submitted, tx object:", tx);
        
        const newAttestationUID = await tx.wait(); 
        
        // After tx.wait() resolves, the tx object should be populated with the receipt
        const receipt = tx.receipt; 
        if (!receipt) {
            // This case should ideally not happen if tx.wait() succeeded
            console.error("[/api/createAttestation] Transaction receipt not found on tx object after wait. TX Hash might be unavailable.");
            throw new Error("Failed to get transaction receipt after attestation.");
        }
        const transactionHash = receipt.hash;

        console.log("[/api/createAttestation] Attestation created. New UID:", newAttestationUID, "Tx Hash:", transactionHash);

        res.status(201).json({ 
            message: "Attestation created successfully", 
            attestationUID: newAttestationUID, // Assuming tx.wait() from EAS SDK gives the UID
            transactionHash: transactionHash // Assuming tx.hash from eas.attest() gives the hash
        });

    } catch (error) {
        console.error('Error in /api/createAttestation:', error);
        const errorMessage = (error instanceof Error) ? error.message : JSON.stringify(error);
        res.status(500).json({ message: "Internal Server Error during attestation", error: errorMessage });
        next(error);
    }
});

// Generic error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("[server]: Unhandled error:", err.stack); // Log stack for debugging
    res.status(500).json({
        message: "Internal Server Error",
        error: process.env.NODE_ENV === 'development' ? err.message : "An unexpected error occurred"
    });
});

const checkBalanceAtStartup = async () => {
    try {
        const uploader = await getUploader(); // Use the new service
        const irysBalanceAtomic = await uploader.getLoadedBalance();
        // Use uploader.utils.fromAtomic for converting balance
        const irysBalanceStd = uploader.utils.fromAtomic(irysBalanceAtomic, irysPaymentToken);
        console.log(`[server]: Connected to Irys (${irysNetwork}). Server Irys Node Balance (${irysPaymentToken}): ${irysBalanceStd.toString()}`);

        if (serverEvmWalletSigner && mainnetProvider) {
            // Get balance using the provider
            const ethBalance : bigint = await mainnetProvider.getBalance(serverEvmWalletSigner.address);
            // Use ethers.formatUnits
            console.log(`[server]: Server EVM Wallet (${serverEvmWalletSigner.address}) Ethereum Mainnet ETH Balance: ${formatUnits(ethBalance, 18)} ETH`);
        }

    } catch (error) {
        console.error("[server]: Error during startup balance checks:", error);
    }
};

app.listen(port, () => {
    console.log(`[server]: Backend server is running at http://localhost:${port}`);
    console.log(`[server]: EAS Schema UID (Optimism Sepolia for client): ${EAS_SCHEMA_UID_OP_SEPOLIA}`);
    console.log(`[server]: EAS Contract Address (Optimism Sepolia for client): ${EAS_CONTRACT_ADDRESS_OP_SEPOLIA}`);
    checkBalanceAtStartup();
});

// Export the app if you need to use it for serverless functions or testing
// export default app; 