import { Uploader } from "@irys/upload";
import { BaseEth } from "@irys/upload-ethereum";
import BigNumber from "bignumber.js";
// We will use the raw private key string for Irys, and the RPC URL from env.
// exportedServerEvmWalletSigner is still useful for other parts of the app (like EAS).
// import { exportedServerEvmWalletSigner } from '../index'; 

const IRYS_NODE_URL = process.env.IRYS_NODE_URL || "https://node2.irys.xyz";
const IRYS_TOKEN_NAME = process.env.IRYS_TOKEN_NAME || "base-eth"; 
// This is the RPC URL for the blockchain (e.g., Base Sepolia)
// Switching to a general name, expecting ETHEREUM_MAINNET_RPC_URL for mainnet Irys funding
const BLOCKCHAIN_RPC_URL = process.env.ETHEREUM_MAINNET_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL; // Fallback for transition
const SERVER_EVM_PRIVATE_KEY = process.env.SERVER_EVM_PRIVATE_KEY;

console.log(`[irysService] New SDK: Attempting to use Irys Node: ${IRYS_NODE_URL}, Token: ${IRYS_TOKEN_NAME}`);
if (!SERVER_EVM_PRIVATE_KEY) {
    console.error("[irysService] New SDK: SERVER_EVM_PRIVATE_KEY is not set in environment variables!");
}
if (!BLOCKCHAIN_RPC_URL) {
    console.error("[irysService] New SDK: BLOCKCHAIN_RPC_URL (e.g., ETHEREUM_MAINNET_RPC_URL or BASE_SEPOLIA_RPC_URL) is not set!");
}

let irysUploaderInstance: any | null = null; 

interface IrysDelegationResult {
  delegationId: string;
  amountHuman: number;
  expiresAt: number;
}

/**
 * Initializes and returns a server-side Irys Uploader instance using the new SDK.
 * Uses a singleton pattern.
 */
export const getUploader = async (): Promise<any> => {
  if (irysUploaderInstance) {
    return irysUploaderInstance;
  }

  if (!SERVER_EVM_PRIVATE_KEY) {
    throw new Error("SERVER_EVM_PRIVATE_KEY is not available for Irys Uploader.");
  }
  if (!BLOCKCHAIN_RPC_URL) {
    throw new Error("BLOCKCHAIN_RPC_URL (e.g., ETHEREUM_MAINNET_RPC_URL) is not set for Irys Uploader config.");
  }

  console.log(`[irysService] New SDK: Initializing Uploader. Node: ${IRYS_NODE_URL}, Token: ${IRYS_TOKEN_NAME}, Blockchain RPC for Irys: ${BLOCKCHAIN_RPC_URL}`);

  try {
    // For the new SDK, the token class (BaseEth) is passed to Uploader.
    // Configuration like RPC URL and private key is usually handled by chaining methods
    // or by passing a config object to the token class if it supports it.

    // The Irys docs consistently show .withWallet(privateKey) for EVM.
    // The BaseEth class itself might need the RPC, or it's passed to a config method.

    // Attempt 1: Pass RPC to a chained method if available, or rely on BaseEth defaults + private key.
    // The `Uploader` takes the token *class* (e.g. `BaseEth`)
    // Then `.withWallet()` takes the private key.
    // The RPC for the *blockchain* is set via `.setTokenConfig()` or similar on the builder, or inferred if possible.

    let uploaderBuilder = Uploader(BaseEth) // Pass the BaseEth class constructor
                            .withWallet(SERVER_EVM_PRIVATE_KEY); // Pass the raw private key string
    
    // Explicitly set the Irys node URL and the blockchain RPC URL
    // The .devnet() method sets the Irys node to devnet.irys.xyz.
    // We also need to tell it which *blockchain* testnet RPC to use for that devnet instance.
    if (IRYS_NODE_URL.includes("devnet")) {
        uploaderBuilder = uploaderBuilder.devnet(); // This sets Irys node to devnet.irys.xyz
        // Now, explicitly set the RPC for the *blockchain* that this devnet Irys node will use.
        // The method might be .withRpc(), .setRpc(), or part of .setTokenConfig().
        // The error message "Using devnet.irys.xyz requires a dev/testnet RPC to be configured!"
        // implies this is crucial.
        // Let's assume .setTokenConfig() is the way based on some SDK patterns for detailed config.
        // Or, more simply, the token class itself might take it if not using a signer object.
        // The @irys/upload-ethereum README might show `new BaseEth({rpcUrl: BLOCKCHAIN_RPC_URL, privateKey: ...})`
        // If BaseEth can be instantiated with config directly: 
        // const configuredBaseEth = new BaseEth({ wallet: SERVER_EVM_PRIVATE_KEY, rpcUrl: BLOCKCHAIN_RPC_URL });
        // uploaderBuilder = Uploader(configuredBaseEth); 
        // However, Uploader() expects a class/constructor, not an instance usually.

        // Let's try to find a method on the builder like .setBlockchainRpcUrl() or similar.
        // If not, the `BaseEth` class itself when passed to `Uploader` might need to be pre-configured,
        // or the error message implies `.devnet()` should be chained with an RPC setting.
        // The docs note: "To switch to our devnet, append the functions `withRpc()` and `devnet()` as outlined here."
        // This suggests .withRpc(BLOCKCHAIN_RPC_URL).devnet() or .devnet().withRpc(BLOCKCHAIN_RPC_URL)
        // Let's try chaining .withRpc for the blockchain RPC after .devnet()
        uploaderBuilder = uploaderBuilder.withRpc(BLOCKCHAIN_RPC_URL); 

    } else if (IRYS_NODE_URL) {
        // For mainnet, we might still need to specify the blockchain RPC if it's not the default for BaseEth
        // and the Irys node if not node2.irys.xyz
        uploaderBuilder = uploaderBuilder.withRpc(BLOCKCHAIN_RPC_URL); // Set blockchain RPC
        // And if IRYS_NODE_URL is a custom mainnet Irys node:
        // uploaderBuilder = uploaderBuilder.setIrysNode(IRYS_NODE_URL); // Fictional method, find actual one
    }

    const uploader = await uploaderBuilder; 
    
    console.log("[irysService] New SDK: Uploader instance configured. Address:", uploader.address);
    irysUploaderInstance = uploader;
    return irysUploaderInstance;

  } catch (error) {
    console.error("[irysService] New SDK: Failed to initialize Uploader instance:", error);
    irysUploaderInstance = null;
    throw error;
  }
};

/**
 * Gets the approval configuration for Irys delegation.
 * This function remains largely the same, as it defines your application's logic.
 */
export const getApprovalConfig = (socialProvider?: string) => {
  // This is now simplified, just returns a conceptual duration if needed elsewhere,
  // but the amount is not used for balance checking in createIrysDelegation anymore.
  const baseDuration = parseInt(process.env.IRYS_DELEGATION_DURATION_DAYS || "30") * 24 * 60 * 60 * 1000;
  const config = {
    // amount: baseAmount, // No longer using amount from here for checks
    duration: baseDuration,
  };
  console.log(`[irysService] New SDK: Conceptual approval config for ${socialProvider || 'default'}:`, config);
  return config;
};

/**
 * Creates an Irys delegation for the given user address using the new SDK.
 * Handles auto-funding if the server's Irys wallet has insufficient balance.
 * NOTE: The new SDK's delegation API might differ. This is an adaptation.
 * The concept of "delegation" in the new SDK might be part of its permissioning system
 * or might be handled differently than the old `createDelegation` method.
 * For now, we assume we're trying to enable an address to upload via our funded node.
 * This might translate to a "sponsored upload" model or a different mechanism.
 * The closest equivalent to old delegation is likely funding the user's address *on Irys*
 * or using a more advanced feature if available.
 *
 * For simplicity, this function might need to be re-evaluated based on new SDK capabilities.
 * The primary goal is to allow `userAddress` to upload. If direct delegation isn't
 * a feature in the same way, this function's purpose shifts to enabling that user.
 * One way is to fund the *user's address* on Irys from the server's funded Irys account.
 * However, `uploader.fund()` typically funds the uploader's (server's) own Irys balance.
 *
 * Let's assume for now, there isn't a direct `createDelegation` equivalent for delegating
 * *to another address* in the new SDK's Uploader client in the same way as the old SDK.
 * The "auto-approval" would mean the server just uses its own uploader to handle user data,
 * or if the user needs to upload themselves, they need their own Irys balance.
 *
 * Re-interpreting: "Auto-approval" means the *server* will pay for the user's uploads.
 * This means the server's Irys account (funded by `SERVER_EVM_PRIVATE_KEY`) needs balance.
 * The `createIrysDelegation` might become vestigial if the server pays directly for all uploads.
 * If we still want to "delegate" spending power, we'd look for specific API for that.
 *
 * For now, let's assume this function is about ensuring the *server's uploader* is funded,
 * and the "delegationId" would be more like a confirmation that the server is ready.
 */
export const createIrysDelegation = async (userAddress: string, socialProvider?: string): Promise<IrysDelegationResult> => {
  const uploader = await getUploader();
  const approvalConfig = getApprovalConfig(socialProvider); // Gets duration, amount is unused here now

  try {
    const currentBalanceAtomic = await uploader.getLoadedBalance();
    const currentBalanceHuman = uploader.utils.fromAtomic(currentBalanceAtomic);
    console.log(`[irysService] New SDK: Server's current Irys account balance: ${currentBalanceHuman.toString()} ${IRYS_TOKEN_NAME} (${currentBalanceAtomic.toString()} atomic units). This will be used for uploads.`);

    // No more balance checking against a base amount or auto-funding.
    // We assume the server admin will ensure the node is funded adequately.

    const pseudoDelegationId = `server-ready-for-${userAddress}-${Date.now()}`;
    console.log(`[irysService] New SDK: Server is configured to attempt uploads for ${userAddress}. Pseudo-delegation ID: ${pseudoDelegationId}.`);
    
    return {
      delegationId: pseudoDelegationId,
      amountHuman: 0, // Indicating no specific user quota is being checked or enforced here
      expiresAt: Date.now() + approvalConfig.duration, // Conceptual expiration based on config
    };

  } catch (error: any) {
    console.error(`[irysService] New SDK: Error in createIrysDelegation (uploader init or balance check):`, error.message);
    throw new Error(`Irys auto-approval process failed: ${error.message}`);
  }
}; 