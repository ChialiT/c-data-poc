import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import Irys from '@irys/sdk';
import multer from 'multer';
import { ethers, Wallet, JsonRpcProvider, parseUnits, formatUnits, isAddress, NonceManager, BigNumberish } from 'ethers';
// import { EAS, SchemaEncoder, NO_EXPIRATION } from "@ethereum-attestation-service/eas-sdk";

// Remove Arweave direct import if not used elsewhere, or keep if arweave-js direct calls are made
// import Arweave from 'arweave'; 

dotenv.config({ path: './.env' });  // Fixed path to point to backend/.env

const app: Express = express();
const port = process.env.PORT || 3001;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());

// --- Irys Configuration ---
const IRYS_ACTIVE_NET = process.env.IRYS_ACTIVE_NET || 'devnet'; // Default to devnet

let irysConfig: { network: string; token: string; key: string; config?: { providerUrl?: string } };
let activeWalletSigner: Wallet | undefined; // To store the active ethers Wallet signer
let activeRpcProvider: JsonRpcProvider | undefined; // To store the active ethers JsonRpcProvider
let activeWalletAddress: string | undefined; // To store the address of the active wallet

// Devnet Configuration
const IRYS_DEVNET_NETWORK = process.env.IRYS_DEVNET_NETWORK || 'devnet';
const IRYS_DEVNET_TOKEN = process.env.IRYS_DEVNET_TOKEN || 'base-eth';
const IRYS_DEVNET_RPC_URL = process.env.IRYS_DEVNET_RPC_URL;
const IRYS_DEVNET_EVM_PRIVATE_KEY = process.env.IRYS_DEVNET_EVM_PRIVATE_KEY;

// Mainnet Configuration (Paying with EVM token like ETH)
const IRYS_MAINNET_NETWORK = process.env.IRYS_MAINNET_NETWORK || 'mainnet';
const IRYS_MAINNET_TOKEN = process.env.IRYS_MAINNET_TOKEN || 'ethereum'; // e.g., 'ethereum' for native ETH
const IRYS_MAINNET_EVM_PRIVATE_KEY = process.env.IRYS_MAINNET_EVM_PRIVATE_KEY;
const IRYS_MAINNET_RPC_URL = process.env.IRYS_MAINNET_RPC_URL;

if (IRYS_ACTIVE_NET === 'devnet') {
    if (!IRYS_DEVNET_EVM_PRIVATE_KEY || !IRYS_DEVNET_RPC_URL || !IRYS_DEVNET_TOKEN || !IRYS_DEVNET_NETWORK) {
        console.error("Devnet Irys configuration is missing critical values. Check .env.local for IRYS_DEVNET_NETWORK, IRYS_DEVNET_TOKEN, IRYS_DEVNET_EVM_PRIVATE_KEY, IRYS_DEVNET_RPC_URL.");
        process.exit(1);
    }
    try {
        activeRpcProvider = new JsonRpcProvider(IRYS_DEVNET_RPC_URL);
        const rawWallet = new Wallet(IRYS_DEVNET_EVM_PRIVATE_KEY);
        activeWalletSigner = rawWallet.connect(activeRpcProvider);
        activeWalletAddress = activeWalletSigner.address;
        irysConfig = {
            network: IRYS_DEVNET_NETWORK,
            token: IRYS_DEVNET_TOKEN,
            key: IRYS_DEVNET_EVM_PRIVATE_KEY,
            config: { providerUrl: IRYS_DEVNET_RPC_URL }
        };
        console.log(`[server]: Irys configured for DEVNET. Network: ${IRYS_DEVNET_NETWORK}, Token: ${IRYS_DEVNET_TOKEN}, Wallet: ${activeWalletAddress}, RPC: ${IRYS_DEVNET_RPC_URL}`);
    } catch (error) {
        console.error("Failed to initialize EVM wallet for Devnet Irys:", error);
        process.exit(1);
    }
} else if (IRYS_ACTIVE_NET === 'mainnet') {
    if (!IRYS_MAINNET_EVM_PRIVATE_KEY || !IRYS_MAINNET_RPC_URL || !IRYS_MAINNET_TOKEN || !IRYS_MAINNET_NETWORK) {
        console.error("Mainnet Irys configuration (EVM payment) is missing critical values. Check .env.local for IRYS_MAINNET_NETWORK, IRYS_MAINNET_TOKEN, IRYS_MAINNET_EVM_PRIVATE_KEY, IRYS_MAINNET_RPC_URL.");
    process.exit(1);
}
    try {
        activeRpcProvider = new JsonRpcProvider(IRYS_MAINNET_RPC_URL);
        const rawWallet = new Wallet(IRYS_MAINNET_EVM_PRIVATE_KEY);
        activeWalletSigner = rawWallet.connect(activeRpcProvider);
        activeWalletAddress = activeWalletSigner.address;
        irysConfig = {
            network: IRYS_MAINNET_NETWORK, // Tells Irys to use its mainnet nodes (which settle to Arweave)
            token: IRYS_MAINNET_TOKEN,     // The EVM token you're paying with (e.g., "ethereum")
            key: IRYS_MAINNET_EVM_PRIVATE_KEY, // Your EVM private key for payment
            config: { providerUrl: IRYS_MAINNET_RPC_URL } // RPC for the EVM chain you're paying from
        };
        console.log(`[server]: Irys configured for MAINNET (EVM Payment). Network: ${IRYS_MAINNET_NETWORK}, Token: ${IRYS_MAINNET_TOKEN}, Wallet: ${activeWalletAddress}, RPC: ${IRYS_MAINNET_RPC_URL}`);
    } catch (error) {
        console.error("Failed to initialize EVM wallet for Mainnet Irys (EVM payment):", error);
    process.exit(1);
}
} else {
    console.error(`Invalid IRYS_ACTIVE_NET value: ${IRYS_ACTIVE_NET}. Must be 'devnet' or 'mainnet'.`);
    process.exit(1);
}

// EAS Configuration
// const EAS_CONTRACT_ADDRESS_BASE_SEPOLIA = process.env.EAS_SCHEMA_REGISTRY_ADDRESS_BASE_SEPOLIA || "0x4200000000000000000000000000000000000021"; // Default if not in .env
// const EAS_SCHEMA_UID = process.env.EAS_SCHEMA_UID_BASE_SEPOLIA;

// if (!serverEvmPrivateKey) {
//     console.error("SERVER_EVM_PRIVATE_KEY is not set. Check .env.local");
//     process.exit(1);
// }
// if (!baseSepoliaRpcUrl) {
//     console.error("BASE_SEPOLIA_RPC_URL is not set. Check .env.local");
//     process.exit(1);
// }
// if (!irysPaymentToken) {
//     console.error("IRYS_PAYMENT_TOKEN is not set. Check .env.local (e.g., base-eth)");
//     process.exit(1);
// }
/*
if (!EAS_SCHEMA_UID) {
    console.error("EAS_SCHEMA_UID_BASE_SEPOLIA is not set in .env.local. Please add it.");
    process.exit(1);
}
*/

// Placeholder: Adjust this value based on irys.utils.priceForBytes() for your desired approval size (e.g., 10MB)
// and irys.utils.toAtomic() for the chosen token.
// For example, if 10MB costs 0.001 ETH, this would be parseUnits("0.001", 18).toString()
const DEFAULT_APPROVAL_AMOUNT_ATOMIC = process.env.DEFAULT_IRYS_APPROVAL_ATOMIC || "5000000000000000"; // Approx 0.005 ETH/MATIC

if (!activeWalletAddress) {
    console.error("[server]: activeWalletAddress is not defined. This should not happen if Irys config is correct.");
    process.exit(1);
}
const SPONSOR_ADDRESS = activeWalletAddress;

app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'UP', message: 'Backend is running' });
});

// Now returns the server's EVM public address used for Irys payments
app.get('/api/publicKey', (req: Request, res: Response) => {
    // Ensure serverEvmWalletSigner is initialized before accessing its address
    if (activeWalletSigner) {
        res.status(200).json({ publicKey: activeWalletAddress, type: 'EVM' });
    } else {
        // This case should ideally not be hit if initialization succeeded or exited.
        res.status(500).json({ message: "Server EVM wallet not initialized for the active network." });
    }
});

// This endpoint will be called by the frontend before attempting a client-side sponsored upload.
// It ensures the user's address is approved to spend from the server's Irys balance.
app.post('/api/initiateSponsoredUpload', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { userAddress } = req.body;

        console.log('[API] /api/initiateSponsoredUpload called with:', req.body);

        if (!userAddress || !isAddress(userAddress)) {
            console.warn('[API] /api/initiateSponsoredUpload: Invalid userAddress:', userAddress);
            res.status(400).json({ message: 'Bad Request: valid userAddress is required' });
            return;
        }

        if (!activeWalletSigner) {
            console.error('[API] /api/initiateSponsoredUpload: Server EVM wallet not initialized');
            res.status(500).json({ message: "Server EVM wallet not initialized for the active network." });
            return;
        }
        
        console.log(`[server /api/initiateSponsoredUpload] Received request to approve user: ${userAddress}`);

        const irys = new Irys(irysConfig);
        await irys.ready(); // Ensure SDK is ready
        console.log('[API] Irys SDK ready. irys.address:', irys.address, 'irys.token:', irys.token);

        // The server's EVM address that pays for Irys transactions (and whose Irys balance is being approved)
        const serverSponsorEvmAddress = SPONSOR_ADDRESS;
        // The Irys native address equivalent for the server's EVM key. 
        // For @irys/sdk, irys.address often IS the EVM address (lowercase) when initialized with an EVM key.
        const serverSponsorIrysNativeAddress = irys.address; 

        console.log(`[server /api/initiateSponsoredUpload] Server's EVM Address (SPONSOR_ADDRESS variable): ${serverSponsorEvmAddress}`);
        console.log(`[server /api/initiateSponsoredUpload] Server's Irys Native Address according to backend SDK (irys.address): ${serverSponsorIrysNativeAddress}`);

        const approvalAmount = DEFAULT_APPROVAL_AMOUNT_ATOMIC;

        console.log(`[server /api/initiateSponsoredUpload] Creating approval for user ${userAddress} to spend ${approvalAmount} atomic units of ${irys.token}, funded by server's Irys account tied to EVM key (Irys address: ${serverSponsorIrysNativeAddress})`);

        const approvalReceipt = await irys.approval.createApproval({
            approvedAddress: userAddress,
            amount: approvalAmount,
        });

        console.log(`[server /api/initiateSponsoredUpload] Approval creation successful for ${userAddress}. Receipt:`, approvalReceipt);
        if (approvalReceipt) {
            console.log('[API] Approval receipt details:', JSON.stringify(approvalReceipt, null, 2));
        }

        // Simplified response
        res.status(200).json({
            success: true,
            message: `Server has actioned approval for user ${userAddress} to spend ${approvalAmount} atomic units of ${irys.token}. Approval TX ID: ${approvalReceipt.id}. Associated Server EVM: ${serverSponsorEvmAddress}, Server Irys Address (from SDK): ${serverSponsorIrysNativeAddress}.`,
            approvalTxId: approvalReceipt.id,
            approvedAmountAtomic: approvalAmount.toString(),
            irysApprovalReceipt: approvalReceipt,
            sponsorEvmAddress: serverSponsorEvmAddress,
            sponsorIrysAddress: serverSponsorIrysNativeAddress
        });

    } catch (error) {
        console.error('[server /api/initiateSponsoredUpload] Error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).json({ success: false, message: `Failed to initiate sponsored upload: ${errorMessage}` });
        next(error);
    }
});

// const ALLOWED_USERS = ['user1_temp_id', 'user2_temp_id'];

// This endpoint might be deprecated or re-purposed if all uploads are files via /api/uploadPhoto
/*
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
        
        const irys = new Irys(irysConfig);
        const dataBuffer = Buffer.from(JSON.stringify(dataToSign));
        const tags = [{ name: "Content-Type", value: "application/json" }];
        console.log(`Attempting to upload JSON data to Irys (${irysConfig.network}, paying with ${irysConfig.token}) with tags:`, tags);
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
        const { userId, originalFileName, fileHashSigned, signedMessage, signature } = req.body;

        if (!userId || !originalFileName || !fileHashSigned || !signedMessage || !signature || !req.file) {
            res.status(400).json({ message: "Missing required fields for signed upload (userId, originalFileName, fileHashSigned, signedMessage, signature, or photoFile)." });
            return;
        }

        if (!ALLOWED_USERS.includes(String(userId)) && !isAddress(String(userId))) { 
            res.status(403).json({ message: 'Forbidden: User not authorized or invalid address format.' });
            return;
        }
        
        let recoveredAddress;
        try {
            recoveredAddress = ethers.verifyMessage(signedMessage, signature);
        } catch (e: any) {
            console.error("[server /api/uploadPhoto] Signature verification error:", e);
            res.status(400).json({ message: `Signature verification failed: ${e.message || 'Invalid signature format.'}`});
            return;
        }

        if (recoveredAddress.toLowerCase() !== String(userId).toLowerCase()) {
            console.warn(`[server /api/uploadPhoto] Signature mismatch. Claimed: ${userId}, Recovered: ${recoveredAddress}`);
            res.status(403).json({ message: "Forbidden: Signature does not match the provided user address." });
            return;
        }
        console.log(`[server /api/uploadPhoto] Signature verified for user: ${userId}`);

        const photoFile = req.file;
        console.log(`User '${userId}' authorized. Received photo to upload: ${photoFile.originalname}, Size: ${photoFile.size}, Type: ${photoFile.mimetype}`);
        console.log(`Original file name from client: ${originalFileName}, Hash signed: ${fileHashSigned}`);
        
        const irys = new Irys(irysConfig);

        try {
            const balanceAtomic = await irys.getLoadedBalance(); 
            console.log(`Irys node balance (token: ${irys.token}): ${balanceAtomic.toString()} atomic units`);
            // const balanceInStandardUnit = parseFloat(formatUnits(balanceAtomic.toString(), 18)); // formatUnits depends on token decimals
            // For 'arweave', decimals are 12 (winston). For EVM tokens, typically 18.
            const decimals = irys.token === 'arweave' ? 12 : 18;
            const balanceInStandardUnit = parseFloat(formatUnits(balanceAtomic.toString(), decimals)); 
            console.log(`Irys node balance in standard units: ${balanceInStandardUnit.toFixed(decimals)} ${irys.token}`);
            
            if (balanceAtomic.isZero()) { 
                console.warn("Warning: Irys node balance is zero.");
            }
        } catch (balanceError) {
            console.error("Error fetching Irys node balance for EVM key:", balanceError);
        }

        // const tags = [{ name: "Content-Type", value: photoFile.mimetype }];
        const tags = [
            { name: "Content-Type", value: photoFile.mimetype },
            { name: "Uploader-Address", value: String(userId) }, 
            { name: "Signed-Message-Hash", value: ethers.hashMessage(signedMessage) }, // Storing hash of the signed message for brevity/consistency
            // { name: "Signed-Message-Full", value: signedMessage }, // Optional: if you need the full message easily queryable
            { name: "Signature", value: signature },
            { name: "File-Hash-Signed", value: String(fileHashSigned) }, 
            { name: "Original-File-Name", value: String(originalFileName) },
            { name: "App-Name", value: "C-Data-POC" },
            { name: "Timestamp-UTC", value: new Date().toISOString() }
        ];

        console.log(`Attempting to upload photo to Irys (${irysConfig.network}, paying with ${irysConfig.token}) with tags:`, JSON.stringify(tags, null, 2));
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
*/

app.post('/api/fundIrysNode', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { amount } = req.body;
        let amountToFundStr = amount || '0.005';

        console.log(`Attempting to fund Irys node with ${amountToFundStr} ${irysConfig.token}`);

        const irys = new Irys(irysConfig);

        // Use ethers.parseUnits (returns bigint) for EVM tokens. For Arweave (winston), direct number or string.
        // Irys's toAtomic utility might be better for cross-token compatibility if available and simple.
        // const amountInAtomicUnits: bigint = parseUnits(amountToFundStr, 18);
        let amountInAtomicUnitsStr: string;
        if (irys.token === 'arweave') {
            // Assuming amountToFundStr is in AR, convert to Winston (1 AR = 10^12 Winston)
            // For simplicity, if Irys SDK handles string amounts for funding directly:
            // This might require a utility like irys.utils.toAtomic(amountToFundStr, 'arweave') if it exists
            // or manual conversion.
            // The Irys docs show irys.utils.toAtomic(0.05) without specifying token, might infer from irys.token
            // Let's assume irys.utils.toAtomic handles it or direct string for fund()
            // For now, let's use a placeholder and check Irys SDK fund() behavior with string amounts for AR.
            // The docs example `irys.fund(irys.utils.toAtomic(0.05))` suggests `toAtomic` is the way.
            // Let's try to use `irys.utils.toAtomic` which should be present on the Irys instance.
            try {
                 // amountInAtomicUnitsStr = irys.utils.toAtomic(parseFloat(amountToFundStr)).toString(); // toAtomic might take number
                 // Let's assume Irys SDK's fund method is flexible or we use toAtomic.
                 // The .fund() method expects a BigNumberish for EVM tokens, and likely string for AR.
                 // Trying with irys.utils.toAtomic
                 const atomicAmount = irys.utils.toAtomic(parseFloat(amountToFundStr)); // This returns a BigNumber instance from Irys SDK
                 amountInAtomicUnitsStr = atomicAmount.toString();

            } catch (e) {
                console.error("Error converting fund amount to atomic units. Ensure amount is a valid number.", e);
                // Fallback or rethrow, for now logging and using string directly if conversion fails.
                // This part needs careful handling based on Irys SDK's exact API for `toAtomic` and `fund`.
                // For safety, if toAtomic fails, we might default to a raw string if that's ever supported, or error out.
                // The example shows irys.fund(irys.utils.toAtomic(0.05)) - this implies toAtomic is key.
                // Let's ensure parseFloat is robust.
                const numericAmount = parseFloat(amountToFundStr);
                if (isNaN(numericAmount)) {
                    throw new Error("Invalid amount format for funding.");
                }
                amountInAtomicUnitsStr = irys.utils.toAtomic(numericAmount).toString();
            }

        } else { // Assuming EVM token
            const decimals = 18; // Common for EVM tokens
            amountInAtomicUnitsStr = parseUnits(amountToFundStr, decimals).toString();
        }

        const fundTx = await irys.fund(amountInAtomicUnitsStr); 

        // Use ethers.formatUnits or irys.utils.fromAtomic
        // const fundedAmountInStandard = formatUnits(fundTx.quantity.toString(), 18);
        const fundedAmountInStandard = irys.utils.fromAtomic(fundTx.quantity).toString(); // Using Irys util for consistency
        console.log(`Successfully funded Irys node. Amount: ${fundedAmountInStandard} ${irys.token}, Transaction ID: ${fundTx.id}`);

        const balanceAfterFundAtomic = await irys.getLoadedBalance();
        // const balanceInStandardUnit = formatUnits(balanceAfterFundAtomic.toString(), 18);
        const balanceInStandardUnit = irys.utils.fromAtomic(balanceAfterFundAtomic).toString();
        console.log(`New Irys node balance: ${balanceInStandardUnit} ${irys.token}`);

        res.status(200).json({
            message: `Successfully funded Irys node with ${fundedAmountInStandard} ${irys.token}`,
            irysTxId: fundTx.id,
            newBalance: `${balanceInStandardUnit} ${irys.token}`
        });

    } catch (error) {
        console.error('Error in /api/fundIrysNode:', error);
        next(error);
    }
});

// New endpoint to check Irys node balance
app.get('/api/irysBalance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        console.log("[/api/irysBalance] Attempting to check Irys node balance.");
        const irys = new Irys(irysConfig);
        await irys.ready(); // Ensure SDK is ready
        const balanceAtomic = await irys.getLoadedBalance();
        const balanceStd = irys.utils.fromAtomic(balanceAtomic).toString();

        console.log(`[/api/irysBalance] Node balance: ${balanceStd} ${irys.token}`);
        console.log(`[/api/irysBalance] Irys address: ${irys.address}`);

        res.status(200).json({
            token: irys.token,
            balanceAtomic: balanceAtomic.toString(),
            balanceStandard: balanceStd,
            irysAddress: irys.address,
            message: `Current Irys node balance is ${balanceStd} ${irys.token}`
        });
    } catch (error) {
        console.error('Error in /api/irysBalance:', error);
        const errorMessage = (error instanceof Error) ? error.message : JSON.stringify(error);
        res.status(500).json({ message: "Internal Server Error during balance check", error: errorMessage });
        next(error);
    }
});

/* // Commenting out EAS related endpoint /api/createAttestation
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
        // if (!EAS_SCHEMA_UID) { 
        //     throw new Error("EAS_SCHEMA_UID_BASE_SEPOLIA is not configured.");
        // }
        if (!activeWalletSigner) { // Ensure signer is initialized
            throw new Error("Server EVM signer not initialized.");
        }

        // const eas = new EAS(EAS_CONTRACT_ADDRESS_BASE_SEPOLIA);
        // Use NonceManager with the connected signer
        // const signerWithNonceManager = new NonceManager(serverEvmWalletSigner);
        // eas.connect(signerWithNonceManager);

        // const schemaEncoder = new SchemaEncoder("string photoTakenDate,string[] coordinates,string arweaveTxId,string thumbnailHash");
        // const encodedData = schemaEncoder.encodeData([
        //     { name: "photoTakenDate", value: photoTakenDate, type: "string" },
        //     { name: "coordinates", value: coordinates, type: "string[]" },
        //     { name: "arweaveTxId", value: arweaveTxId, type: "string" },
        //     { name: "thumbnailHash", value: thumbnailHash, type: "string" },
        // ]);

        // console.log("[/api/createAttestation] Schema UID:", EAS_SCHEMA_UID);
        // console.log("[/api/createAttestation] Encoded attestation data:", encodedData);

        // const tx = await eas.attest({
        //     schema: EAS_SCHEMA_UID,
        //     data: {
        //         recipient: recipient,
        //         expirationTime: NO_EXPIRATION, 
        //         revocable: true, 
        //         data: encodedData,
        //     },
        // });

        // console.log("[/api/createAttestation] Attestation transaction submitted, tx object:", tx);
        
        // const newAttestationUID = await tx.wait(); 
        
        // After tx.wait() resolves, the tx object should be populated with the receipt
        // const receipt = tx.receipt; 
        // if (!receipt) {
            // This case should ideally not happen if tx.wait() succeeded
        //     console.error("[/api/createAttestation] Transaction receipt not found on tx object after wait. TX Hash might be unavailable.");
        //     throw new Error("Failed to get transaction receipt after attestation.");
        // }
        // const transactionHash = receipt.hash;

        // console.log("[/api/createAttestation] Attestation created. New UID:", newAttestationUID, "Tx Hash:", transactionHash);

        // res.status(201).json({ 
        //     message: "Attestation created successfully", 
        //     attestationUID: newAttestationUID, // Assuming tx.wait() from EAS SDK gives the UID
        //     transactionHash: transactionHash // Assuming tx.hash from eas.attest() gives the hash
        // });

    } catch (error) {
        console.error('Error in /api/createAttestation:', error);
        const errorMessage = (error instanceof Error) ? error.message : JSON.stringify(error);
        res.status(500).json({ message: "Internal Server Error during attestation", error: errorMessage });
        next(error);
    }
});
*/

// Since /api/submitDelegatedAttestation was called by the frontend but not found via grep,
// I will add a comment placeholder here. If it exists, it should be commented out similarly.
/*
app.post('/api/submitDelegatedAttestation', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // ... implementation ...
});
*/

// --- BEGIN: Sponsor Approvals Endpoint ---
app.get('/api/sponsorApprovals', (req: Request, res: Response) => {
  (async () => {
    try {
      console.log('[API] /api/sponsorApprovals called');
      const irys = new Irys(irysConfig);
      await irys.ready();
      const sponsorAddress = (process.env.SPONSOR_ADDRESS || activeWalletAddress || '').toLowerCase();
      if (!sponsorAddress) {
        return res.status(500).json({ success: false, message: 'SPONSOR_ADDRESS not set' });
      }
      // Fetch approvals *created* by sponsor
      // Get approvals the *sponsor* created for any delegates
      const sponsorApprovals = await irys.approval.getCreatedApprovals({});
      console.log('[API] Sponsor approvals:', sponsorApprovals);
      res.json({ success: true, sponsorApprovals });
    } catch (err) {
      const message = (err instanceof Error) ? err.message : 'Unknown error';
      console.error('[API] /api/sponsorApprovals error:', err);
      res.status(500).json({ success: false, message });
    }
  })();
});
// --- END: Sponsor Approvals Endpoint ---

// --- BEGIN: Uploader Approvals Endpoint ---
app.get('/api/uploaderApprovals', (req: Request, res: Response) => {
  (async () => {
    try {
      const uploaderAddress = req.query.uploaderAddress?.toString().toLowerCase();
      console.log('[API] /api/uploaderApprovals called for uploader:', uploaderAddress);
      if (!uploaderAddress) {
        return res.status(400).json({ success: false, message: 'uploaderAddress is required' });
      }
      // Filter out null/undefined
      const approvedAddresses = [uploaderAddress].filter(Boolean);
      if (!approvedAddresses.length) {
        console.warn('[API] /api/uploaderApprovals: No valid uploader address after filtering. Cannot query Irys.');
        return res.status(400).json({ success: false, message: "Missing valid uploader address for Irys query" });
      }
      const irys = new Irys(irysConfig);
      await irys.ready();
      const uploaderCreatedApprovals = await irys.approval.getCreatedApprovals({ approvedAddresses });
      console.log('[API] Uploader createdApprovals:', uploaderCreatedApprovals);
      res.json({ success: true, uploaderCreatedApprovals });
    } catch (err) {
      const message = (err instanceof Error) ? err.message : 'Unknown error';
      console.error('[API] /api/uploaderApprovals error:', err);
      res.status(500).json({ success: false, message });
    }
  })();
});
// --- END: Uploader Approvals Endpoint ---

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
        const irys = new Irys(irysConfig);
        await irys.ready(); // Ensure SDK is ready
        const irysBalanceAtomic = await irys.getLoadedBalance();
        const irysBalanceStd = irys.utils.fromAtomic(irysBalanceAtomic).toString();
        console.log(`[server]: Connected to Irys (${irysConfig.network}). Server Irys Node Balance (${irys.token}): ${irysBalanceStd}`);

        // This EVM balance check only makes sense if devnet is active OR mainnet is using an EVM key
        if (activeWalletSigner && activeRpcProvider) {
            const anEvmBalance : bigint = await activeRpcProvider.getBalance(activeWalletAddress!);
            console.log(`[server]: Server EVM Wallet (${activeWalletAddress}) balance on ${irysConfig.config?.providerUrl}: ${formatUnits(anEvmBalance, 18)} ${irysConfig.token === 'ethereum' ? 'ETH' : irysConfig.token}`);
        } else {
            console.log("[server]: EVM Wallet balance check skipped (not applicable for current config or signer not init).");
        }

    } catch (error) {
        console.error("[server]: Error during startup balance checks:", error);
    }
};

app.listen(port, () => {
    console.log(`[server]: Backend server is running at http://localhost:${port}`);
    console.log(`[server]: Irys Active Network: ${IRYS_ACTIVE_NET}`);
    // console.log(`[server]: EAS Schema UID: ${EAS_SCHEMA_UID}`);
    // console.log(`[server]: EAS Contract Address (Base Sepolia): ${EAS_CONTRACT_ADDRESS_BASE_SEPOLIA}`);
    checkBalanceAtStartup();
    console.log(`[server]: SPONSOR ADDRESS for Irys balance approvals: ${SPONSOR_ADDRESS}`);
}); 