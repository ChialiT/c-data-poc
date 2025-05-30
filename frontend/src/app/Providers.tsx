'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
import { baseSepolia } from 'viem/chains';
import { addRpcUrlOverrideToChain } from '@privy-io/chains';

// Override Base Sepolia with an explicit public RPC URL
const baseSepoliaWithRpcOverride = addRpcUrlOverrideToChain(
  baseSepolia,
  'https://sepolia.base.org' // Using a public RPC for Base Sepolia
);
console.log("[Providers.tsx] Base Sepolia with RPC Override:", baseSepoliaWithRpcOverride);

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
    defaultChain: baseSepoliaWithRpcOverride,
    supportedChains: [baseSepoliaWithRpcOverride],
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
        defaultChain: baseSepoliaWithRpcOverride,
        supportedChains: [baseSepoliaWithRpcOverride],
      }}
    >
      <SmartWalletsProvider>{children}</SmartWalletsProvider>
    </PrivyProvider>
  );
} 