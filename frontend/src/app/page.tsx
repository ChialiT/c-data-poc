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

import { baseSepolia } from 'viem/chains'; // No need to alias ViemChain if Privy handles chain context

const EAS_CONTRACT_ADDRESS_BASE_SEPOLIA = getAddress("0x4200000000000000000000000000000000000021");
const SCHEMA_UID = "0x147ef1689f6c3e4f1d30b35b16d70b775380209723c33c298f6cd41ce1794056" as Hex;
const SCHEMA_STRING = "string photoTakenDate,string[] coordinates,string arweaveTxId,string thumbnailHash";

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

  const handleSponsoredAttestation = async (/* payload: { recipient: Hex; photoTakenDate: string; coordinates: string[]; arweaveTxId: string; thumbnailHash: string; } */) => {
    // TEMPORARILY OVERRIDE PAYLOAD FOR TESTING WITH MINIMALIST DATA
    const testPayload = {
      recipient: "0x0000000000000000000000000000000000000000" as Hex, // Zero address
      photoTakenDate: "", // Empty string
      coordinates: [] as string[], // Empty array, explicitly typed
      arweaveTxId: "", // Empty string
      thumbnailHash: "", // Empty string
    };

    if (!privySmartWalletClient || !smartAccountAddress) {
      setFeedbackMessage("Privy Smart Wallet client not ready or address not available."); return;
    }
    if (!user?.wallet?.address) {
        setFeedbackMessage("EOA not available. Please ensure you are logged in correctly."); return;
    }
    setFeedbackMessage("Preparing sponsored attestation call to EAS.attest()...");
    try {
      const currentRecipientAddress = getAddress(testPayload.recipient);
      const currentEasContractAddress = getAddress(EAS_CONTRACT_ADDRESS_BASE_SEPOLIA);

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


      const schemaEncoder = new SchemaEncoder(SCHEMA_STRING);
      const encodedSchemaData = schemaEncoder.encodeData([
        { name: "photoTakenDate", value: testPayload.photoTakenDate, type: "string" }, 
        { name: "coordinates", value: testPayload.coordinates, type: "string[]" },
        { name: "arweaveTxId", value: testPayload.arweaveTxId, type: "string" }, 
        { name: "thumbnailHash", value: testPayload.thumbnailHash, type: "string" },
      ]);

      const attestationRequestData = { // Renamed to match EAS struct for clarity
        schema: SCHEMA_UID, 
        data: { // This inner object matches AttestationData struct
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
        to: currentEasContractAddress,
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
    // if (!exifrParser) { setFeedbackMessage("EXIF parser not loaded."); return; } // Keep this if you want to ensure it loads, but we are bypassing its data
    setIsProcessing(true); 
    // setFeedbackMessage("Processing file..."); // Comment out dynamic messages for debug
    // setArweaveTxId(null); // Comment out dynamic messages for debug
    // let localPhotoTakenDate = "", localCoordinates: string[] = [];
    // try {
    //   const exifData = await exifrParser(selectedFile);
    //   if (exifData?.DateTimeOriginal) localPhotoTakenDate = new Date(exifData.DateTimeOriginal).toISOString();
    //   else if (exifData?.CreateDate) localPhotoTakenDate = new Date(exifData.CreateDate).toISOString();
    //   if (exifData?.latitude && exifData?.longitude) localCoordinates = [String(exifData.latitude), String(exifData.longitude)];
    // } catch (e) { console.warn("EXIF parsing failed:", e); setFeedbackMessage("Warn: EXIF parsing failed."); }
    // setFeedbackMessage("Optimizing photo...");
    // try {
      // const currentOptimizedFile = await imageCompression(selectedFile, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true });
      // setFeedbackMessage(`Uploading to Arweave (EOA: ${user.wallet.address}, SCA: ${smartAccountAddress})...`);
      // const formData = new FormData(); formData.append('photoFile', currentOptimizedFile); 
      // formData.append('userId', smartAccountAddress); 
      // const uploadResponse = await fetch('http://localhost:3001/api/uploadPhoto', { method: 'POST', body: formData });
      // const uploadResult = await uploadResponse.json();
      // if (!uploadResponse.ok) throw new Error(uploadResult.message || 'Arweave upload failed');
      // const currentArweaveTxId = uploadResult.arweaveTxId; setArweaveTxId(currentArweaveTxId);
      // setFeedbackMessage(`Arweave upload done! TX: ${currentArweaveTxId}. Sponsoring attestation (from ${smartAccountAddress})...`);
      // if (!thumbnailHash || !currentArweaveTxId) { setFeedbackMessage("Error: Arweave TX ID or Thumbnail Hash missing."); setIsProcessing(false); return; }
      
      // Directly call handleSponsoredAttestation with simplified data, bypassing dynamic data extraction for this test
      setFeedbackMessage("DEBUG: Bypassing dynamic data, calling attestation with hardcoded simple values...");
      await handleSponsoredAttestation(); // No payload passed, as it's hardcoded inside now
    // } catch (err: any) { 
    //   console.error("Processing/upload error:", err); 
    //   const errorMessage = err.details || err.message || (typeof err === 'string' ? err : 'Unknown error');
    //   let displayError = `Error: ${errorMessage}`;
    //    if (err.cause) { 
    //     displayError += ` Cause: ${err.cause.message || JSON.stringify(err.cause)}`;
    //   }
    //   setFeedbackMessage(displayError);
    // } finally { setIsProcessing(false); } // Keep processing false for simplicity or handle it if test runs long
    setIsProcessing(false); // Ensure processing is reset
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
        chain: baseSepolia,
        transport: http(), // Uses default public RPC for baseSepolia via viem
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
    if (!wallets || wallets.length === 0 || !wallets[0].address) { // getEthereumProvider is a function, so check for it later
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
        chain: baseSepolia,
        transport: http(`https://base-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
        // transport: http(), // Use default public RPC for baseSepolia
      });

      const versionSelector = "0x54fd4d50" as Hex; // Selector for version()
      
      setDirectCallResult("Attempting publicClient.call to EAS.version()...");

      const result = await publicClient.call({
        to: EAS_CONTRACT_ADDRESS_BASE_SEPOLIA,
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
    </main>
  );
}
