import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import Irys from '@irys/sdk';
import multer from 'multer';
import { ethers, Wallet, JsonRpcProvider, parseUnits, formatUnits, isAddress, NonceManager, BigNumberish } from 'ethers';
import { EAS, SchemaEncoder, NO_EXPIRATION } from "@ethereum-attestation-service/eas-sdk";

// Remove Arweave direct import if not used elsewhere, or keep if arweave-js direct calls are made
// import Arweave from 'arweave'; 

dotenv.config({ path: '../.env.local' });

const app: Express = express();
const port = process.env.PORT || 3001;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());

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

let serverEvmWalletSigner: Wallet; // This will be our ethers v6 signer instance
let baseProvider: JsonRpcProvider;

try {
    // Initialize provider for Base Sepolia
    baseProvider = new JsonRpcProvider(baseSepoliaRpcUrl);
    // Create a wallet instance from the private key
    const rawWallet = new Wallet(serverEvmPrivateKey);
    // Connect the wallet to the provider to create a Signer
    serverEvmWalletSigner = rawWallet.connect(baseProvider);
    
    console.log(`[server]: EVM Wallet loaded and connected for address: ${serverEvmWalletSigner.address}`);
} catch (error) {
    console.error("Failed to initialize EVM wallet from SERVER_EVM_PRIVATE_KEY or connect to provider:", error);
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

app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'UP', message: 'Backend is running' });
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
        // Use ethers.isAddress for validation (imported directly)
        if (!userId || !ALLOWED_USERS.includes(userId) && !isAddress(userId)) { 
            res.status(403).json({ message: 'Forbidden: User not authorized' });
            return;
        }
        if (!dataToSign) {
            res.status(400).json({ message: 'Bad Request: dataToSign is required' });
            return;
        }
        console.log(`User '${userId}' authorized. Received JSON data to upload:`, dataToSign);
        
        const irys = new Irys({
            network: irysNetwork, 
            token: irysPaymentToken, 
            key: serverEvmPrivateKey, // Irys SDK can take a private key directly
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
    } catch (error) {
        console.error('Error in /api/signData:', error);
        next(error);
    }
});

app.post('/api/uploadPhoto', upload.single('photoFile'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const userId = req.body.userId;
        // Use ethers.isAddress for validation
        if (!userId || !ALLOWED_USERS.includes(String(userId)) && !isAddress(String(userId))) { 
            res.status(403).json({ message: 'Forbidden: User not authorized' });
            return;
        }
        if (!req.file) {
            res.status(400).json({ message: 'Bad Request: No photo file provided.' });
            return;
        }
        const photoFile = req.file;
        console.log(`User '${userId}' authorized. Received photo to upload: ${photoFile.originalname}, Size: ${photoFile.size}, Type: ${photoFile.mimetype}`);
        
        const irys = new Irys({
            network: irysNetwork, 
            token: irysPaymentToken, 
            key: serverEvmPrivateKey,
            config: { providerUrl: baseSepoliaRpcUrl }
        });

        try {
            const balanceAtomic = await irys.getLoadedBalance(); 
            console.log(`Irys node balance for EVM key (token: ${irysPaymentToken}): ${balanceAtomic.toString()} atomic units`);
            const balanceInStandardUnit = parseFloat(formatUnits(balanceAtomic.toString(), 18)); 
            console.log(`Irys node balance in standard units: ${balanceInStandardUnit.toFixed(6)} ${irysPaymentToken}`);
            
            if (balanceAtomic.isZero()) { 
                console.warn("Warning: Irys node balance for EVM key is zero.");
            }
        } catch (balanceError) {
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
    } catch (error) {
        console.error('Error in /api/uploadPhoto:', error);
        next(error);
    }
});

app.post('/api/fundIrysNode', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { amount } = req.body;
        let amountToFundStr = amount || '0.005';

        console.log(`Attempting to fund Irys node with ${amountToFundStr} ${irysPaymentToken}`);

        const irys = new Irys({
            network: irysNetwork, 
            token: irysPaymentToken, 
            key: serverEvmPrivateKey,
            config: { providerUrl: baseSepoliaRpcUrl }
        });

        // Use ethers.parseUnits (returns bigint)
        const amountInAtomicUnits: bigint = parseUnits(amountToFundStr, 18);

        const fundTx = await irys.fund(amountInAtomicUnits.toString()); 

        // Use ethers.formatUnits
        const fundedAmountInStandard = formatUnits(fundTx.quantity.toString(), 18);
        console.log(`Successfully funded Irys node. Amount: ${fundedAmountInStandard} ${irysPaymentToken}, Transaction ID: ${fundTx.id}`);

        const balanceAfterFundAtomic = await irys.getLoadedBalance();
        const balanceInStandardUnit = formatUnits(balanceAfterFundAtomic.toString(), 18);
        console.log(`New Irys node balance: ${balanceInStandardUnit} ${irysPaymentToken}`);

        res.status(200).json({
            message: `Successfully funded Irys node with ${fundedAmountInStandard} ${irysPaymentToken}`,
            irysTxId: fundTx.id,
            newBalance: `${balanceInStandardUnit} ${irysPaymentToken}`
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

        if (!baseSepoliaRpcUrl) {
            throw new Error("BASE_SEPOLIA_RPC_URL is not configured.");
        }
        if (!EAS_SCHEMA_UID) { 
            throw new Error("EAS_SCHEMA_UID_BASE_SEPOLIA is not configured.");
        }
        if (!serverEvmWalletSigner) { // Ensure signer is initialized
            throw new Error("Server EVM signer not initialized.");
        }

        const eas = new EAS(EAS_CONTRACT_ADDRESS_BASE_SEPOLIA);
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

        console.log("[/api/createAttestation] Schema UID:", EAS_SCHEMA_UID);
        console.log("[/api/createAttestation] Encoded attestation data:", encodedData);

        const tx = await eas.attest({
            schema: EAS_SCHEMA_UID,
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
        const irys = new Irys({
            network: irysNetwork,
            token: irysPaymentToken,
            key: serverEvmPrivateKey,
            config: { providerUrl: baseSepoliaRpcUrl }
        });
        const irysBalanceAtomic = await irys.getLoadedBalance();
        // Use ethers.formatUnits (imported directly)
        const irysBalanceStd = formatUnits(irysBalanceAtomic.toString(), 18); 
        console.log(`[server]: Connected to Irys (${irysNetwork}). Server Irys Node Balance (${irysPaymentToken}): ${irysBalanceStd}`);

        if (serverEvmWalletSigner && baseProvider) {
            // Get balance using the provider
            const ethBalance : bigint = await baseProvider.getBalance(serverEvmWalletSigner.address);
            // Use ethers.formatUnits
            console.log(`[server]: Server EVM Wallet (${serverEvmWalletSigner.address}) Base Sepolia ETH Balance: ${formatUnits(ethBalance, 18)} ETH`);
        }

    } catch (error) {
        console.error("[server]: Error during startup balance checks:", error);
    }
};

app.listen(port, () => {
    console.log(`[server]: Backend server is running at http://localhost:${port}`);
    console.log(`[server]: EAS Schema UID: ${EAS_SCHEMA_UID}`);
    console.log(`[server]: EAS Contract Address (Base Sepolia): ${EAS_CONTRACT_ADDRESS_BASE_SEPOLIA}`);
    checkBalanceAtStartup();
}); 