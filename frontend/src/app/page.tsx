'use client';

import { useState, useEffect, useCallback } from 'react';
// import Image from "next/image"; // Not strictly needed for this basic uploader page
import imageCompression from 'browser-image-compression';
// import exifr from 'exifr'; // Will be imported dynamically
import { sha256 } from 'js-sha256';
import { ethers, BrowserProvider, JsonRpcSigner } from 'ethers';
// import { EAS, SchemaEncoder } from "@ethereum-attestation-service/eas-sdk"; // Added EAS SDK imports
// import Irys from '@irys/sdk'; // OLD SDK - REMOVED

// New Irys SDK imports based on Medium article (Irys-xyz/js-sdk v1.x structure)
import { WebUploader } from '@irys/web-upload'; 
import { WebEthereum } from '@irys/web-upload-ethereum'; 
import { EthersV6Adapter } from '@irys/web-upload-ethereum-ethers-v6'; 

// Extend the Window interface to include ethereum
interface Window {
  ethereum?: any; // You can use a more specific type if available, e.g., EIP1193Provider
}
declare var window: Window;

// Constants for EAS
// const EAS_CONTRACT_ADDRESS_BASE_SEPOLIA = "0x4200000000000000000000000000000000000021"; // Base Sepolia
// const SCHEMA_UID = "0x147ef1689f6c3e4f1d30b35b16d70b775380209723c33c298f6cd41ce1794056";
// const SCHEMA_STRING = "string photoTakenDate,string[] coordinates,string arweaveTxId,string thumbnailHash"; // Matches your schema

// Configuration for Irys (can be moved to a config file or .env.local)
console.log("[DEBUG] Environment Variables:", {
  IRYS_NODE_URL: process.env.NEXT_PUBLIC_IRYS_NODE_URL,
  IRYS_TOKEN_NAME: process.env.NEXT_PUBLIC_IRYS_TOKEN_NAME,
  IRYS_RPC_URL: process.env.NEXT_PUBLIC_IRYS_RPC_URL,
  IRYS_NETWORK_NAME: process.env.NEXT_PUBLIC_IRYS_NETWORK_NAME
});

const IRYS_NODE_URL = process.env.NEXT_PUBLIC_IRYS_NODE_URL || "https://devnet.irys.xyz"; // Or "https://node1.irys.xyz", "https://node2.irys.xyz" for mainnet
const IRYS_TOKEN_NAME = process.env.NEXT_PUBLIC_IRYS_TOKEN_NAME || "ethereum"; // Must match backend token for approvals to work
const IRYS_RPC_URL = process.env.NEXT_PUBLIC_IRYS_RPC_URL; // e.g., For polygon: "https://polygon-rpc.com" or your Infura/Alchemy
const IRYS_NETWORK_NAME = process.env.NEXT_PUBLIC_IRYS_NETWORK_NAME || "mainnet"; // "mainnet" or "devnet"

// TEMPORARY FOR DEBUGGING - Server's EVM private key to derive its Irys Native Address on frontend
const SERVER_IRYS_EVM_KEY_FOR_DEBUG = process.env.NEXT_PUBLIC_SERVER_IRYS_EVM_KEY_FOR_DEBUG;

// Add type definitions for Irys approvals
interface IrysApproval {
  approvedAddress: string;
  amount: string;
  expiresBy: number;
  payingAddress: string;  // Added to track which address created the approval
}

export default function HomePage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [optimizedFile, setOptimizedFile] = useState<File | null>(null); // We might not need to store this in state if we send immediately
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [arweaveTxId, setArweaveTxId] = useState<string>("");
  const [approvalStatus, setApprovalStatus] = useState<string>("Not checked");
  const [serverAddress, setServerAddress] = useState<string | null>(null);
  const [isCheckingApproval, setIsCheckingApproval] = useState(false);
  let sponsorAddress: string | null = null; // Keep this if used elsewhere, or remove if only paidByAddressFromBackend is needed
  let paidByAddressFromBackend: string | null = null; // Declare here

  // State for EAS Attestation Data
  // const [photoTakenDate, setPhotoTakenDate] = useState<string | null>(null);
  // const [coordinates, setCoordinates] = useState<string[] | null>(null); // Schema expects string[]
  const [thumbnailHash, setThumbnailHash] = useState<string | null>(null);

  // Wallet Connection State
  const [ethersProvider, setEthersProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);

  // Dynamically loaded exifr
  const [exifrParser, setExifrParser] = useState<any>(null);

  // New state for sponsor's Irys balance
  const [sponsorIrysBalance, setSponsorIrysBalance] = useState<string | null>(null);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);
  const [sponsorIrysAddress, setSponsorIrysAddress] = useState<string | null>(null);

  // Approval data state
  const [sponsorApprovals, setSponsorApprovals] = useState<any[]>([]);
  const [uploaderApprovals, setUploaderApprovals] = useState<any[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);

  // Add new state for approval balance, transaction cost, missing amount, and token info
  const [uploaderApprovalBalance, setUploaderApprovalBalance] = useState<string | null>(null);
  const [uploaderApprovalToken, setUploaderApprovalToken] = useState<string | null>(null);
  const [estimatedTxCost, setEstimatedTxCost] = useState<string | null>(null);
  const [txToken, setTxToken] = useState<string | null>(null);
  const [approvalMissingAmount, setApprovalMissingAmount] = useState<string | null>(null);
  const [skipBackendApprovalRequest, setSkipBackendApprovalRequest] = useState(false); // New state for the toggle

  // Add new state for API testing
  const [testWalletAddress, setTestWalletAddress] = useState<string | null>(null);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [testApiResult, setTestApiResult] = useState<any>(null);

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
    setFeedbackMessage("");
    setArweaveTxId("");
    setThumbnailHash(null);

    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedFile(file);
      console.log("Selected file:", file.name, file.type, file.size);

      // Generate preview and calculate hash
      const reader = new FileReader();
      reader.onloadend = async () => { 
        const resultStr = reader.result as string;
        setPreviewUrl(resultStr);
        if (resultStr) {
          const hash = await calculateFileHash(file);
          setThumbnailHash(hash);
          console.log("File hash generated:", hash);
        }
      };
      reader.readAsDataURL(file);
    } else {
      setSelectedFile(null);
      setPreviewUrl(null);
      setThumbnailHash(null);
    }
  };

  // Add function to check approval status
  const checkApprovalStatus = async (userAddress: string, serverEvmAddress: string) => {
    let uploaderAddress = userAddress.toLowerCase();
    let sponsorAddress = "";
    
    try {
      console.log("[Approval] Starting approval verification for uploader:", uploaderAddress);
      // First get the sponsor's Irys address from the backend
      const balanceResponse = await fetch('/api/irysBalance');
      const balanceData = await balanceResponse.json();
      
      console.log("[Approval] /api/irysBalance response:", balanceData);
      if (!balanceResponse.ok || !balanceData.irysAddress) {
        throw new Error('Failed to get sponsor Irys address from backend');
      }
      
      sponsorAddress = balanceData.irysAddress.toLowerCase();
      console.log("[Approval] Using sponsor address for approval check:", sponsorAddress);
      console.log("[Approval] Checking approvals for uploader:", uploaderAddress);

      const irysInstance = await (async () => {
        if (!window.ethereum) throw new Error("Wallet not found. Please ensure MetaMask or a compatible wallet is installed.");
        
        if (!ethersProvider) { 
          throw new Error("Ethers provider not set. Please ensure your wallet is connected properly.");
        }

        const providerForAdapter = ethersProvider;
        let uploaderBuilder = WebUploader(WebEthereum)
          .withAdapter(EthersV6Adapter(providerForAdapter));
        
        if (IRYS_RPC_URL) {
          uploaderBuilder = uploaderBuilder.withRpc(IRYS_RPC_URL);
        }
        
        const uploader = await (IRYS_NETWORK_NAME === 'mainnet' 
          ? uploaderBuilder.mainnet()
          : uploaderBuilder.devnet());

        console.log("[Approval] Irys Uploader Initialized. Node URL:", uploader.url, "Token:", uploader.token);
        
        // Verify token matches backend configuration
        if (uploader.token.toLowerCase() !== IRYS_TOKEN_NAME.toLowerCase()) {
          throw new Error(`[Approval] Token mismatch: Frontend using ${uploader.token} but expected ${IRYS_TOKEN_NAME}. Approvals require matching tokens.`);
        }

        return uploader;
      })();

      await irysInstance.ready();
      console.log("[Approval] Irys instance ready. Fetching approvals...");
      
      const approvals = await irysInstance.approval.getApprovals({
        payingAddresses: [sponsorAddress]
      });
      
      console.log(`[Approval] Checking approvals from sponsor [${sponsorAddress}] for uploader [${uploaderAddress}`);
      console.log("[Approval] All approvals:", approvals);
      
      if (!approvals || approvals.length === 0) {
        console.log(`[Approval] No approvals found for uploader [${uploaderAddress}] from sponsor [${sponsorAddress}]`);
        setApprovalStatus(`Uploader [${uploaderAddress}] Not Approved by sponsor [${sponsorAddress}]`);
        return;
      }

      const validApprovals = approvals.filter(approval => {
        const isValid = approval.expiresBy > Date.now();
        const isForUploader = approval.approvedAddress.toLowerCase() === uploaderAddress;
        console.log("[Approval] Checking approval:", {
          approvedAddress: approval.approvedAddress.toLowerCase(),
          uploaderAddress,
          isForUploader,
          expiresBy: new Date(approval.expiresBy).toLocaleString(),
          isValid,
          amount: approval.amount
        });
        return isValid && isForUploader;
      });
      
      if (validApprovals.length > 0) {
        const latestApproval = validApprovals[0];
        console.log("[Approval] Valid approval found:", latestApproval);
        setApprovalStatus(
          `Uploader [${uploaderAddress}] Approved by sponsor [${sponsorAddress}]\n` +
          `Amount: ${latestApproval.amount} atomic units\n` +
          `Expires: ${new Date(latestApproval.expiresBy).toLocaleString()}`
        );
      } else {
        console.log(`[Approval] No valid approvals for uploader [${uploaderAddress}] from sponsor [${sponsorAddress}]`);
        setApprovalStatus(`Uploader [${uploaderAddress}] Not Approved by sponsor [${sponsorAddress}]`);
      }
      
    } catch (error: any) {
      console.error("[Approval] Error checking approval:", error);
      setApprovalStatus(
        `Error checking approval for uploader [${uploaderAddress}]` +
        (sponsorAddress ? ` against sponsor [${sponsorAddress}]` : '') +
        `: ${error.message}`
      );
    }
  };

  // Add effect to get server address on mount
  useEffect(() => {
    const getServerAddress = async () => {
      try {
        const response = await fetch('/api/publicKey');
        const data = await response.json();
        if (data.publicKey) {
          setServerAddress(data.publicKey.toLowerCase()); // Store in lowercase immediately
          console.log("Server EVM address (lowercase):", data.publicKey.toLowerCase());
        }
      } catch (error) {
        console.error("Failed to get server address:", error);
      }
    };
    getServerAddress();
  }, []);

  // Modify handleUploadAndSign to include more verbose logging
  const handleUploadAndSign = async () => {
    if (!selectedFile) {
      setFeedbackMessage("Please select a file first.");
      return;
    }
    if (!connectedAccount || !signer) {
      setFeedbackMessage("Please connect your wallet first.");
      return;
    }
    if (!thumbnailHash) {
      setFeedbackMessage("Please wait for file hash calculation to complete.");
      return;
    }

    setIsProcessing(true);
    setFeedbackMessage("Processing file...");
    setArweaveTxId("");

    let fileToUpload = selectedFile;
    const userAddressLower = connectedAccount.toLowerCase();

    try {
      if (!signer || !ethersProvider) {
        setFeedbackMessage("Wallet provider/signer not available.");
        setIsProcessing(false);
        return;
      }
      if (!sponsorIrysAddress) { // Ensure sponsorIrysAddress is loaded
        setFeedbackMessage("Sponsor Irys address not available. Cannot proceed.");
        setIsProcessing(false);
        return;
      }

      // Sign the file hash
      const messageToSign = `I confirm this is my file with hash: ${thumbnailHash}`;
      console.log("Requesting signature for message:", messageToSign);
      setFeedbackMessage("Please sign the message in your wallet to verify file ownership...");
      
      let signature;
      try {
        signature = await signer.signMessage(messageToSign);
        console.log("File hash signed successfully:", signature);
        setFeedbackMessage("File hash signed. Checking existing approvals...");
      } catch (signError: any) {
        console.error("Error signing file hash:", signError);
        setFeedbackMessage("Failed to sign file hash. Please try again.");
        setIsProcessing(false);
        return;
      }

      // Initialize Irys instance for approval check and upload
      const irysInstance = await (async () => {
        if (!window.ethereum) throw new Error("Wallet not found.");
        if (!ethersProvider) throw new Error("Ethers provider not set.");
        const providerForAdapter = ethersProvider;
        let uploaderBuilder = WebUploader(WebEthereum)
          .withAdapter(EthersV6Adapter(providerForAdapter));
        if (IRYS_RPC_URL) uploaderBuilder = uploaderBuilder.withRpc(IRYS_RPC_URL);
        const uploader = await (IRYS_NETWORK_NAME === 'mainnet' 
          ? uploaderBuilder.mainnet()
          : uploaderBuilder.devnet());
        console.log("[handleUploadAndSign] Irys Uploader Initialized. Node URL:", uploader.url, "Token:", uploader.token);
        if (uploader.token.toLowerCase() !== IRYS_TOKEN_NAME.toLowerCase()) {
          throw new Error(`Token mismatch: Frontend using ${uploader.token} but expected ${IRYS_TOKEN_NAME}.`);
        }
        return uploader;
      })();
      await irysInstance.ready();

      // Client-side check for existing approval from sponsor for this uploader
      let existingValidApproval = false;
      const sponsorAddressLower = sponsorIrysAddress.toLowerCase();
      
      console.log(`[handleUploadAndSign] Checking for existing approval. PayingAddress: ${sponsorAddressLower}, ApprovedAddress: ${userAddressLower}`);
      
      const currentApprovals = await irysInstance.approval.getApprovals({
        payingAddresses: [sponsorAddressLower],
        approvedAddresses: [userAddressLower]
      });

      console.log("[handleUploadAndSign] Existing specific approvals found:", currentApprovals);

      if (currentApprovals && currentApprovals.length > 0) {
        const latestApproval = currentApprovals.find(
          (app: any) => app.approvedAddress.toLowerCase() === userAddressLower && app.expiresBy > Date.now() // expiresBy can be null
        ); // Find the most relevant one if multiple (e.g. sort by timestamp or amount if needed)
        
        if (latestApproval) {
          // Check if amount is sufficient (requires file size)
          const estimatedCostForFile = await irysInstance.getPrice(selectedFile.size);
          const estimatedCostBigInt = BigInt(estimatedCostForFile.toString()); // Convert BigNumber to string first
          const approvalAmountBigInt = BigInt(latestApproval.amount);

          if (approvalAmountBigInt >= estimatedCostBigInt) {
            console.log("[handleUploadAndSign] Found existing valid and sufficient approval:", latestApproval);
            setFeedbackMessage("Sufficient existing approval found. Proceeding with upload...");
            existingValidApproval = true;
          } else {
            console.log(`[handleUploadAndSign] Existing approval found but insufficient. Amount: ${latestApproval.amount}, Cost: ${estimatedCostBigInt.toString()}`);
            setFeedbackMessage("Existing approval found but insufficient for this file size. Requesting new approval...");
          }
        } else {
          console.log("[handleUploadAndSign] No current valid approval found for this uploader from the sponsor.");
          setFeedbackMessage("No existing valid approval found. Requesting new approval...");
        }
      } else {
        console.log("[handleUploadAndSign] No approvals found for this uploader from the sponsor.");
        setFeedbackMessage("No existing approval found. Requesting new approval...");
      }

      // Conditionally request new approval from backend
      if (!existingValidApproval && !skipBackendApprovalRequest) { // Check toggle here
        console.log("[handleUploadAndSign] Requesting new approval from backend (skip toggle is OFF)...");
        const approvalResponse = await fetch('/api/initiateSponsoredUpload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: userAddressLower }),
        });
        const approvalData = await approvalResponse.json();
        console.log("[handleUploadAndSign] New approval response from backend:", approvalData);
        if (!approvalResponse.ok || !approvalData.success) {
          throw new Error(approvalData.message || "Failed to get upload approval from backend.");
        }
        setFeedbackMessage(`Backend confirmed new approval actioned. Receipt ID: ${approvalData.approvalTxId}. Waiting for confirmation...`);
        await new Promise(resolve => setTimeout(resolve, 7000)); // Test with 20-second delay

      } else if (existingValidApproval) {
        console.log("[handleUploadAndSign] Using existing valid approval. Backend request for new one skipped.");
      } else if (skipBackendApprovalRequest) {
        console.log("[handleUploadAndSign] Backend approval request skipped due to toggle. Will attempt upload with whatever Irys finds.");
      }

      // CONSOLIDATED FINAL PRE-UPLOAD CHECK - Runs ALWAYS before upload
      console.log("[FINAL PRE-UPLOAD CHECK] Verifying approval with the upload instance immediately before upload attempt...");
      let finalCheckPassed = false;
      try {
        const finalApprovals = await irysInstance.approval.getApprovals({
          payingAddresses: [sponsorIrysAddress.toLowerCase()],
          approvedAddresses: [userAddressLower]
        });
        console.log("[FINAL PRE-UPLOAD CHECK] Approvals found by upload instance:", finalApprovals);
        if (finalApprovals && finalApprovals.length > 0) {
          const relevantApproval = finalApprovals.find(
            (app: any) => app.approvedAddress.toLowerCase() === userAddressLower &&
                           app.payingAddress.toLowerCase() === sponsorIrysAddress.toLowerCase() &&
                           app.expiresBy > Date.now() // expiresBy can be null
          );
          if (relevantApproval) {
            console.log("[FINAL PRE-UPLOAD CHECK] Found VALID & RELEVANT approval:", relevantApproval);
            const estimatedCostForFile = await irysInstance.getPrice(selectedFile.size);
            const estimatedCostBigInt = BigInt(estimatedCostForFile.toString());
            const approvalAmountBigInt = BigInt(relevantApproval.amount);
            if (approvalAmountBigInt >= estimatedCostBigInt) {
              console.log("[FINAL PRE-UPLOAD CHECK] Approval amount IS SUFFICIENT.");
              finalCheckPassed = true;
            } else {
              console.warn("[FINAL PRE-UPLOAD CHECK] Approval amount INSUFFICIENT.", { amount: relevantApproval.amount, cost: estimatedCostBigInt.toString() });
            }
          } else {
            console.warn("[FINAL PRE-UPLOAD CHECK] No valid/relevant approval found by upload instance matching criteria.");
          }
        } else {
          console.warn("[FINAL PRE-UPLOAD CHECK] No approvals found AT ALL by upload instance for this sponsor/uploader pair.");
        }
      } catch (checkError) {
        console.error("[FINAL PRE-UPLOAD CHECK] Error during final approval check:", checkError);
      }
      
      if (!finalCheckPassed) {
          console.warn("[FINAL PRE-UPLOAD CHECK] Final pre-upload check FAILED or found insufficient approval. Upload might fail or use an unexpected state.");
          // We are proceeding to upload anyway to observe the 402, but logging this failure.
      }

      // The part about serverKeyData.publicKey was removed from the approval check logic above as per instructions.
      // It was previously used in `payingAddressesForCheck` which is now replaced by a more direct check.
      // We still need serverKeyData if the upload itself (not the approval check) requires it for some Irys SDK versions or configurations,
      // but the direct upload to paidBy userAddressLower should not.

      const tags = [
        { name: "Content-Type", value: fileToUpload.type },
        { name: "Original-File-Name", value: fileToUpload.name },
        { name: "User-Wallet-Address", value: userAddressLower },
        { name: "App-Name", value: "CDataPOC-UserOwned-Sponsored" },
        { name: "File-Hash", value: thumbnailHash },
        { name: "Signed-Message", value: messageToSign },
        { name: "Signature", value: signature }
      ];
      
      console.log("Attempting upload to Irys with sponsorship. File:", fileToUpload.name, "User:", userAddressLower, "Tags:", tags);
      setUploadStatus(`Uploading to Irys using approval from ${sponsorIrysAddress}...`);

      // Read file content as ArrayBuffer, then convert to Buffer for irys.upload()
      const fileArrayBuffer = await fileToUpload.arrayBuffer();
      const fileBuffer = Buffer.from(fileArrayBuffer);

      // Log parameters right before upload
      console.log("[UPLOAD ATTEMPT] Uploading with parameters:", {
        fileSize: fileBuffer.length,
        tags,
        paidBy: userAddressLower,
        irysInstanceNodeUrl: irysInstance.url.href,
        irysInstanceToken: irysInstance.token,
        connectedAccount: userAddressLower,
        expectedSponsor: sponsorIrysAddress?.toLowerCase()
      });

      // Use the uploader's address as paidBy since they are the approved address
      const receipt = await irysInstance.upload(fileBuffer, { 
        tags,
        upload: { 
          paidBy: userAddressLower
        }
      });

      console.log('Upload successful:', receipt);
      setArweaveTxId(receipt.id);
      setFeedbackMessage(`Upload successful! Arweave TX ID: ${receipt.id}. View on gateway.irys.xyz/${receipt.id}`);

    } catch (uploadError: any) {
      console.error("Error during Irys upload:", uploadError);
      let errMsg = uploadError.message || "Unknown Irys upload error.";
      if (uploadError.data) {
        errMsg += ` Details: ${JSON.stringify(uploadError.data)}`;
      }
      setFeedbackMessage(`Irys upload failed: ${errMsg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Add a standalone function to check approval status
  const handleCheckApproval = async () => {
    if (!connectedAccount || !serverAddress) {
      setApprovalStatus("Please connect wallet and ensure server address is available");
      return;
    }
    setIsCheckingApproval(true);
    try {
      await checkApprovalStatus(connectedAccount, serverAddress);
    } finally {
      setIsCheckingApproval(false);
    }
  };

  // Add function to check sponsor's Irys balance
  const checkSponsorIrysBalance = async () => {
    if (!serverAddress) {
      setFeedbackMessage("Server address not available");
      return;
    }
    setIsCheckingBalance(true);
    try {
      const response = await fetch('/api/irysBalance');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch balance');
      }
      
      if (!data.irysAddress) {
        throw new Error('Server did not return an Irys address');
      }

      const sponsorAddress = data.irysAddress.toLowerCase();
      const balance = data.balanceStandard;

      if (balance === undefined) {
        throw new Error('Server did not return a balance');
      }

      setSponsorIrysBalance(balance);
      setSponsorIrysAddress(sponsorAddress);
      setFeedbackMessage(`Sponsor [${sponsorAddress}] balance is ${balance} ${data.token}`);
      console.log("Sponsor's Irys balance check:", { sponsorAddress, balance });
    } catch (error: any) {
      console.error("Error checking sponsor balance:", error);
      setFeedbackMessage(`Error checking sponsor balance: ${error.message}`);
    } finally {
      setIsCheckingBalance(false);
    }
  };

  // Add effect to check balance on mount
  useEffect(() => {
    if (serverAddress) {
      checkSponsorIrysBalance();
    }
  }, [serverAddress]);

  // Fetch sponsor approvals
  const fetchSponsorApprovals = async () => {
    setApprovalsLoading(true);
    try {
      // Always fetch sponsor address dynamically and lowercase
      const sponsorAddress = sponsorIrysAddress?.toLowerCase();
      if (!sponsorAddress) {
        setSponsorApprovals([]);
        setApprovalsLoading(false);
      return;
    }
      // Only send valid address
      const res = await fetch(`/api/sponsorApprovals?sponsorAddress=${encodeURIComponent(sponsorAddress)}`);
      const data = await res.json();
      if (data.success) {
        setSponsorApprovals(data.sponsorApprovals || []);
      } else {
        setSponsorApprovals([]);
      }
    } catch (err) {
      setSponsorApprovals([]);
    } finally {
      setApprovalsLoading(false);
    }
  };

  // Fetch uploader approvals
  const fetchUploaderApprovals = async (uploaderAddress: string) => {
    setApprovalsLoading(true);
    try {
      // Always lowercase and filter
      const address = uploaderAddress?.toLowerCase();
      if (!address) {
        setUploaderApprovals([]);
        setApprovalsLoading(false);
        return;
      }
      const res = await fetch(`/api/uploaderApprovals?uploaderAddress=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (data.success) {
        setUploaderApprovals(data.uploaderCreatedApprovals || []);
      } else {
        setUploaderApprovals([]);
      }
    } catch (err) {
      setUploaderApprovals([]);
    } finally {
      setApprovalsLoading(false);
    }
  };

  // Auto-fetch approvals for in-page table
  useEffect(()=>{
    if(sponsorIrysAddress) fetchSponsorApprovals();
    if(connectedAccount) fetchUploaderApprovals(connectedAccount.toLowerCase());
  },[sponsorIrysAddress,connectedAccount]);

  // Fetch uploader approval and estimate tx cost when file or account changes
  useEffect(() => {
    const fetchApprovalAndEstimate = async () => {
      if (!connectedAccount || !selectedFile) {
        setUploaderApprovalBalance(null);
        setUploaderApprovalToken(null);
        setEstimatedTxCost(null);
        setTxToken(null);
        setApprovalMissingAmount(null);
        return;
      }
      try {
        // Fetch uploader approvals
        const resp = await fetch(`/api/uploaderApprovals?uploaderAddress=${connectedAccount.toLowerCase()}`);
        const data = await resp.json();
        if (data.success && data.uploaderCreatedApprovals && data.uploaderCreatedApprovals.length > 0) {
          setUploaderApprovalBalance(data.uploaderCreatedApprovals[0].amount);
          setUploaderApprovalToken(data.uploaderCreatedApprovals[0].token);
        } else {
          setUploaderApprovalBalance('0');
          setUploaderApprovalToken(null);
        }
        // Estimate transaction cost using the same logic as upload (use WebIrys, WebEthereum, EthersV6Adapter)
        const WebIrys = (await import('@irys/web-upload')).WebUploader;
        const WebEthereum = (await import('@irys/web-upload-ethereum')).WebEthereum;
        const EthersV6Adapter = (await import('@irys/web-upload-ethereum-ethers-v6')).EthersV6Adapter;
        if (!window.ethereum) throw new Error('Wallet not found');
        const provider = ethersProvider;
        let uploaderBuilder = WebIrys(WebEthereum).withAdapter(EthersV6Adapter(provider));
        if (IRYS_RPC_URL) uploaderBuilder = uploaderBuilder.withRpc(IRYS_RPC_URL);
        const uploader = await (IRYS_NETWORK_NAME === 'mainnet' ? uploaderBuilder.mainnet() : uploaderBuilder.devnet());
        await uploader.ready();
        const priceAtomic = await uploader.getPrice(selectedFile.size);
        setEstimatedTxCost(priceAtomic.toString());
        setTxToken(uploader.token);
        // Compare approval and tx cost
        if (data.uploaderCreatedApprovals && data.uploaderCreatedApprovals[0]) {
          const approval = BigInt(data.uploaderCreatedApprovals[0].amount);
          const txCost = BigInt(priceAtomic.toString());
          if (approval < txCost) {
            setApprovalMissingAmount((txCost - approval).toString());
          } else {
            setApprovalMissingAmount(null);
          }
        }
      } catch (err) {
        setUploaderApprovalBalance(null);
        setUploaderApprovalToken(null);
        setEstimatedTxCost(null);
        setTxToken(null);
        setApprovalMissingAmount(null);
    }
  };
    fetchApprovalAndEstimate();
  }, [connectedAccount, selectedFile]);

  // Add new function to test uploaderApprovals API
  const handleTestUploaderApprovals = async () => {
    if (!testWalletAddress) {
      setFeedbackMessage("Please enter a wallet address");
      return;
    }
    setIsTestingApi(true);
    try {
      const res = await fetch(`/api/uploaderApprovals?uploaderAddress=${encodeURIComponent(testWalletAddress)}`);
      const data = await res.json();
      if (data.success) {
        setTestApiResult(data.uploaderCreatedApprovals || []);
        setFeedbackMessage("API test successful!");
      } else {
        setTestApiResult(null);
        setFeedbackMessage("API test failed. No approvals found.");
      }
    } catch (error) {
      setTestApiResult(null);
      setFeedbackMessage("API test failed. An error occurred.");
    } finally {
      setIsTestingApi(false);
    }
  };

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

      {/* Add Server & Approval Info Section */}
      {serverAddress && (
        <div className="bg-gray-50 p-4 rounded-lg shadow-sm mb-4 w-full max-w-lg">
          <h3 className="text-sm font-semibold mb-2">Server & Approval Info:</h3>
          <p className="text-xs text-gray-600">Server EVM Address: {serverAddress.toLowerCase()}</p>
          {sponsorIrysAddress && (
            <p className="text-xs text-gray-600">Server Irys Address: {sponsorIrysAddress}</p>
          )}
          {connectedAccount && (
            <p className="text-xs text-gray-600">Your Address (Sponsored): {connectedAccount.toLowerCase()}</p>
          )}
          {sponsorIrysBalance && (
            <p className="text-xs text-gray-600">Server Irys Balance: {sponsorIrysBalance} ETH</p>
          )}
          <p className="text-xs text-gray-600 mt-1">Approval Status: {approvalStatus}</p>
          <p className="text-[10px] text-gray-500">
            Sponsor check uses <code>irys.approval.getApprovals</code>; Table rows show <code>getCreatedApprovals</code> results, hence possible mismatch.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleCheckApproval}
              disabled={isCheckingApproval || !connectedAccount}
              className="mt-2 text-xs bg-blue-500 hover:bg-blue-600 text-white py-1 px-2 rounded disabled:opacity-50">
              {isCheckingApproval ? 'Checking...' : 'Check Uploader Approval'}
            </button>
            <button
              onClick={checkSponsorIrysBalance}
              disabled={isCheckingBalance}
              className="mt-2 text-xs bg-blue-500 hover:bg-blue-600 text-white py-1 px-2 rounded disabled:opacity-50">
              {isCheckingBalance ? 'Checking...' : 'Check Sponsor Balance'}
            </button>
          </div>
        </div>
      )}

      {/* In‑page approvals table */}
      {(sponsorApprovals.length > 0 || uploaderApprovals.length > 0) && (
        <div className="w-full max-w-3xl bg-gray-50 border border-gray-300 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2">Approvals Overview</h3>
          <table className="min-w-full text-xs border">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-2 py-1 border">query</th>
                <th className="px-2 py-1 border">type</th>
                <th className="px-2 py-1 border">amount</th>
                <th className="px-2 py-1 border">payingAddress</th>
                <th className="px-2 py-1 border">approvedAddress</th>
                <th className="px-2 py-1 border">expiresBy</th>
                <th className="px-2 py-1 border">timestamp</th>
                <th className="px-2 py-1 border">token</th>
              </tr>
            </thead>
            <tbody>
              {sponsorApprovals.map((a,i)=>(
                <tr key={`s-${i}`} className="border-t">
                  <td className="px-2 py-1 border">getCreatedApprovals</td>
                  <td className="px-2 py-1 border">sponsor</td>
                  <td className="px-2 py-1 border">{a.amount}</td>
                  <td className="px-2 py-1 border">{a.payingAddress}</td>
                  <td className="px-2 py-1 border">{a.approvedAddress}</td>
                  <td className="px-2 py-1 border">{a.expiresBy ? new Date(a.expiresBy).toLocaleString():''}</td>
                  <td className="px-2 py-1 border">{a.timestamp ? new Date(a.timestamp).toLocaleString():''}</td>
                  <td className="px-2 py-1 border">{a.token}</td>
                </tr>
              ))}
              {uploaderApprovals.map((a,i)=>(
                <tr key={`u-${i}`} className="border-t">
                  <td className="px-2 py-1 border">getCreatedApprovals (uploader)</td>
                  <td className="px-2 py-1 border">uploader</td>
                  <td className="px-2 py-1 border">{a.amount}</td>
                  <td className="px-2 py-1 border">{a.payingAddress}</td>
                  <td className="px-2 py-1 border">{a.approvedAddress}</td>
                  <td className="px-2 py-1 border">{a.expiresBy ? new Date(a.expiresBy).toLocaleString():''}</td>
                  <td className="px-2 py-1 border">{a.timestamp ? new Date(a.timestamp).toLocaleString():''}</td>
                  <td className="px-2 py-1 border">{a.token}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Approval & Transaction Info Section */}
      <div className="w-full max-w-lg mb-4">
        <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-2">
          <h3 className="font-semibold text-yellow-800 mb-2">Uploader Approval & Transaction Info</h3>
          <div className="text-xs text-gray-700 flex flex-col gap-1">
            <div><b>Uploader Address:</b> {connectedAccount?.toLowerCase() || '(not connected)'}</div>
            <div><b>Approval Balance:</b> {uploaderApprovalBalance || 'No approval found'}</div>
            <div><b>Approval Token:</b> {uploaderApprovalToken || '-'}</div>
            <div><b>Transaction Token:</b> {txToken || '-'}</div>
            <div><b>Estimated Transaction Cost (atomic units):</b> {estimatedTxCost || '-'}</div>
            {approvalMissingAmount && (
              <div className="text-red-600"><b>Missing Amount (atomic units):</b> {approvalMissingAmount} (approval insufficient for this file)</div>
            )}
            {!approvalMissingAmount && uploaderApprovalBalance && estimatedTxCost && (
              <div className="text-green-700"><b>Approval is sufficient for this file.</b></div>
            )}
          </div>
          <div className="mt-2">
            <input 
              type="checkbox" 
              id="skipBackendApproval" 
              checked={skipBackendApprovalRequest} 
              onChange={(e) => setSkipBackendApprovalRequest(e.target.checked)} 
              className="mr-2"
            />
            <label htmlFor="skipBackendApproval" className="text-xs text-gray-600">Skip backend new approval request (use existing if found)</label>
          </div>
        </div>
      </div>

      {/* Add API Test Section */}
      <div className="w-full max-w-lg mt-4 bg-blue-50 p-4 rounded-lg border border-blue-200">
        <h3 className="font-semibold text-blue-800 mb-2">Test uploaderApprovals API</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Enter wallet address"
            className="flex-1 px-3 py-2 border rounded text-sm"
            value={testWalletAddress || ''}
            onChange={(e) => setTestWalletAddress(e.target.value)}
          />
          <button
            onClick={handleTestUploaderApprovals}
            disabled={isTestingApi}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {isTestingApi ? 'Testing...' : 'Test API'}
          </button>
        </div>
        {testApiResult && (
          <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
            {JSON.stringify(testApiResult, null, 2)}
          </pre>
        )}
      </div>

      <div className="bg-gray-100 p-8 rounded-lg shadow-md w-full max-w-lg">
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
          disabled={!selectedFile || isProcessing || !connectedAccount || !signer}
          className="mt-6 w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : (connectedAccount ? 'Upload & Sign Photo' : 'Connect Wallet First')}
        </button>

        {feedbackMessage && (
          <p className={`mt-4 text-sm ${feedbackMessage.includes("Error") || feedbackMessage.includes("failed") || feedbackMessage.includes("Warning:") ? 'text-red-500' : 'text-green-600'}`}>
            {feedbackMessage}
          </p>
        )}

        {uploadStatus && (
          <p className="mt-2 text-sm text-blue-500">
            {uploadStatus}
          </p>
        )}
      </div>

    </main>
  );
}
