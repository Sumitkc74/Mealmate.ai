import mongoose, { Schema, Model, HydratedDocument, Types } from 'mongoose';

/**
 * A deletion request from a user who cannot sign in (the in-app Privacy
 * delete needs a session, so locked-out users use this flow instead).
 *
 * Two paths, one record:
 * - Email-access path: the app emails a confirmation link to the registered
 *   address; clicking it moves the request to `scheduled`.
 * - Lost-email path: the request goes to the owner's inbox with the
 *   account's real details; the owner's Approve click moves it to
 *   `scheduled`.
 *
 * Once `scheduled`, `deleteAt` is set (approval/confirmation + 30 days) and
 * a server sweep deletes the account. Signing in at any point while a
 * request is live cancels it — the in-app Privacy page is the way to
 * delete instead.
 */
export type DeletionRequestStatus =
  | 'pending-confirmation'
  | 'pending-approval'
  | 'scheduled'
  | 'cancelled'
  | 'completed';

export interface IDeletionRequest {
  /** The account to delete. */
  user: Types.ObjectId;
  /** Where to reach the requester (may differ from the registered email). */
  contactEmail: string;
  /** Display name the requester typed in (compared against the real one). */
  claimedName: string;
  /** A recipe the requester says they created (optional, for the review). */
  claimedRecipe?: string;
  /** Recipe choice, same semantics as DELETE /api/auth/me. */
  deleteRecipes: boolean;
  status: DeletionRequestStatus;
  /** SHA-256 hash of the confirmation token (never the raw token). */
  confirmTokenHash?: string;
  /** Expiry of the confirmation token. */
  confirmTokenExpires?: Date;
  /** SHA-256 hash of the owner's approval token (never the raw token). */
  approveTokenHash?: string;
  /** Expiry of the approval token. */
  approveTokenExpires?: Date;
  /** When the account is deleted (set when the request is scheduled). */
  deleteAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type DeletionRequestDocument = HydratedDocument<IDeletionRequest>;
export type DeletionRequestModel = Model<IDeletionRequest>;

const DeletionRequestSchema = new Schema<IDeletionRequest, DeletionRequestModel>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    contactEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    claimedName: { type: String, required: true, trim: true, maxlength: 80 },
    claimedRecipe: { type: String, trim: true, maxlength: 120 },
    deleteRecipes: { type: Boolean, default: false },
    status: {
      type: String,
      enum: [
        'pending-confirmation',
        'pending-approval',
        'scheduled',
        'cancelled',
        'completed',
      ],
      default: 'pending-confirmation',
    },
    // Token hashes + expiries. select:false so they are never returned by
    // default; the confirm/approve handlers select them explicitly.
    confirmTokenHash: { type: String, select: false },
    confirmTokenExpires: { type: Date, select: false },
    approveTokenHash: { type: String, select: false },
    approveTokenExpires: { type: Date, select: false },
    deleteAt: { type: Date },
  },
  { timestamps: true }
);

// The sweep finds scheduled requests whose deleteAt has passed; sign-in
// cancellation finds a user's live requests.
DeletionRequestSchema.index({ status: 1, deleteAt: 1 });
DeletionRequestSchema.index({ user: 1, status: 1 });

export const DeletionRequest =
  (mongoose.models.DeletionRequest as DeletionRequestModel) ||
  mongoose.model<IDeletionRequest, DeletionRequestModel>(
    'DeletionRequest',
    DeletionRequestSchema
  );

export default DeletionRequest;
