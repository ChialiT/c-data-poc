import path from 'path';
// Use require for older CommonJS modules like lowdb v1.0.0 to help with type resolution
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// Define the structure of your data
export interface UserApprovalRecord {
  userAddress: string;
  privyUserId?: string; // Privy User ID from user.id
  privyUserEmail?: string; // from user.email.address
  privySocialProvider?: string; // from user.linkedAccounts[0]?.type or walletClientType
  delegationId: string;
  expiresAt: number; // Store as Unix timestamp (milliseconds)
  createdAt: number; // Store as Unix timestamp (milliseconds)
  lastUpdatedAt: number; // Store as Unix timestamp (milliseconds)
  status: 'active' | 'expired' | 'revoked';
}

interface DBSchema {
  userApprovals: UserApprovalRecord[];
}

// __dirname is a global variable in CommonJS, it gives the directory of the current module.
const dbFilePath = process.env.NODE_ENV === 'test' 
  ? path.join(__dirname, '../../db.test.json') // Separate DB for tests
  : path.join(__dirname, '../../db.json'); // Main DB file at backend/db.json

// Configure lowdb v1.0.0
const adapter = new FileSync(dbFilePath);
const db = low(adapter);

// Set some defaults (if the file doesn't exist, it will be created)
// For lowdb v1.0.0, this also effectively loads the db or creates it.
db.defaults({ userApprovals: [] } as DBSchema)
  .write();

console.log('Database initialized/loaded from:', dbFilePath);
if (db.get('userApprovals').value().length === 0) {
  console.log('User approvals collection is empty.');
}

// --- Database Helper Functions (adapted for lowdb v1.0.0) ---

export const checkExistingApproval = async (userAddress: string): Promise<UserApprovalRecord | null> => {
  // For FileSync, operations are synchronous, but we keep async for API consistency
  const approval = db.get('userApprovals')
    .find( // Add explicit type for record
    (record: UserApprovalRecord) =>
      record.userAddress.toLowerCase() === userAddress.toLowerCase() &&
      record.status === 'active' &&
      record.expiresAt > Date.now()
    )
    .value();
  return approval || null;
};

export const storeUserApproval = async (approvalData: {
  userAddress: string;
  privyUserId?: string;
  privyUserEmail?: string;
  privySocialProvider?: string;
  delegationId: string;
  expiresAt: number; // Expecting Unix timestamp (ms)
}): Promise<UserApprovalRecord> => {
  const now = Date.now();
  const userApprovals = db.get('userApprovals');

  const existingRecord = userApprovals
    .find({ userAddress: approvalData.userAddress } as Partial<UserApprovalRecord>) // Find by userAddress
    .value();

  let newRecordData: UserApprovalRecord;

  if (existingRecord) {
    // Update existing record
    newRecordData = {
      ...existingRecord,
      ...approvalData, // Overwrite with new data
      lastUpdatedAt: now,
      status: 'active',
    } as UserApprovalRecord; // Cast to ensure type conformity
    userApprovals
      .find({ userAddress: approvalData.userAddress } as Partial<UserApprovalRecord>)
      .assign(newRecordData)
      .write(); // Persist changes
  } else {
    // Create new record
    newRecordData = {
      ...approvalData,
      createdAt: now,
      lastUpdatedAt: now,
      status: 'active',
    } as UserApprovalRecord; // Cast to ensure type conformity
    userApprovals.push(newRecordData as UserApprovalRecord).write(); // Persist changes
  }
  // Return the complete record as it is in the DB (or would be)
  // For simplicity, we're returning the merged/created data. A fresh read could also be done.
  return newRecordData; 
};

export const isDelegationExpired = (approvalRecord: UserApprovalRecord): boolean => {
  return approvalRecord.expiresAt <= Date.now();
};

// No need for the self-invoking async IIFE for initialization with FileSync,
// as db.defaults().write() handles it synchronously at the start.

// Export db instance if direct access is needed elsewhere (use with caution for v1 API)
// export { db }; 