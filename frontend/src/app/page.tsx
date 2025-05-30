'use client';

import { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import imageCompression from 'browser-image-compression';
import { sha256 } from 'js-sha256';
import { EAS, SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import { Hex, encodeFunctionData, parseEther, parseGwei, getAddress, createPublicClient, http, createWalletClient, custom } from 'viem';

// Alchemy SDK imports are no longer directly used.
// Linter errors for these might be stale or due to transitive type issues.

// import { baseSepolia } from 'viem/chains'; // Old chain
import { optimismSepolia } from 'viem/chains'; // New chain for Optimism Sepolia

// Base Sepolia Constants (can be kept for reference or removed if no longer switching)
const EAS_CONTRACT_ADDRESS_BASE_SEPOLIA = getAddress("0x4200000000000000000000000000000000000021");
const SCHEMA_UID_BASE_SEPOLIA = "0x147ef1689f6c3e4f1d30b35b16d70b775380209723c33c298f6cd41ce1794056" as Hex;
const SCHEMA_STRING_BASE_SEPOLIA = "string photoTakenDate,string[] coordinates,string arweaveTxId,string thumbnailHash";

// Optimism Sepolia Constants
const EAS_CONTRACT_ADDRESS_OP_SEPOLIA = getAddress("0x4200000000000000000000000000000000000021"); // Same address
const SCHEMA_UID_OP_SEPOLIA = "0x0012cce76ec73664d811d02e96462cca40518ded7321a3937cf94c7211d56d46" as Hex;
const SCHEMA_STRING_OP_SEPOLIA = "string photoTakenDate,string ArweaveTXID,string[] Coordinate,string thumbnailHash";

// System address for a simple, low-cost transaction (e.g., to trigger deployment)
const SYSTEM_ADDRESS_FOR_DEPLOYMENT_TEST = getAddress("0x4200000000000000000000000000000000000006");

// More complete ABI for attest function, including struct definitions
const EAS_ATTEST_FUNCTION_ABI_WITH_STRUCTS = [
  {
    "type": "function",
    "name": "attest",
    "inputs": [
      {
        "name": "request",
        "type": "tuple",
        "internalType": "struct AttestationRequestData",
        "components": [
          { "name": "schema", "type": "bytes32", "internalType": "bytes32" },
          {
            "name": "data",
            "type": "tuple",
            "internalType": "struct AttestationData",
            "components": [
              { "name": "recipient", "type": "address", "internalType": "address" },
              { "name": "expirationTime", "type": "uint64", "internalType": "uint64" },
              { "name": "revocable", "type": "bool", "internalType": "bool" },
              { "name": "refUID", "type": "bytes32", "internalType": "bytes32" },
              { "name": "data", "type": "bytes", "internalType": "bytes" },
              { "name": "value", "type": "uint256", "internalType": "uint256" }
            ]
          }
        ]
      }
    ],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], // EAS attest returns bytes32 UID
    "stateMutability": "payable"
  }
];

// This minimal ABI was causing issues, keeping it for reference but not using for attest
const EAS_ABI_FOR_ENCODING_ONLY = [
  {
    "inputs": [
      {
        "components": [
          { "internalType": "bytes32", "name": "schema", "type": "bytes32" },
          { "internalType": "address", "name": "recipient", "type": "address" },
          { "internalType": "uint64", "name": "expirationTime", "type": "uint64" },
          { "internalType": "bool", "name": "revocable", "type": "bool" },
          { "internalType": "bytes", "name": "data", "type": "bytes" }
        ],
        "internalType": "struct AttestationRequestData",
        "name": "attestation",
        "type": "tuple"
      }
    ],
    "name": "attest",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

export default function HomePage() {
  const { login, logout, ready, authenticated, user } = usePrivy();
  // useWallets() can be kept if you need to display EOA info separately or for other EOA-specific tasks
  const { wallets } = useWallets(); 
  const { client: privySmartWalletClient } = useSmartWallets();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [thumbnailHash, setThumbnailHash] = useState<string | null>(null);
  const [arweaveTxId, setArweaveTxId] = useState<string | null>(null);
  const [connectedAccountAddress, setConnectedAccountAddress] = useState<string | null>(null); // EOA address from user.wallet
  const [smartAccountAddressFromUser, setSmartAccountAddressFromUser] = useState<string | null>(null);
  const [smartAccountAddress, setSmartAccountAddress] = useState<string | null>(null); // This will be the one used in functions
  const [exifrParser, setExifrParser] = useState<any>(null);
  const [isTestingTransfer, setIsTestingTransfer] = useState(false); // New state for test transfer button
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<string | null>(null); // New state for deployment status
  const [directCallResult, setDirectCallResult] = useState<string | null>(null);
  const [deployScaStatus, setDeployScaStatus] = useState<string | null>(null); // For the new deploy button
  const [isDeployingSca, setIsDeployingSca] = useState<boolean>(false); // Corrected type to boolean
  const [eoaSignature, setEoaSignature] = useState<string | null>(null); // For testing EOA signing
  const [arweaveUploadData, setArweaveUploadData] = useState< { metadataToSign: { userEOA: Hex; thumbnailHash: string; }; metadataString: string; signature: string; file: File } | null >(null); 

  // State for Irys auto-approval
  const [isIrysApproved, setIsIrysApproved] = useState<boolean>(false);
  const [irysApprovalLoading, setIrysApprovalLoading] = useState<boolean>(false); // Initially true if we call on load
  const [irysApprovalError, setIrysApprovalError] = useState<string | null>(null);
  const [irysDelegationId, setIrysDelegationId] = useState<string | null>(null);

  useEffect(() => {
    import('exifr').then(exifrModule => setExifrParser(() => exifrModule.default.parse)).catch(err => console.error("Failed to load exifr:", err));
  }, []);

  useEffect(() => {
    if (ready && authenticated && user) {
      console.log("User object after auth:", JSON.parse(JSON.stringify(user)));
      setConnectedAccountAddress(user.wallet?.address || null);

      let determinedSmartWalletAddress: string | null = null;

      if (user.smartWallet && typeof user.smartWallet.address === 'string') {
        console.log("Found smart wallet directly in user.smartWallet:", user.smartWallet);
        determinedSmartWalletAddress = user.smartWallet.address as Hex;
      } else {
        console.log("user.smartWallet not found or invalid, attempting to find in linkedAccounts. All linked accounts:", user.linkedAccounts);
        
        const smartWalletAccount = user.linkedAccounts?.find(
          (account) => account.type === 'smart_wallet'
        );

        // Explicitly check if this found account has an address property of type string
        if (smartWalletAccount && typeof (smartWalletAccount as any).address === 'string') {
          console.log("Found smart_wallet type account in linkedAccounts with an address:", smartWalletAccount);
          determinedSmartWalletAddress = (smartWalletAccount as any).address as Hex;
        } else {
          console.log("Smart wallet NOT found in user.smartWallet, OR no account with type 'smart_wallet' and a valid address string found in linkedAccounts.");
        }
      }
      
      setSmartAccountAddressFromUser(determinedSmartWalletAddress);

    } else {
      setConnectedAccountAddress(null);
      setSmartAccountAddressFromUser(null);
    }
  }, [ready, authenticated, user]);

  // useEffect for Irys Auto-Approval, depends on user and wallets being ready
  useEffect(() => {
    const requestAutoApproval = async (currentUser: typeof user, primaryWallet: typeof wallets[0]) => {
      if (!currentUser || !primaryWallet?.address) return;

      setIrysApprovalLoading(true);
      setIrysApprovalError(null);
      // setIsIrysApproved(false); // Don't reset isIrysApproved here, let it persist if previously true
      // setIrysDelegationId(null); // Don't reset delegationId here for same reason

      try {
        console.log("[Auto-Approval] Requesting for EOA:", primaryWallet.address);
        const backendApiUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:3001';
        const response = await fetch(`${backendApiUrl}/api/irys/auto-approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: primaryWallet.address, 
            socialProvider: primaryWallet.walletClientType || 'embedded_wallet', 
            userId: currentUser.id, 
            // email: currentUser.email?.address, // Ensure this is what you want to send
          }),
        });
        
        const resultText = await response.text(); // Read as text first to handle non-JSON responses
        if (!response.ok) {
          // Handle non-2xx responses that might be HTML (like a 404 page) or plain text errors
          console.error(`[Auto-Approval] API Error (${response.status}):`, resultText);
          let errorMessage = `API Error ${response.status}: `;
          try {
            const jsonError = JSON.parse(resultText); // Try to parse as JSON if server sends structured error
            errorMessage += jsonError.error || jsonError.message || 'Server returned an error.';
          } catch (e) {
            errorMessage += 'Could not parse error response. Check network tab for details.';
          }
          setIrysApprovalError(errorMessage);
          setFeedbackMessage(`Irys Approval Error: ${errorMessage}`);
          setIsIrysApproved(false);
          setIrysApprovalLoading(false);
          return; // Important to exit after handling error
        }

        const result = JSON.parse(resultText); // Now parse as JSON if response.ok
        console.log('[Auto-Approval] Result:', result);

        if (result.success && result.approved) {
          setIsIrysApproved(true);
          setIrysDelegationId(result.delegationId || null);
          setFeedbackMessage(result.message || 'User approved for Irys uploads.');
        } else {
          setIrysApprovalError(result.error || result.message || 'Auto-approval failed.');
          setFeedbackMessage(`Irys Approval Error: ${result.error || result.message || 'Unknown error'}`);
          setIsIrysApproved(false);
        }
      } catch (error: any) {
        console.error('[Auto-Approval] Network or parsing error:', error);
        setIrysApprovalError(error.message || 'Network error during auto-approval.');
        setFeedbackMessage(`Irys Approval Network Error: ${error.message || 'Unknown error'}`);
        setIsIrysApproved(false);
      }
      setIrysApprovalLoading(false);
    };

    if (ready && authenticated && user && wallets && wallets.length > 0 && wallets[0]?.address) {
      // Try once per login/auth change if not already approved and no error previously, or if loading
      if (!isIrysApproved && !irysApprovalError) { // Only attempt if not approved and no prior error
        if (!irysApprovalLoading) { // And not already loading from a previous rapid re-render
          requestAutoApproval(user, wallets[0]);
        }
      } else if (irysApprovalError) {
        console.log("[Auto-Approval] Skipping due to previous error:", irysApprovalError);
      }
    } else if (!authenticated) {
      setIsIrysApproved(false);
      setIrysDelegationId(null);
      setIrysApprovalLoading(false);
      setIrysApprovalError(null);
    }
  }, [ready, authenticated, user, wallets]); // Removed isIrysApproved and irysApprovalLoading from deps to avoid loops on their change

  useEffect(() => {
    console.log("Privy Smart Wallet Client updated:", privySmartWalletClient);
    if (smartAccountAddressFromUser) {
      setSmartAccountAddress(smartAccountAddressFromUser as Hex);
      console.log("Privy Smart Account Address available:", smartAccountAddressFromUser);
      // setFeedbackMessage("Smart Account ready.");
    } else {
      // If smartAccountAddressFromUser is null, ensure smartAccountAddress is also cleared.
      // This handles cases where it might have been set previously but is no longer available.
      setSmartAccountAddress(null);
      if (authenticated && ready) {
        // console.log("Privy Smart Account Address not yet available, client:", privySmartWalletClient);
        // setFeedbackMessage("Waiting for Smart Account to be deployed/available...");
      }
    }
  }, [smartAccountAddressFromUser, authenticated, ready, privySmartWalletClient]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setFeedbackMessage(null); setArweaveTxId(null); setThumbnailHash(null);
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0]; setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => { const resultStr = reader.result as string; setPreviewUrl(resultStr); if (resultStr) setThumbnailHash(sha256(resultStr)); };
      reader.readAsDataURL(file);
    } else { setSelectedFile(null); setPreviewUrl(null); }
  };

  const handleSponsoredAttestation = async (payload?: { photoTakenDate: string; coordinates: string[]; arweaveTxId: string; thumbnailHash: string; userEOA: Hex }) => {
    if (!privySmartWalletClient || !smartAccountAddress) {
      setFeedbackMessage("Privy Smart Wallet client not ready or address not available."); return;
    }
    if (!user?.wallet?.address) {
        setFeedbackMessage("EOA not available. Please ensure you are logged in correctly."); return;
    }
    setFeedbackMessage("Preparing sponsored attestation call to EAS.attest()...");
    try {
      const currentRecipientAddress = getAddress(user.wallet.address);
      // Use OP Sepolia EAS Contract Address
      const currentEasContractAddress = getAddress(EAS_CONTRACT_ADDRESS_OP_SEPOLIA);

      console.log("[Debug Attestation Pre-Check] currentRecipientAddress:", currentRecipientAddress, "typeof:", typeof currentRecipientAddress);
      if (typeof currentRecipientAddress !== 'string' || !currentRecipientAddress.startsWith('0x')) {
        setFeedbackMessage(`ERROR: currentRecipientAddress is invalid before encoding (Pre-Check): ${currentRecipientAddress}`);
        console.error("ERROR: currentRecipientAddress is invalid before encoding (Pre-Check):", currentRecipientAddress);
        return;
      }
      console.log("[Debug Attestation Pre-Check] currentEasContractAddress:", currentEasContractAddress, "typeof:", typeof currentEasContractAddress);
      if (typeof currentEasContractAddress !== 'string' || !currentEasContractAddress.startsWith('0x')) {
        setFeedbackMessage(`ERROR: currentEasContractAddress is invalid before encoding (Pre-Check): ${currentEasContractAddress}`);
        console.error("ERROR: currentEasContractAddress is invalid before encoding (Pre-Check):", currentEasContractAddress);
        return;
      }

      // Use OP Sepolia Schema String
      const schemaEncoder = new SchemaEncoder(SCHEMA_STRING_OP_SEPOLIA);
      const encodedSchemaData = schemaEncoder.encodeData([
        { name: "photoTakenDate", value: payload?.photoTakenDate || "", type: "string" }, 
        { name: "ArweaveTXID", value: payload?.arweaveTxId || "", type: "string" }, 
        { name: "Coordinate", value: payload?.coordinates || [], type: "string[]" },
        { name: "thumbnailHash", value: payload?.thumbnailHash || "", type: "string" },
      ]);

      const attestationRequestData = { 
        schema: SCHEMA_UID_OP_SEPOLIA, // Use OP Sepolia Schema UID
        data: { 
          recipient: currentRecipientAddress,
          expirationTime: 0n,
          revocable: true,
          refUID: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
          data: encodedSchemaData as Hex,
          value: 0n
        }
      };

      console.log("\n[Debug Attestation] About to call encodeFunctionData. Values:");
      console.log("  Target EAS Contract Address (for sendTransaction to):", currentEasContractAddress);
      console.log("  AttestationRequestData.schema (bytes32 for attest):", attestationRequestData.schema, "typeof:", typeof attestationRequestData.schema);
      console.log("  AttestationRequestData.data.recipient (address for attest):", attestationRequestData.data.recipient, "typeof:", typeof attestationRequestData.data.recipient);
      console.log("  AttestationRequestData.data.refUID (bytes32 for attest):", attestationRequestData.data.refUID, "typeof:", typeof attestationRequestData.data.refUID);
      console.log("  AttestationRequestData.data.data (bytes for attest):", attestationRequestData.data.data, "typeof:", typeof attestationRequestData.data.data);
      console.log("  Full AttestationRequestData Object for encodeFunctionData args:", JSON.parse(JSON.stringify(attestationRequestData, (key, value) => typeof value === 'bigint' ? value.toString() + 'n' : value )))

      const attestTxCallData = encodeFunctionData({
        abi: EAS_ATTEST_FUNCTION_ABI_WITH_STRUCTS, // Use the more complete ABI
        functionName: "attest",
        args: [attestationRequestData]
      });

      setFeedbackMessage("Sending sponsored call to EAS.attest()...");
      
      const txHash = await privySmartWalletClient.sendTransaction({
        to: currentEasContractAddress, // Already correctly using the OP Sepolia var due to above change
        data: attestTxCallData,
        value: 0n, 
      });
      
      setFeedbackMessage(`Sponsored EAS.attest() call submitted! Transaction Hash: ${txHash}. Waiting for confirmation...`);

    } catch (error: any) {
      console.error("Sponsored attestation error via Privy Smart Wallet:", error);
      const errorMessage = error.details || error.message || (typeof error === 'string' ? error : 'Unknown error');
      let displayError = `Attestation error: ${errorMessage}`;
      if (error.cause) {
        displayError += ` Cause: ${error.cause.message || JSON.stringify(error.cause)}`;
      } else if (error.data?.message) { 
        displayError += ` Details: ${error.data.message}`;
      } else if (error.error?.message) {
         displayError += ` Details: ${error.error.message}`;
      }
      setFeedbackMessage(displayError);
    }
  };

  const handleUploadAndAttest = async () => {
    if (!selectedFile) { setFeedbackMessage("Please select a file first."); return; }
    if (!authenticated || !user?.wallet?.address || !privySmartWalletClient || !smartAccountAddress) { 
        setFeedbackMessage("Login/Wallet/Smart Account not ready."); return; 
    }
    if (!isIrysApproved) {
        setFeedbackMessage("Irys auto-approval is not complete. Please wait or try refreshing."); return;
    }

    setIsProcessing(true); 
    setFeedbackMessage("Preparing Arweave data and signing with EOA...");
    setArweaveTxId(null);
    setError(null); // Clear previous errors

    try {
      // 1. Prepare and sign Arweave data using EOA
      const signedArweaveData = await handlePrepareAndSignArweaveData(); 
      
      if (!signedArweaveData || !signedArweaveData.file || !signedArweaveData.signature) {
        // Feedback message will be set by handlePrepareAndSignArweaveData on failure
        // setFeedbackMessage("Failed to prepare or sign Arweave data. Please try again.");
        setIsProcessing(false);
        return;
      }

      // Update state if needed, though we are using the direct return value
      setArweaveUploadData(signedArweaveData);

      setFeedbackMessage(`Uploading to Arweave (EOA: ${user.wallet.address}, SCA: ${smartAccountAddress})...`);
      const formData = new FormData(); 
      formData.append('photoFile', signedArweaveData.file); 
      formData.append('metadataToSign', JSON.stringify(signedArweaveData.metadataToSign));
      formData.append('signature', signedArweaveData.signature);
      formData.append('userEOA', signedArweaveData.metadataToSign.userEOA);

      const backendApiUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:3001';
      const uploadResponse = await fetch(`${backendApiUrl}/api/uploadPhoto`, { method: 'POST', body: formData });
      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok || !uploadResult.success) {
        throw new Error(uploadResult.message || uploadResult.error || 'Arweave upload failed');
      }
      
      const currentArweaveTxId = uploadResult.arweaveTxId as Hex; 
      setArweaveTxId(currentArweaveTxId);
      setFeedbackMessage(`Arweave upload done! TX: ${currentArweaveTxId}. Preparing EAS attestation...`);

      if (!thumbnailHash || !currentArweaveTxId || !user.wallet.address) { 
        setFeedbackMessage("Error: Arweave TX ID, Thumbnail Hash, or User EOA missing for EAS."); 
        setIsProcessing(false); 
        return; 
      }
      
      const easAttestationPayload = {
        photoTakenDate: new Date().toISOString(),
        coordinates: ["0", "0"],
        arweaveTxId: currentArweaveTxId,
        thumbnailHash: thumbnailHash,
        userEOA: getAddress(user.wallet.address) as Hex,
      };

      setFeedbackMessage(`Sponsoring EAS attestation (from ${smartAccountAddress}) for Arweave TX ${currentArweaveTxId}...`);
      await handleSponsoredAttestation(easAttestationPayload);

    } catch (err: any) { 
      console.error("Upload and Attest error:", err); 
      const errorMessage = err.details || err.message || (typeof err === 'string' ? err : 'Unknown error');
      let displayError = `Error: ${errorMessage}`;
       if (err.cause) { 
        displayError += ` Cause: ${err.cause.message || JSON.stringify(err.cause)}`;
      }
      setError(displayError);
      setFeedbackMessage(displayError);
    } finally { 
      setIsProcessing(false); 
    }
  };

  // Restore to test sponsored ETH transfer
  const handleTestSponsoredTransfer = async () => {
    if (!privySmartWalletClient || !smartAccountAddress) {
      setError("Smart wallet client or address not available for test transfer.");
      console.error("Test Transfer Error: Smart wallet client or address not available.");
      return;
    }
    if (!user?.wallet?.address) { 
      setError("EOA address not available for test transfer target.");
      console.error("Test Transfer Error: EOA address not available.");
      return;
    }

    setIsTestingTransfer(true); 
    setError(null);
    setTransactionHash(null);
    setFeedbackMessage(`Initiating test sponsored ETH transfer to EOA: ${user.wallet.address}...`);

    try {
      const targetAddress = getAddress(user.wallet.address); 
      console.log(`Initiating test sponsored ETH transfer to EOA: ${targetAddress}...`);

      const testTx = await privySmartWalletClient.sendTransaction({
        to: targetAddress,
        value: parseEther("0.000001"), // Tiny amount of ETH (1000 wei)
        data: '0x', 
      });

      console.log("Test ETH transfer UserOperation hash:", testTx);
      setTransactionHash(`Test ETH Transfer UserOp: ${testTx}`);
      setFeedbackMessage("Test ETH transfer submitted! Hash: " + testTx);

    } catch (e: any) {
      console.error("Test ETH transfer failed:", e);
      setError(`Test ETH Transfer Error: ${e.message || 'Unknown error'}`);
      setFeedbackMessage(`Test ETH transfer Error: ${e.message || 'Unknown error'}`);
    } finally {
      setIsTestingTransfer(false);
    }
  };

  const checkDeploymentStatus = async () => {
    if (!smartAccountAddress) {
      setDeploymentStatus("Smart account address not available to check status.");
      return;
    }
    setDeploymentStatus("Checking deployment status...");
    try {
      const publicClient = createPublicClient({
        chain: optimismSepolia, // Use Optimism Sepolia chain
        transport: http(), // Uses default public RPC for optimismSepolia via viem
      });
      const bytecode = await publicClient.getBytecode({ address: smartAccountAddress as Hex });
      if (bytecode && bytecode !== '0x') {
        setDeploymentStatus(`Account ${smartAccountAddress} IS deployed. Bytecode length: ${bytecode.length}.`);
        console.log('Account deployed. Bytecode:', bytecode);
      } else {
        setDeploymentStatus(`Account ${smartAccountAddress} is NOT deployed (or no bytecode).`);
        console.log('Account not deployed or no bytecode.');
      }
    } catch (e: any) {
      console.error("Failed to check deployment status:", e);
      setDeploymentStatus(`Error checking deployment status: ${e.message}`);
    }
  };

  const handleTestDirectEASCall = async () => {
    console.log("NEXT_PUBLIC_ALCHEMY_API_KEY inside handleTestDirectEASCall:", process.env.NEXT_PUBLIC_ALCHEMY_API_KEY);
    if (!wallets || wallets.length === 0 || !wallets[0].address) { 
      setDirectCallResult("EOA wallet not connected or available.");
      return;
    }
    const eoaWallet = wallets[0];

    if (typeof eoaWallet.getEthereumProvider !== 'function') {
      setDirectCallResult("EOA wallet does not have getEthereumProvider method.");
      return;
    }

    setDirectCallResult("Sending direct call to EAS.version() from EOA...");
    try {
      // Obtain the EIP-1193 provider from the Privy wallet
      // const eip1193Provider = await eoaWallet.getEthereumProvider();
      // if (!eip1193Provider) {
      //   setDirectCallResult("Failed to get Ethereum provider from EOA wallet.");
      //   return;
      // }

      // Create a WalletClient for the EOA using its provider
      // const walletClient = createWalletClient({
      //   account: getAddress(eoaWallet.address), // EOA address
      //   chain: baseSepolia,
      //   transport: custom(eip1193Provider), 
      // });

      const publicClient = createPublicClient({
        chain: optimismSepolia, // Use Optimism Sepolia chain
        // Use Optimism Sepolia Alchemy RPC endpoint
        transport: http(`https://opt-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
      });

      const versionSelector = "0x54fd4d50" as Hex; // Selector for version()
      
      setDirectCallResult("Attempting publicClient.call to EAS.version()...");

      const result = await publicClient.call({
        to: EAS_CONTRACT_ADDRESS_OP_SEPOLIA, // Use Optimism Sepolia EAS contract address
        data: versionSelector,
      });

      // const txHash = await walletClient.sendTransaction({
      //   account: getAddress(eoaWallet.address), // EOA address
      //   to: EAS_CONTRACT_ADDRESS_BASE_SEPOLIA,
      //   data: getSchemaRegistrySelector,
      //   value: 0n, 
      //   chain: baseSepolia, // Explicitly set chainId for EOA calls
      // });
      // setDirectCallResult(`Direct call to getSchemaRegistry() submitted from EOA! TX Hash: ${txHash}. Check console/explorer.`);
      // console.log("Direct EOA call TX hash:", txHash);

      if (result.data) {
        setDirectCallResult(`Direct call to EAS.version() successful! Result (hex data): ${result.data}`);
        console.log("Direct EOA call to version() result (hex data):", result.data);
      } else {
        setDirectCallResult("Direct call to EAS.version() returned no data, but did not error.");
        console.log("Direct EOA call result (no data):", result);
      }

    } catch (e: any) {
      console.error("Direct EOA call to EAS failed:", e);
      setDirectCallResult(`Direct EOA call Error: ${e.message || 'Unknown error'}`);
    }
  };

  const handleDeploySmartAccount = async () => {
    if (!privySmartWalletClient || !smartAccountAddress) {
      setDeployScaStatus("Smart Wallet client or address not available.");
      console.error("Deploy SCA Error: Smart wallet client or address not available.");
      return;
    }

    setIsDeployingSca(true);
    setDeployScaStatus("Initiating Smart Contract Account deployment transaction...");
    setError(null); // Clear previous general errors

    try {
      console.log(`Attempting to deploy SCA ${smartAccountAddress} on Optimism Sepolia by sending a simple transaction.`);

      const txHash = await privySmartWalletClient.sendTransaction({
        to: SYSTEM_ADDRESS_FOR_DEPLOYMENT_TEST,
        data: '0x',
        value: 0n,
      });

      setDeployScaStatus(`SCA deployment/test transaction submitted! Hash: ${txHash}. Check your wallet and block explorer. The SCA will be deployed with this first transaction if it wasn't already.`);
      console.log("SCA deployment/test transaction UserOperation hash:", txHash);

    } catch (e: any) {
      console.error("SCA deployment/test transaction failed:", e);
      const errorMessage = e.details || e.message || (typeof e === 'string' ? e : 'Unknown error');
      let displayError = `SCA Deploy Error: ${errorMessage}`;
      if (e.cause) {
        displayError += ` Cause: ${e.cause.message || JSON.stringify(e.cause)}`;
      }
      setDeployScaStatus(displayError);
      setError(displayError); // Also set general error if desired
    } finally {
      setIsDeployingSca(false);
    }
  };

  // Test function for EOA signing
  const handleTestEOASign = async () => {
    const activeWallet = wallets[0]; // Try using the first wallet from useWallets()

    if (!activeWallet) {
      setFeedbackMessage("User wallet (EOA) not available. Please log in.");
      setError("User wallet (EOA) not available.");
      return;
    }
    setFeedbackMessage("Attempting to sign message with EOA...");
    setError(null);
    setEoaSignature(null);
    try {
      const messageToSign = "Hello from my EOA via Privy!";

      // Get the EIP-1193 provider from the Privy wallet
      const provider = await activeWallet.getEthereumProvider();

      // Create a Viem Wallet Client
      const client = createWalletClient({
        account: activeWallet.address as Hex, // Ensure EOA address is Hex
        chain: optimismSepolia, // Make sure this is your target chain
        transport: custom(provider)
      });

      // Sign the message
      const signature = await client.signMessage({
        account: activeWallet.address as Hex, // Pass the account again here
        message: messageToSign
      });

      setEoaSignature(signature);
      setFeedbackMessage("Successfully signed message with EOA!");
      console.log("EOA Signature:", signature);
    } catch (e: any) {
      console.error("Error signing message with EOA:", e);
      setError(`Error signing message with EOA: ${e.message}`);
      setFeedbackMessage("Failed to sign message with EOA.");
    }
  };

  const handlePrepareAndSignArweaveData = async (): Promise<{ metadataToSign: { userEOA: Hex; thumbnailHash: string; }; metadataString: string; signature: string; file: File } | null> => {
    if (!selectedFile || !thumbnailHash) {
      setFeedbackMessage("Please select a file first (thumbnail hash should also be generated).");
      return null;
    }
    const activeWallet = wallets[0];
    if (!activeWallet || !activeWallet.address) {
      setFeedbackMessage("EOA wallet not available. Please log in.");
      return null;
    }
    if (!exifrParser) {
      setFeedbackMessage("EXIF parser not loaded yet.");
      return null;
    }

    setFeedbackMessage("Preparing Arweave data and signing with EOA...");
    setError(null);
    // setArweaveUploadData(null); // We will return the data instead of just setting state here

    try {
      let photoTakenDate: string | null = null;
      let coordinates: [number, number] | null = null;

      try {
        const exifData = await exifrParser(selectedFile);
        console.log("EXIF Data:", exifData);
        if (exifData?.DateTimeOriginal) {
          photoTakenDate = new Date(exifData.DateTimeOriginal).toISOString();
        } else if (exifData?.CreateDate) {
          photoTakenDate = new Date(exifData.CreateDate).toISOString();
        }

        if (typeof exifData?.latitude === 'number' && typeof exifData?.longitude === 'number') {
          coordinates = [exifData.latitude, exifData.longitude];
        }
      } catch (e) {
        console.warn("EXIF parsing failed or some fields missing:", e);
      }

      const metadataToSign = {
        userEOA: activeWallet.address as Hex,
        thumbnailHash: thumbnailHash,
      };

      const metadataString = JSON.stringify(metadataToSign);
      console.log("Metadata to sign for Arweave:", metadataString);

      const provider = await activeWallet.getEthereumProvider();
      const client = createWalletClient({
        account: activeWallet.address as Hex,
        chain: optimismSepolia, 
        transport: custom(provider)
      });

      const signature = await client.signMessage({
        account: activeWallet.address as Hex,
        message: metadataString 
      });

      const preparedData = { metadataToSign, metadataString, signature: signature, file: selectedFile };
      // setArweaveUploadData(preparedData); // Still set state for other UI elements if needed
      setFeedbackMessage(`Successfully prepared and signed Arweave data (Simplified)! Signature: ${signature.substring(0,10)}...`);
      console.log("Arweave Data Prepared (Simplified):", preparedData);
      return preparedData;

    } catch (e: any) {
      console.error("Error preparing or signing Arweave data:", e);
      setError(`Error preparing/signing Arweave data: ${e.message}`);
      setFeedbackMessage("Failed to prepare and sign Arweave data.");
      return null;
    }
  };

  const renderPrivyAuth = () => {
    if (!ready) return <p className="text-center text-gray-600">Loading Privy...</p>;
    if (authenticated) {
      return (
        <div className="text-center space-y-2">
          <p className="text-green-600 font-semibold">Logged in with Privy!</p>
          {user?.wallet?.address && <p className="text-sm text-gray-700">EOA: {user.wallet.address}</p>}
          {smartAccountAddress ? 
            <p className="text-sm text-gray-700">Smart Account: {smartAccountAddress}</p> : 
            (privySmartWalletClient && authenticated && ready && <p className="text-sm text-orange-500">Deploying Smart Account...</p>)
          }
          <button onClick={logout} className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors">Logout</button>
        </div>
      );
    }
    return <button onClick={login} className="w-full px-6 py-3 bg-blue-500 text-white font-semibold rounded-lg shadow hover:bg-blue-600 transition-colors">Login with Privy</button>;
  };

  console.log("Button disabled state check:", {
    isProcessing,
    selectedFile: !!selectedFile,
    authenticated,
    privySmartWalletClient: !!privySmartWalletClient,
    smartAccountAddress: !!smartAccountAddress,
    exifrParser: !!exifrParser,
    calculatedDisabled: isProcessing || !selectedFile || !authenticated || !privySmartWalletClient || !smartAccountAddress || !exifrParser,
    rawSmartAccountAddress: smartAccountAddress,
    rawPrivySmartWalletClient: privySmartWalletClient
  });

  return (
    <main className="container mx-auto p-4 flex flex-col items-center space-y-6 bg-gray-100 min-h-screen">
      <header className="w-full max-w-2xl my-8">
        <h1 className="text-4xl font-bold text-center text-gray-800 mb-3">Decentralized Photo Attestation</h1>
        <p className="text-lg text-center text-gray-600">Upload your photo, get EXIF data attested on-chain with EAS, and store it on Arweave. Transactions sponsored by Alchemy Paymaster via your Smart Account!</p>
      </header>
      <section className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl space-y-6">
        <h2 className="text-2xl font-semibold text-center text-gray-700">Authentication</h2>
        {renderPrivyAuth()}
      </section>
      {authenticated && (
        <section className="w-full max-w-xl p-6 bg-white rounded-lg shadow-xl space-y-6">
          <h2 className="text-2xl font-semibold text-center text-gray-700 mb-6">Upload & Attest Photo (Sponsored via Smart Account)</h2>
          <div>
            <label htmlFor="photoInput" className="block text-sm font-medium text-gray-700 mb-2">Choose a photo:</label>
            <input type="file" id="photoInput" accept="image/*" onChange={handleFileChange} disabled={isProcessing} className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none p-3 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          </div>
          {previewUrl && selectedFile && (
            <div className="mt-4 border rounded-lg p-4 bg-gray-50">
              <h3 className="text-lg font-semibold mb-2 text-gray-700">Preview:</h3>
              <img src={previewUrl} alt={selectedFile.name} className="max-w-full h-auto rounded-md shadow-sm mx-auto" style={{ maxHeight: '250px' }} />
              <p className="text-sm text-gray-600 mt-2 text-center">{selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</p>
              {thumbnailHash && <p className="text-xs text-gray-500 mt-1 text-center truncate">Thumb Hash: {thumbnailHash}</p>}
            </div>
          )}
          {arweaveTxId && <p className="text-sm text-blue-600 mt-3 text-center">Arweave TX: <a href={`https://viewblock.io/arweave/tx/${arweaveTxId}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-800">{arweaveTxId.substring(0,10)}...</a></p>}
          <button onClick={handleUploadAndAttest} disabled={isProcessing || !selectedFile || !authenticated || !privySmartWalletClient || !smartAccountAddress || !exifrParser} className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center space-x-2">
            {isProcessing ? (<><svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Processing...</span></>) : (<span>Upload & Create Sponsored Attestation</span>)}
          </button>
          {feedbackMessage && <p className={`mt-4 text-sm text-center p-3 rounded-md ${feedbackMessage.includes("Error") || feedbackMessage.includes("failed") || feedbackMessage.includes("Warning:") || feedbackMessage.includes("Could not initialize") ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{feedbackMessage}</p>}
        </section>
      )}
      {/* Button for testing sponsored ETH transfer */}
      <button
        onClick={handleTestSponsoredTransfer} // Changed function call back
        disabled={!ready || !authenticated || !privySmartWalletClient || !smartAccountAddress || isTestingTransfer}
        className="w-full px-6 py-3 mt-4 text-lg font-semibold text-white bg-green-500 rounded-xl shadow-md hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50"
      >
        {isTestingTransfer ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Testing ETH Transfer...
          </span>
        ) : (
          'Test Sponsored ETH Transfer' // Changed button text back
        )}
      </button>
      {transactionHash && (
        <div className="mt-4 p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md break-all">
          {transactionHash}
        </div>
      )}
      {error && (
        <div className="mt-4 p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md break-all">
          {error}
        </div>
      )}
      {/* Button and display for checking deployment status */}
      <div className="w-full max-w-xl mt-4 p-4 bg-white rounded-lg shadow-md">
        <button 
          onClick={checkDeploymentStatus}
          disabled={!smartAccountAddress}
          className="w-full px-6 py-2 bg-indigo-500 text-white font-semibold rounded-lg shadow hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Check Smart Account Deployed Status
        </button>
        {deploymentStatus && (
          <div className="mt-3 p-3 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md break-all">
            {deploymentStatus}
          </div>
        )}
      </div>
      {/* Button for testing direct EOA call to EAS */}
      {authenticated && (
        <div className="w-full max-w-xl mt-4 p-4 bg-white rounded-lg shadow-md">
          <button 
            onClick={handleTestDirectEASCall}
            disabled={!wallets || wallets.length === 0}
            className="w-full px-6 py-2 bg-purple-500 text-white font-semibold rounded-lg shadow hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Test Direct EOA call to EAS.version()
          </button>
          {directCallResult && (
            <div className="mt-3 p-3 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md break-all">
              {directCallResult}
            </div>
          )}
        </div>
      )}
      {/* Button for deploying a new Smart Contract Account */}
      <div className="w-full max-w-xl mt-4 p-4 bg-white rounded-lg shadow-md">
        <button 
          onClick={handleDeploySmartAccount}
          disabled={!ready || !authenticated || !privySmartWalletClient || !smartAccountAddress || isDeployingSca}
          className="w-full px-6 py-2 bg-purple-500 text-white font-semibold rounded-lg shadow hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDeployingSca ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Deploying Smart Contract Account...
            </span>
          ) : (
            'Deploy New Smart Contract Account'
          )}
        </button>
        {deployScaStatus && (
          <div className="mt-3 p-3 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md break-all">
            {deployScaStatus}
          </div>
        )}
      </div>
      <button onClick={handleTestEOASign} disabled={!ready || !authenticated || isProcessing} className="privy-button">Test EOA Sign</button>
      {eoaSignature && <p style={{ wordBreak: 'break-all' }}>EOA Signature: {eoaSignature}</p>}

      <button onClick={handlePrepareAndSignArweaveData} disabled={!ready || !authenticated || !selectedFile || !thumbnailHash || isProcessing || !exifrParser} className="privy-button mt-2">Prepare & Sign Arweave Data</button>
      {arweaveUploadData && <p style={{ wordBreak: 'break-all' }}>Arweave Data Prepared (sig: {arweaveUploadData.signature.substring(0,10)}...)</p>}

      <div className="w-full max-w-xl mt-4 p-4 bg-white rounded-lg shadow-md">
        <h3 className="text-lg font-semibold mb-2 text-gray-700">Irys Upload Approval Status:</h3>
        {irysApprovalLoading && <p className="text-sm text-yellow-600">Checking Irys approval...</p>}
        {irysApprovalError && <p className="text-sm text-red-600">Error: {irysApprovalError}</p>}
        {isIrysApproved && irysDelegationId && <p className="text-sm text-green-600">Approved! Delegation ID: {irysDelegationId.substring(0,10)}...</p>}
        {isIrysApproved && !irysDelegationId && <p className="text-sm text-green-600">Approved!</p>}
        {!irysApprovalLoading && !isIrysApproved && !irysApprovalError && authenticated && <p className="text-sm text-gray-500">Approval not yet granted or checked.</p>}
      </div>

    </main>
  );
}
