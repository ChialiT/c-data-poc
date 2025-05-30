# Crowd-Sourced Data Collection POC
## Technical Specification & Development Phases

### Overview

This Proof of Concept (POC) demonstrates a decentralized crowd-sourced data collection platform that enables users to easily contribute geo-tagged photos with verifiable metadata. The system leverages blockchain attestations for data integrity, decentralized storage for permanence, and sponsored transactions for seamless user experience.

### Core Value Proposition

- **Zero-friction user onboarding**: Users don't need existing crypto wallets or gas tokens
- **Verifiable data provenance**: All submissions are cryptographically attested
- **Permanent storage**: Photos and metadata stored on Arweave for long-term accessibility
- **Transparent data collection**: All attestations are publicly verifiable on-chain

### Technology Stack

**Frontend & User Management:**
- Privy (Account Abstraction & wallet generation)
- React/Next.js web application

**Blockchain Infrastructure:**
- Optimism Sepolia (testnet for EAS attestations)
- Ethereum Attestation Service (EAS) for data verification
- Gas sponsorship for seamless transactions

**Decentralized Storage:**
- Arweave (devnet) for permanent photo storage
- Irys for simplified Arweave uploads with sponsorship

**Backend Services:**
- Node.js server for thumbnail generation and metadata caching
- Database for indexing and search capabilities

### Data Flow Architecture

1. **User Onboarding**: Privy generates embedded wallet
2. **Content Capture**: User selects photo (any size)
3. **Preview Optimization**: App generates thumbnail for fast preview/interface display
4. **Metadata Extraction**: App extracts metadata from original photo (timestamp, GPS coordinates)
5. **User Review**: User confirms photo and metadata before submission
6. **Submission Processing**: App optimizes photo (min 512px, max 1920px) for upload
7. **Authorization Check**: Backend validates user eligibility and upload permissions
8. **Server-Side Signing**: Backend signs upload request using controlled private key
9. **Storage**: Irys uploads optimized photo to Arweave (sponsored via server signing)
10. **Thumbnail Storage**: Server stores thumbnail locally for fast access
11. **Attestation**: EAS creates on-chain record linking metadata to Arweave TX ID (gas sponsored)
12. **Verification**: Data becomes publicly verifiable and queryable

### Captured Data Schema

**EAS Attestation Fields:**
- `photoTakenDate`: ISO timestamp from EXIF data
- `coordinates`: GPS coordinates as array [latitude, longitude] (decimal degrees)
- `arweaveTxId`: Permanent storage reference for optimized photo (512px-1920px)
- `thumbnailHash`: Client-generated thumbnail identifier

---

## Development Phases

### Phase 1: Basic Server-Side Signing (EOA Wallet)
**Goal**: Establish core authorization and server-side signing infrastructure

**Scope:**
- Simple web interface for photo selection (any size)
- **Client-side thumbnail generation** for fast preview in interface
- **Client-side photo optimization** at submission time (min 512px, max 1920px)
- Server-side signing implementation for controlled uploads
- Basic user authorization (simple allowlist for testing)
- Direct Arweave upload using MetaMask wallet for initial validation
- Basic file validation and error handling

**Deliverables:**
- Upload interface with file selection and immediate thumbnail preview
- Photo optimization logic (min 512px, max 1920px) triggered at submission
- Thumbnail generation for interface preview
- Backend API routes for server-side signing (`/api/publicKey`, `/api/signData`)
- Simple user authorization system (allowlist-based for testing)
- Arweave integration using Irys toolkit with server-controlled private key
- Basic error handling and transaction confirmation

**Success Criteria:**
- Users can select photos of any size with fast preview
- Photos are optimized to 512px-1920px range only at submission time
- Thumbnails generated for fast interface display
- Backend successfully signs upload requests for approved users
- Optimized photos upload to Arweave devnet via server-side signing
- Unauthorized users are properly blocked from uploads
- Server maintains secure private key management

---

### Phase 2: Privy Integration & Auto-Approval
**Goal**: Replace EOA wallet requirement with seamless Privy onboarding and automatic approval

**Scope:**
- Integrate Privy SDK for wallet generation
- Implement automatic approval for all Privy-authenticated users
- Social login options (Google, Twitter, email)
- Embedded wallet management
- Automatic authorization upon successful Privy onboarding

**Deliverables:**
- Privy authentication flow
- Automatic approval system triggered by successful Privy onboarding
- User dashboard showing wallet status (always approved after onboarding)
- Gasless upload functionality via server signing
- Streamlined user flow with zero manual approval steps

**Success Criteria:**
- Users onboard without existing crypto wallets
- All Privy-authenticated users are automatically approved for uploads
- Upload transactions are fully sponsored for all users
- Smooth Web2-like user experience with no approval delays
- Zero manual intervention required

---

### Phase 3: Metadata Extraction & EAS Integration
**Goal**: Add comprehensive metadata capture and blockchain attestations

**Scope:**
- **Client-side EXIF data extraction** for timestamps and GPS coordinates from original photo
- EAS schema definition and deployment on Optimism Sepolia
- Automated attestation workflow
- **Server-side thumbnail storage** and serving
- Link Arweave uploads with EAS attestations

**Deliverables:**
- **Frontend metadata extraction** service using EXIF data from original photo
- EAS smart contract deployment and schema
- Automated attestation creation linking photo metadata to Arweave TX
- **Server endpoints for thumbnail storage and retrieval**
- Enhanced frontend processing pipeline: 
  - Select photo (any size) → generate thumbnail for preview → extract metadata → user review → optimize photo at submission (512px-1920px) → upload

**Success Criteria:**
- Automatic extraction of photo timestamp and GPS coordinates from original file
- Fast thumbnail preview for any size photo selection
- Photo optimization only occurs at submission time for better UX
- EAS attestations successfully created for each upload
- Metadata accurately captured and verifiable on-chain
- Thumbnails stored on server and served efficiently
- Complete data pipeline: photo selection → preview → metadata → submission optimization → Arweave → EAS

---

### Phase 4: Automatic Approval & Production Readiness
**Goal**: Streamline user experience with automatic approval and ensure system reliability

**Scope:**
- Implement automatic approval for all Privy-onboarded users
- Remove manual approval bottlenecks
- System optimization and reliability improvements
- Basic data storage and retrieval (no complex admin tools)

**Deliverables:**
- Automatic approval system for new Privy users
- Simplified user status management (approved by default)
- System performance optimizations
- Basic data persistence and simple retrieval
- Simple monitoring and health checks

**Success Criteria:**
- New users automatically approved upon Privy onboarding
- Zero manual intervention required for user approval
- End-to-end workflow: onboard → upload → attest works seamlessly
- System handles concurrent users reliably

---

## Technical Implementation Details

### Gas Sponsorship Strategy
- **Arweave Uploads**: Server-side signing pattern where backend maintains Irys-funded account and signs upload requests for authorized users
- **EAS Attestations**: Implement relayer service using account abstraction paymaster patterns
- **Budget Management**: Monitor and alert on sponsorship balance levels
- **Authorization Control**: Only approved users can trigger sponsored uploads

### Backend Services (Node.js)

**Core Functions:**
- User authorization and approval management
- **Server-side signing endpoints** (`/api/publicKey`, `/api/signData`, `/api/lazyFund`)
- **Thumbnail storage and serving** from client-generated thumbnails
- Data validation and sanitization
- EAS attestation formatting and submission
- Arweave TX monitoring and confirmation

**API Endpoints:**
```
GET  /api/publicKey       - Get server's public key for Irys signing
POST /api/signData        - Sign upload data (auto-approves Privy users)
POST /api/lazyFund        - Ensure sufficient Irys balance (optional)
POST /upload/prepare      - Validate submission data and metadata
POST /upload/submit       - Trigger Arweave upload with optimized photo and EAS attestation
POST /thumbnail/store     - Store client-generated thumbnail (for interface preview)
GET  /thumbnail/{id}      - Retrieve stored thumbnail
GET  /data/{txId}         - Retrieve specific submission details
GET  /health              - System health check
```

### Error Handling & Recovery
- Failed Arweave uploads: Retry mechanism with exponential backoff
- EAS attestation failures: Queue system for retry attempts
- Network issues: Graceful degradation with user feedback
- Invalid metadata: Clear validation messages and correction prompts

### Security Considerations
- Input validation for all uploaded files
- Rate limiting on API endpoints
- Metadata sanitization to prevent injection attacks
- Wallet security through Privy's battle-tested infrastructure
- **Server-side signing security**: Private key protection with secure storage (HSM/environment variables)
- **Authorization controls**: Multi-layered approval system to prevent unauthorized uploads
- **Audit logging**: Track all authorization requests and upload activities

---

## Success Metrics & Testing

**Phase 1 Metrics:**
- Successful server-side signing implementation > 99%
- User authorization system functionality > 95%
- File uploads to Arweave devnet success rate > 95%
- Private key security maintained (no breaches)

**Phase 2 Metrics:**
- User onboarding completion rate > 80%
- Privy authentication integration success > 98%
- Sponsored transaction success rate > 98% for approved users
- User retention after first upload > 60%

**Phase 3 Metrics:**
- Client-side metadata extraction accuracy > 95%
- Fast thumbnail generation for interface preview > 99%
- Photo optimization at submission time success rate > 99%
- EAS attestation verification rate 100%
- End-to-end workflow completion rate > 90%
- Thumbnail storage and retrieval success rate > 99%

**Phase 4 Metrics:**
- Automatic approval system reliability > 99%
- End-to-end user flow completion rate > 95%
- System uptime and reliability > 99%
- Zero manual approval interventions required

---

## Future Enhancements (Post-POC)

- **Incentive System**: Token rewards for quality data submissions
- **Data Quality Scoring**: Community validation and reputation systems
- **Advanced Analytics**: Spatial and temporal data analysis tools
- **Mobile Applications**: Native iOS/Android apps with enhanced camera integration
- **Mainnet Deployment**: Production launch on Ethereum mainnet and Arweave mainnet

---

## Resource Requirements

**Development Timeline**: 6-8 weeks total
- Phase 1: 1-2 weeks
- Phase 2: 2 weeks  
- Phase 3: 2-3 weeks
- Phase 4: 1-2 weeks

**Key Dependencies:**
- Privy SDK documentation and support
- Irys service reliability and devnet availability
- EAS schema deployment on Optimism Sepolia
- Arweave devnet stability

**Budget Considerations:**
- Arweave storage costs (sponsored uploads)
- Optimism Sepolia gas costs (sponsored attestations)
- Backend hosting and database costs
- Development and testing resources 