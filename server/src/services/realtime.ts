/**
 * Socket.IO realtime hub for collaborative meal-plan and grocery editing.
 *
 * Clients connect with a JWT and join a room keyed by the meal-plan or grocery list id
 * they want to follow. The controllers emit events whenever data changes;
 * every other client viewing the same plan/list receives the payload and updates state.
 *
 * Module is intentionally light on hard dependencies — `socket.io` and
 * `jsonwebtoken` are imported lazily so tests still pass without realtime.
 */
import type { Server as HttpServer } from 'node:http';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { MealPlan } from '../models/MealPlan';
import { GroceryList } from '../models/GroceryList';

type SocketIO = typeof import('socket.io');
type JWT = typeof import('jsonwebtoken');

interface RoomEvent {
  type: 'mealplan:updated' | 'mealplan:deleted';
  mealPlanId: string;
  payload?: unknown;
  actorId?: string;
}

export interface GroceryRoomEvent {
  type: 'grocery:updated' | 'grocery:deleted';
  listId: string;
  payload?: unknown;
  actorId?: string;
}

let io: import('socket.io').Server | null = null;

function tryLoad<T>(name: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name) as T;
  } catch {
    return null;
  }
}

interface AuthedSocketData {
  userId: string;
}

export function initRealtime(httpServer: HttpServer): import('socket.io').Server | null {
  const sio = tryLoad<SocketIO>('socket.io');
  const jwt = tryLoad<JWT>('jsonwebtoken');
  if (!sio || !jwt) {
    logger.info('realtime disabled — socket.io / jsonwebtoken not installed');
    return null;
  }

  io = new sio.Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    },
    // Keep the path under the same /api prefix the rest of the API uses so
    // a reverse proxy only needs one mapping rule.
    path: '/api/realtime',
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
    if (!token) return next(new Error('unauthorized'));
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { sub?: string; id?: string };
      const userId = decoded.sub ?? decoded.id;
      if (!userId) return next(new Error('unauthorized'));
      (socket.data as AuthedSocketData).userId = userId;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('mealplan:join', async (mealPlanId: string) => {
      if (typeof mealPlanId !== 'string' || !mealPlanId.trim()) return;
      const cleanId = mealPlanId.trim();
      const authedUserId = (socket.data as AuthedSocketData)?.userId;
      if (!authedUserId || !Types.ObjectId.isValid(cleanId)) return;

      try {
        // Enforce Object-Level Authorization (BOLA mitigation):
        // Only allow clients to subscribe to updates for meal plans they own
        const hasAccess = await MealPlan.exists({ _id: cleanId, user: authedUserId });
        if (!hasAccess) {
          logger.warn({ mealPlanId: cleanId, authedUserId }, 'Unauthorized attempt to subscribe to mealplan room');
          socket.emit('mealplan:error', { message: 'Unauthorized meal plan access' });
          return;
        }
        socket.join(`mealplan:${cleanId}`);
      } catch (err) {
        logger.error({ err, mealPlanId: cleanId }, 'Error verifying mealplan authorization');
      }
    });

    socket.on('mealplan:leave', (mealPlanId: string) => {
      if (typeof mealPlanId !== 'string' || !mealPlanId.trim()) return;
      socket.leave(`mealplan:${mealPlanId.trim()}`);
    });

    socket.on('grocery:join', async (listId: string) => {
      if (typeof listId !== 'string' || !listId.trim()) return;
      const cleanId = listId.trim();
      const authedUserId = (socket.data as AuthedSocketData)?.userId;
      if (!authedUserId || !Types.ObjectId.isValid(cleanId)) return;

      try {
        const hasAccess = await GroceryList.exists({ _id: cleanId, user: authedUserId });
        if (!hasAccess) {
          logger.warn({ listId: cleanId, authedUserId }, 'Unauthorized attempt to subscribe to grocery room');
          socket.emit('grocery:error', { message: 'Unauthorized grocery list access' });
          return;
        }
        socket.join(`grocery:${cleanId}`);
      } catch (err) {
        logger.error({ err, listId: cleanId }, 'Error verifying grocery authorization');
      }
    });

    socket.on('grocery:leave', (listId: string) => {
      if (typeof listId !== 'string' || !listId.trim()) return;
      socket.leave(`grocery:${listId.trim()}`);
    });
  });

  logger.info('realtime gateway listening at /api/realtime');
  return io;
}

/** Broadcast an event to every client subscribed to a meal plan room. */
export function broadcastMealPlan(event: RoomEvent): void {
  if (!io) return;
  io.to(`mealplan:${event.mealPlanId}`).emit(event.type, event);
}

/** Broadcast an event to every client subscribed to a grocery list room. */
export function broadcastGrocery(event: GroceryRoomEvent): void {
  if (!io) return;
  io.to(`grocery:${event.listId}`).emit(event.type, event);
}

export function getIO(): import('socket.io').Server | null {
  return io;
}
