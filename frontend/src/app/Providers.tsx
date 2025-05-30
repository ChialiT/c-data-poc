'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
// import { baseSepolia } from 'viem/chains'; // Old chain
import { optimismSepolia } from 'viem/chains'; // New chain
import { addRpcUrlOverrideToChain } from '@privy-io/chains';

// Override Base Sepolia with an explicit public RPC URL (can be kept for reference or removed)
// const baseSepoliaWithRpcOverride = addRpcUrlOverrideToChain(
//   baseSepolia,
//   'https://sepolia.base.org' 
// );
// console.log("[Providers.tsx] Base Sepolia with RPC Override:", baseSepoliaWithRpcOverride);

// Define Optimism Sepolia, optionally with an RPC override
const optimismSepoliaWithRpcOverride = addRpcUrlOverrideToChain(
  optimismSepolia,
  'https://sepolia.optimism.io' // Common public RPC for Optimism Sepolia
);
console.log("[Providers.tsx] Optimism Sepolia with RPC Override:", optimismSepoliaWithRpcOverride);

export default function Providers({ children }: { children: React.ReactNode }) {
  // console.log('Privy App ID from env:', process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  
  // For logging purposes, construct what will be passed to config
  const configObjectForLogging = {
    appearance: {
      theme: 'light',
      accentColor: '#676FFF',
      showWalletLoginFirst: false,
    },
    loginMethods: ['email', 'wallet', 'google', 'github'],
    embeddedWallets: {
      createOnLogin: 'users-without-wallets',
      requireUserPasswordOnCreate: false,
    },
    defaultChain: optimismSepoliaWithRpcOverride, // Updated defaultChain
    supportedChains: [optimismSepoliaWithRpcOverride], // Updated supportedChains
  };
  console.log("[Providers.tsx] PrivyProvider config (for logging):", configObjectForLogging);

  return (
    <PrivyProvider
      appId='cmb8cowtf00stjs0lktncfuvr'
      config={{
        appearance: {
          theme: 'light',
          accentColor: '#676FFF',
          showWalletLoginFirst: false,
        },
        loginMethods: ['email', 'wallet', 'google', 'github'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          requireUserPasswordOnCreate: false,
        },
        defaultChain: optimismSepoliaWithRpcOverride, // Use Optimism Sepolia
        supportedChains: [optimismSepoliaWithRpcOverride], // Support Optimism Sepolia
      }}
    >
      <SmartWalletsProvider>{children}</SmartWalletsProvider>
    </PrivyProvider>
  );
} 