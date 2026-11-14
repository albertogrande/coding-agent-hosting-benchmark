import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const secret = () => process.env.TOKEN_SECRET || "dev-only-secret";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 32), Buffer.from(hash, "hex"));
}

export function issueToken(userId: string): string {
  const mac = crypto.createHmac("sha256", secret()).update(userId).digest("base64url");
  return `${userId}.${mac}`;
}

export function userIdFromToken(token: string): string | null {
  const i = token.lastIndexOf(".");
  if (i < 1) return null;
  const id = token.slice(0, i);
  return issueToken(id) === token ? id : null;
}

export type AuthedRequest = Request & { userId?: string };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.get("authorization") ?? "";
  const id = header.startsWith("Bearer ") ? userIdFromToken(header.slice(7)) : null;
  if (!id) { res.status(401).json({ error: "sign in first" }); return; }
  req.userId = id;
  next();
}
