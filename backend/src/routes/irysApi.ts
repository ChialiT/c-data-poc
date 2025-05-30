import express, { Request, Response, NextFunction } from 'express';
import { isAddress } from 'viem';
import {
  checkExistingApproval,
  storeUserApproval,
  isDelegationExpired,
  UserApprovalRecord, // Import UserApprovalRecord if needed for casting, though storeUserApproval returns it
} from '../lib/db'; // Adjust path if needed
import {
  createIrysDelegation,
} from '../services/irysService'; // Adjust path if needed

const router = express.Router();

/**
 * POST /api/irys/auto-approve
 * Endpoint to handle automatic Irys delegation for a user.
 */
router.post('/auto-approve', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { 
        userAddress, 
        socialProvider, 
        userId: privyUserId, // Renaming for clarity to match DB field
        email: privyUserEmail // Renaming for clarity
    } = req.body;

    // 1. Validate input
    if (!userAddress || !isAddress(userAddress)) {
      res.status(400).json({
        success: false,
        approved: false,
        error: 'Invalid user address',
        message: 'Auto-approval failed: User address is missing or invalid.',
      });
      return; // Ensure we exit after sending response
    }

    // 2. Check if already approved and not expired
    const existingApproval = await checkExistingApproval(userAddress);
    if (existingApproval && !isDelegationExpired(existingApproval)) {
      console.log(`User ${userAddress} already has an active delegation: ${existingApproval.delegationId}`);
      res.status(200).json({
        success: true,
        approved: true,
        delegationId: existingApproval.delegationId,
        expiresAt: existingApproval.expiresAt,
        message: 'User already approved and delegation is active.',
      });
      return; // Ensure we exit
    }

    // 3. Create Irys delegation
    console.log(`No active delegation found for ${userAddress}. Creating new Irys delegation...`);
    const delegationResult = await createIrysDelegation(userAddress, socialProvider);
    console.log(`Delegation created for ${userAddress}:`, delegationResult);

    // 4. Store approval in database
    await storeUserApproval({
      userAddress,
      privyUserId, 
      privyUserEmail,
      privySocialProvider: socialProvider, // Corrected field name
      delegationId: delegationResult.delegationId,
      expiresAt: delegationResult.expiresAt,
    });
    console.log(`Approval stored in DB for ${userAddress}`);

    // 5. Return success response
    res.status(200).json({
      success: true,
      approved: true,
      delegationId: delegationResult.delegationId,
      expiresAt: delegationResult.expiresAt,
      message: 'User auto-approved successfully for Irys uploads.',
    });
    return; // Ensure we exit

  } catch (error: any) {
    console.error('[API /auto-approve] Error:', error.message, error.stack);
    // Log more details if available, e.g., error.cause
    if (error.cause) {
      console.error('[API /auto-approve] Caused by:', error.cause);
    }
    // Check if response has already been sent, though return statements should prevent this
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        approved: false,
        error: error.message || 'An unexpected error occurred during auto-approval.',
        message: 'Auto-approval process failed.',
      });
    }
    // Optionally, if you have a global error handler, pass it via next(error)
    // For now, just ensuring response is sent.
  }
});

export default router; 