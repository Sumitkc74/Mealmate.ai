import { User } from '../models/User';
import { MealPlan } from '../models/MealPlan';
import { GroceryList } from '../models/GroceryList';
import { Recipe, COMMUNITY_OWNER_ID } from '../models/Recipe';
import { DeletionRequest } from '../models/DeletionRequest';
import { logger } from '../config/logger';

/**
 * The database cleanup shared by the in-app delete (DELETE /api/auth/me)
 * and the scheduled sweep for locked-out deletion requests. Factoring it
 * out keeps the two paths from drifting apart: whatever one deletes, the
 * other deletes too.
 *
 * Recipes follow the stored choice: delete them, or keep them in the shared
 * library reassigned to the community owner so the library does not lose
 * recipes when someone leaves.
 */
export async function deleteUserAccount(
  userId: string,
  deleteRecipes: boolean
): Promise<void> {
  await Promise.all([
    MealPlan.deleteMany({ user: userId }),
    GroceryList.deleteMany({ user: userId }),
    deleteRecipes
      ? Recipe.deleteMany({ createdBy: userId })
      : Recipe.updateMany(
          { createdBy: userId },
          { $set: { createdBy: COMMUNITY_OWNER_ID } }
        ),
    User.findByIdAndDelete(userId),
  ]);
}

/** Live statuses for a deletion request (anything not yet terminal). */
const LIVE_STATUSES = ['pending-confirmation', 'pending-approval', 'scheduled'] as const;

/**
 * A sign-in cancels any live deletion request for that user: the user is
 * back, so the scheduled deletion (and any unconfirmed or unapproved
 * request) is moot. The in-app Privacy page is the way to delete instead.
 */
export async function cancelPendingDeletionsForUser(userId: string): Promise<void> {
  await DeletionRequest.updateMany(
    { user: userId, status: { $in: LIVE_STATUSES } },
    { $set: { status: 'cancelled' } }
  );
}

/**
 * Delete every account whose scheduled deletion date has passed. Called by
 * the server's 10-minute interval (see server.ts). A request whose user is
 * already gone (e.g. deleted via the Privacy page) is just marked
 * completed. One bad request never blocks the rest.
 */
export async function processPendingDeletions(): Promise<{
  checked: number;
  deleted: number;
}> {
  const due = await DeletionRequest.find({
    status: 'scheduled',
    deleteAt: { $lte: new Date() },
  });
  let deleted = 0;
  for (const request of due) {
    try {
      const user = await User.findById(request.user);
      if (user) {
        await deleteUserAccount(String(user._id), request.deleteRecipes);
      }
      request.status = 'completed';
      await request.save();
      deleted += 1;
    } catch (err) {
      logger.error(
        { err, requestId: String(request._id) },
        'Scheduled account deletion failed'
      );
    }
  }
  return { checked: due.length, deleted };
}
