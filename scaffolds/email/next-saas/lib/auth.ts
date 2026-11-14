import crypto from "node:crypto";
import { cookies } from "next/headers";
import { findUser, type User } from "./db";

const COOKIE = "session";
const secret = () => process.env.SESSION_SECRET || "dev-only-secret";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

function sign(value: string): string {
  const mac = crypto.createHmac("sha256", secret()).update(value).digest("base64url");
  return `${value}.${mac}`;
}

function unsign(signed: string): string | null {
  const i = signed.lastIndexOf(".");
  if (i < 1) return null;
  const value = signed.slice(0, i);
  return sign(value) === signed ? value : null;
}

export async function startSession(userId: string): Promise<void> {
  (await cookies()).set(COOKIE, sign(userId), { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  const id = raw ? unsign(raw) : null;
  return id ? (await findUser(id)) ?? null : null;
}
