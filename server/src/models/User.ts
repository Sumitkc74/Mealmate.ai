import mongoose, { Schema, Model, HydratedDocument } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IPantryItem {
  ingredient: string;
  quantity?: string;
  unit?: string;
  addedAt: Date;
  expiresAt?: Date;
  category?: string;
}

export interface ICookingHistoryEntry {
  recipeId: string;
  recipeTitle: string;
  cookedAt: Date;
  servingsCooked?: number;
  rating?: number;
  notes?: string;
}

export interface IUser {
  name: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
  pantry: IPantryItem[];
  cookingHistory: ICookingHistoryEntry[];
  dietaryPreferences: string[];
  allergies: string[];
  termsAcceptedAt?: Date;
  dietaryConsentAt?: Date;
  marketingOptIn?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  comparePassword(candidate: string): Promise<boolean>;
  toSafeJSON(): Omit<IUser, 'password'> & { id: string };
}

export type UserDocument = HydratedDocument<IUser, IUserMethods>;
export type UserModel = Model<IUser, Record<string, never>, IUserMethods>;

const PantryItemSchema = new Schema<IPantryItem>(
  {
    ingredient: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    quantity: { type: String, trim: true, maxlength: 20 },
    unit: { type: String, trim: true, lowercase: true, maxlength: 20 },
    addedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    category: { type: String, trim: true },
  },
  { _id: false }
);

const CookingHistorySchema = new Schema<ICookingHistoryEntry>(
  {
    recipeId: { type: String, required: true, trim: true },
    recipeTitle: { type: String, required: true, trim: true },
    cookedAt: { type: Date, default: Date.now },
    servingsCooked: { type: Number, min: 1 },
    rating: { type: Number, min: 1, max: 5 },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UserSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [EMAIL_REGEX, 'Invalid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // never return by default
    },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    pantry: { type: [PantryItemSchema], default: [] },
    cookingHistory: { type: [CookingHistorySchema], default: [] },
    dietaryPreferences: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.every((s) => s.length <= 40),
        message: 'Each dietary preference must be <= 40 chars',
      },
    },
    allergies: { type: [String], default: [] },
    termsAcceptedAt: { type: Date, default: Date.now },
    dietaryConsentAt: { type: Date },
    marketingOptIn: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.password;
        return ret;
      },
    },
  }
);

// Indexes (email uniqueness already declared via `unique: true` above)

// Hash password before save (only when modified)
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

UserSchema.methods.toSafeJSON = function () {
  const obj = this.toJSON();
  return obj as unknown as ReturnType<IUserMethods['toSafeJSON']>;
};

export const User =
  (mongoose.models.User as UserModel) ||
  mongoose.model<IUser, UserModel>('User', UserSchema);

export default User;
