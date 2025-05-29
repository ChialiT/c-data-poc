'use client';

import { useState, useEffect, useCallback } from 'react';
// import Image from "next/image"; // Not strictly needed for this basic uploader page
import imageCompression from 'browser-image-compression';
// import exifr from 'exifr'; // Will be imported dynamically
import { sha256 } from 'js-sha256';
import { ethers, BrowserProvider, JsonRpcSigner } from 'ethers';
// import { EAS, SchemaEncoder } from "@ethereum-attestation-service/eas-sdk"; // Added EAS SDK imports

// Extend the Window interface to include ethereum
interface Window {
  ethereum?: any; // You can use a more specific type if available, e.g., EIP1193Provider
}
declare var window: Window;

// Constants for EAS
// const EAS_CONTRACT_ADDRESS_BASE_SEPOLIA = "0x4200000000000000000000000000000000000021"; // Base Sepolia
// const SCHEMA_UID = "0x147ef1689f6c3e4f1d30b35b16d70b775380209723c33c298f6cd41ce1794056";
// const SCHEMA_STRING = "string photoTakenDate,string[] coordinates,string arweaveTxId,string thumbnailHash"; // Matches your schema

export default function HomePage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [optimizedFile, setOptimizedFile] = useState<File | null>(null); // We might not need to store this in state if we send immediately
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // State for EAS Attestation Data
  // const [photoTakenDate, setPhotoTakenDate] = useState<string | null>(null);
  // const [coordinates, setCoordinates] = useState<string[] | null>(null); // Schema expects string[]
  const [thumbnailHash, setThumbnailHash] = useState<string | null>(null);
  const [arweaveTxId, setArweaveTxId] = useState<string | null>(null); // Will be set after successful upload

  // Wallet Connection State
  const [ethersProvider, setEthersProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);

  // Dynamically loaded exifr
  const [exifrParser, setExifrParser] = useState<any>(null);

  // Helper function to calculate SHA256 hash of a file
  async function calculateFileHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `0x${hashHex}`; // Return as hex string
  }

  // Effect for loading exifr 
  useEffect(() => {
    import('exifr').then(exifrModule => {
      setExifrParser(() => exifrModule.default.parse); 
    }).catch(err => console.error("Failed to load exifr:", err));
  }, []); // Runs once on mount

  // Effect for initializing provider and MetaMask event listeners
  useEffect(() => {
    if (typeof window.ethereum !== 'undefined') {
      console.log('MetaMask is installed!');
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      setEthersProvider(provider);

      const handleAccountsChanged = (accounts: string[]) => {
        console.log("Accounts changed:", accounts);
        if (accounts.length > 0) {
          setConnectedAccount(accounts[0]);
          provider.getSigner().then(setSigner).catch(console.error);
        } else {
          setConnectedAccount(null);
          setSigner(null);
          setFeedbackMessage("Wallet disconnected.");
        }
      };

      const handleChainChanged = (chainId: string) => {
        console.log('Network changed to', chainId);
        // Re-initialize provider and signer for the new chain
        const newProvider = new ethers.BrowserProvider(window.ethereum as any);
        setEthersProvider(newProvider); // This will trigger re-fetch of signer if account is connected
        if (connectedAccount) {
            newProvider.getSigner().then(setSigner).catch(console.error);
        } else {
            setSigner(null); // Ensure signer is cleared if no account connected on new chain
        }
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      // Attempt to get current accounts if already connected/authorized
      provider.send('eth_accounts', [])
        .then((accounts: string[]) => {
          if (accounts.length > 0) {
            handleAccountsChanged(accounts); // This will set account and signer
          }
        })
        .catch(err => console.error("Error fetching initial accounts:", err));

      return () => {
        if (window.ethereum.removeListener) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      };
    } else {
      console.log('MetaMask is not installed. Please install it to connect your wallet.');
    }
  }, []); // Run once to set up provider and listeners

  const connectMetaMask = async () => {
    if (!ethersProvider) {
      setFeedbackMessage('MetaMask is not available. Please install it or ensure it is enabled.');
      alert('MetaMask is not available. Please install it or ensure it is enabled.');
      return;
    }
    try {
      const accounts = await ethersProvider.send('eth_requestAccounts', []) as string[];
      if (accounts.length > 0) {
        setConnectedAccount(accounts[0]);
        const currentSigner = await ethersProvider.getSigner();
        setSigner(currentSigner);
        setFeedbackMessage(`Wallet connected: ${accounts[0]}`);
        console.log("Wallet connected:", accounts[0]);
      }
    } catch (error: any) {
      console.error("Error connecting to MetaMask:", error);
      setFeedbackMessage(`Error connecting wallet: ${error?.message || 'Unknown error'}`);
    }
  };

  const disconnectWallet = () => {
    setConnectedAccount(null);
    setSigner(null);
    // Don't nullify ethersProvider, it's needed for re-connect attempts and listeners
    setFeedbackMessage("Wallet disconnected.");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Reset dependent states
    setFeedbackMessage(null);
    setArweaveTxId(null);
    setThumbnailHash(null); // Reset thumbnail hash too
    // photoTakenDate and coordinates are no longer set here
    // setPhotoTakenDate(null); 
    // setCoordinates(null);

    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedFile(file); // Set selected file for handleUploadAndAttest
      console.log("Selected file:", file.name, file.type, file.size);

      // Generate preview and thumbnail hash
      const reader = new FileReader();
      reader.onloadend = () => { // No need for async here if not awaiting inside
        const resultStr = reader.result as string;
        setPreviewUrl(resultStr);
        if (resultStr) {
          setThumbnailHash(sha256(resultStr));
          console.log("Thumbnail hash generated.");
        }
      };
      reader.readAsDataURL(file);
      // EXIF data will be parsed in handleUploadAndAttest
    } else {
      setSelectedFile(null);
      setPreviewUrl(null);
    }
  };

  const handleUploadAndSign = async () => {
    if (!selectedFile) {
      setFeedbackMessage("Please select a file first.");
      return;
    }
    if (!connectedAccount || !signer) {
      setFeedbackMessage("Please connect your wallet first.");
      return;
    }
    if (!exifrParser) {
      setFeedbackMessage("EXIF parsing library not loaded yet. Please wait a moment and try again.");
      console.error("exifr parser not available when attempting upload.");
      return;
    }

    setIsProcessing(true);
    setFeedbackMessage("Processing file...");
    setArweaveTxId(null); 

    // --- 1. Calculate Hash of Original File for Signing ---
    let fileHashForSigning = "";
    if (selectedFile) { // selectedFile should not be null here due to earlier check, but good practice
        try {
            setFeedbackMessage("Calculating file hash for signing...");
            fileHashForSigning = await calculateFileHash(selectedFile);
            console.log("File hash for signing:", fileHashForSigning);
        } catch (hashError: any) {
            console.error("Error calculating file hash:", hashError);
            setFeedbackMessage(`Error calculating file hash: ${hashError?.message || 'Unknown error'}. Upload cancelled.`);
            setIsProcessing(false);
            return;
        }
    }

    // --- 2. Prepare Message and Get Signature from User ---
    setFeedbackMessage("Awaiting signature...");
    const messageToSign = `I, ${connectedAccount}, attest to uploading the file named '${selectedFile.name}' with SHA256 hash: ${fileHashForSigning}. Timestamp: ${new Date().toISOString()}`;
    let signature = "";
    try {
        if (!signer) { // Should be caught by earlier check, but for safety
            setFeedbackMessage("Wallet signer not available. Please reconnect wallet.");
            setIsProcessing(false);
            return;
        }
        signature = await signer.signMessage(messageToSign);
        console.log("Message signed. Signature:", signature);
    } catch (signError: any) {
        console.error("Error signing message:", signError);
        setFeedbackMessage(`Failed to sign message: ${signError?.message || 'User rejected signing.'}. Upload cancelled.`);
        setIsProcessing(false);
        return;
    }

    // --- 3. Optimize Photo ---
    setFeedbackMessage("Optimizing photo...");
    const options = {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    };

    try {
      console.log('Original file:', selectedFile.name, selectedFile.type, selectedFile.size / 1024 / 1024, 'MB');
      const currentOptimizedFile = await imageCompression(selectedFile, options);
      console.log('Compressed file:', currentOptimizedFile.name, currentOptimizedFile.type, currentOptimizedFile.size / 1024 / 1024, 'MB');
      setFeedbackMessage(`Optimization complete! Uploading to Arweave...`);

      // --- 4. Upload to Arweave ---
      const formData = new FormData();
      formData.append('photoFile', currentOptimizedFile, currentOptimizedFile.name);
      formData.append('userId', connectedAccount);
      formData.append('originalFileName', selectedFile.name);
      formData.append('fileHashSigned', fileHashForSigning);
      formData.append('signedMessage', messageToSign);
      formData.append('signature', signature);

      const uploadResponse = await fetch('http://localhost:3001/api/uploadPhoto', {
        method: 'POST',
        body: formData,
      });
      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploadResult.message || 'Arweave upload failed');
      }
      
      const currentArweaveTxId = uploadResult.arweaveTxId;
      setArweaveTxId(currentArweaveTxId);
      setFeedbackMessage(`Arweave upload successful! TX ID: ${currentArweaveTxId}.`);
      console.log("Arweave Upload result:", uploadResult);

      // Attestation part is already commented out
      setIsProcessing(false); 

    } catch (error: any) {
      console.error("Error during processing or upload:", error);
      setFeedbackMessage(`Error: ${error.message || 'Unknown error'}. See console.`);
    }
  };

  /* // Commenting out the entire EAS attestation function
  const signAndSubmitDelegatedAttestation = async (payload: {
    recipient: string;
    photoTakenDate: string;
    coordinates: string[];
    arweaveTxId: string;
    thumbnailHash: string;
  }) => {
    if (!signer || !ethersProvider || !connectedAccount) {
      setFeedbackMessage("Wallet not properly connected for signing.");
      return;
    }

    setFeedbackMessage("Preparing signature for delegated attestation...");

    try {
      const eas = new EAS(EAS_CONTRACT_ADDRESS_BASE_SEPOLIA);
      // Attempt to connect signer. If EAS SDK v2.x is not fully compatible with ethers v6 Signer,
      // this might be an issue. We are using ethers.BrowserProvider which returns an ethers.Signer (v6).
      eas.connect(signer); 

      // 1. Get Nonce
      const attesterAddress = connectedAccount;
      const rawNonce = await eas.getNonce(attesterAddress); // This returns an ethers.BigNumber (v5)
      const nonceForSig = BigInt(rawNonce.toString()); // Convert ethers.BigNumber to primitive bigint for EIP-712 message
      console.log("Nonce for attester", attesterAddress, ":", nonceForSig);

      // 2. Encode Attestation Data
      const schemaEncoder = new SchemaEncoder(SCHEMA_STRING);
      const encodedData = schemaEncoder.encodeData([
        { name: "photoTakenDate", value: payload.photoTakenDate, type: "string" },
        { name: "coordinates", value: payload.coordinates, type: "string[]" },
        { name: "arweaveTxId", value: payload.arweaveTxId, type: "string" },
        { name: "thumbnailHash", value: payload.thumbnailHash, type: "string" },
      ]);

      // 3. Define EIP-712 Typed Data
      const domain = {
        name: "EAS Attestation",
        version: "1", // Corrected EAS EIP-712 version
        chainId: await signer.provider.getNetwork().then(network => network.chainId), 
        verifyingContract: EAS_CONTRACT_ADDRESS_BASE_SEPOLIA,
      };

      const types = {
        Attest: [
          { name: "schema", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
          { name: "nonce", type: "uint256" }, 
        ],
      };

      const message = {
        schema: SCHEMA_UID,
        recipient: payload.recipient, 
        expirationTime: 0n, // Use BigInt literal 0n for NO_EXPIRATION
        revocable: true, 
        data: encodedData,
        nonce: nonceForSig, // Use the converted BigInt nonce
      };

      console.log("EIP-712 Domain:", domain);
      console.log("EIP-712 Types:", types);
      console.log("EIP-712 Message to sign:", message);

      setFeedbackMessage("Please sign the message in your wallet...");
      
      const signature = await signer.signTypedData(domain, types, message); // Ethers v6 way
      
      console.log("Raw Signature:", signature);
      const { v, r, s } = ethers.Signature.from(signature); // Ethers v6 utility
      console.log("Signature components (v,r,s):", { v, r, s });

      // 5. Send to Backend
      setFeedbackMessage("Signature received. Submitting to backend...");
      const backendPayload = {
        schemaUID: SCHEMA_UID,
        recipient: message.recipient,
        expirationTime: message.expirationTime,
        revocable: message.revocable,
        data: message.data,
        attester: attesterAddress, 
        signature: {
          v: v,
          r: r,
          s: s,
        },
      };

      const attestResponse = await fetch('http://localhost:3001/api/submitDelegatedAttestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backendPayload),
      });

      const attestResult = await attestResponse.json();

      if (attestResponse.ok) {
        setFeedbackMessage(`Delegated attestation successful! UID: ${attestResult.attestationUid || attestResult.txHash}`);
        console.log("Delegated Attestation result:", attestResult);
      } else {
        setFeedbackMessage(`Delegated attestation failed: ${attestResult.message || 'Server error'}`);
        console.error("Delegated Attestation error result:", attestResult);
      }

    } catch (error: any) {
      console.error("Error during signing or submitting delegated attestation:", error);
      setFeedbackMessage(`Error: ${error.message || 'Delegated attestation process failed.'}`);
    }
  }; 
  */

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Upload Photo & Sign</h1>
      
      {/* Placeholder for Privy Login/Logout */}
      <div className="absolute top-4 right-4">
        {connectedAccount && signer ? (
          <div>
            <p className="text-sm text-gray-700">Connected: {connectedAccount.substring(0,6)}...{connectedAccount.substring(connectedAccount.length - 4)}</p>
            <button 
              onClick={disconnectWallet} 
              className="mt-1 text-xs bg-red-500 hover:bg-red-600 text-white py-1 px-2 rounded">
              Disconnect Wallet
            </button>
          </div>
        ) : (
          <button 
            onClick={connectMetaMask}
            className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded">
            Connect MetaMask
          </button>
        )}
      </div>

      <div className="bg-gray-100 p-8 rounded-lg shadow-md w-full max-w-lg"> {/* Increased max-w-lg */}
        <label htmlFor="photoInput" className="block text-sm font-medium text-gray-700 mb-2">
          Choose a photo:
        </label>
        <input
          type="file"
          id="photoInput"
          name="photoInput"
          accept="image/*"
          onChange={handleFileChange}
          disabled={isProcessing}
          className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none p-2 mb-4"
        />
        
        {previewUrl && selectedFile && (
          <div className="mt-4">
            <h3 className="text-lg font-semibold mb-2">Preview:</h3>
            <img src={previewUrl} alt={selectedFile.name} className="max-w-full h-auto rounded-lg shadow-sm" style={{ maxHeight: '200px' }} />
            <p className="text-sm text-gray-600 mt-1">
              Original: {selectedFile.name} ({ (selectedFile.size / 1024 / 1024).toFixed(2) } MB)
            </p>
            {/* Display EXIF data from local variables if needed for UI, or rely on console logs for now */}
            {thumbnailHash && <p className="text-xs text-gray-500">Thumb Hash (SHA256): {thumbnailHash.substring(0,10)}...</p>}
          </div>
        )}

        {/* Display Arweave TX ID if available */}
        {arweaveTxId && (
          <p className="text-sm text-blue-600 mt-2">
            Arweave TX ID: <a href={`https://gateway.irys.xyz/${arweaveTxId}`} target="_blank" rel="noopener noreferrer" className="underline">{arweaveTxId}</a>
          </p>
        )}

        <button
          onClick={handleUploadAndSign} 
          disabled={!selectedFile || isProcessing || !exifrParser || !connectedAccount || !signer}
          className="mt-6 w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : (exifrParser && connectedAccount ? 'Upload & Sign Photo' : 'Connect Wallet / Load Parser...')}
        </button>

        {feedbackMessage && (
          <p className={`mt-4 text-sm ${feedbackMessage.includes("Error") || feedbackMessage.includes("failed") || feedbackMessage.includes("Warning:") ? 'text-red-500' : 'text-green-600'}`}>
            {feedbackMessage}
          </p>
        )}
      </div>
    </main>
  );
}
