"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as db from "@/lib/db";
import { currentUser, endSession, hashPassword, startSession, verifyPassword } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

const PRO_PRICE_CENTS = 1200;

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export async function signup(form: FormData): Promise<void> {
  const email = field(form, "email");
  const name = field(form, "name");
  const password = field(form, "password");
  if (!email.includes("@") || !name || password.length < 8) redirect("/signup?error=invalid");
  if (await db.findUserByEmail(email)) redirect("/signup?error=taken");
  const user = await db.createUser({ email, name, passwordHash: hashPassword(password) });
  await sendEmail({
    to: user.email,
    subject: "Welcome to Team Tasks",
    text: `Hi ${user.name},\n\nYour account is ready. Add your first task at /tasks.\n\nThe Team Tasks team`,
  }).catch((err) => console.error("welcome email failed", err));
  await startSession(user.id);
  redirect("/tasks");
}

export async function login(form: FormData): Promise<void> {
  const user = await db.findUserByEmail(field(form, "email"));
  if (!user || !verifyPassword(field(form, "password"), user.passwordHash)) redirect("/login?error=1");
  await startSession(user.id);
  redirect("/tasks");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/");
}

async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function createTask(form: FormData): Promise<void> {
  const user = await requireUser();
  const title = field(form, "title");
  if (title) await db.createTask(user.id, title);
  revalidatePath("/tasks");
}

export async function toggleTask(form: FormData): Promise<void> {
  await requireUser();
  await db.toggleTask(field(form, "id"));
  revalidatePath("/tasks");
}

export async function addComment(form: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = field(form, "taskId");
  const body = field(form, "body");
  if (body) await db.addComment(taskId, user.id, body);
  revalidatePath(`/tasks/${taskId}`);
}

export async function checkout(): Promise<void> {
  const user = await requireUser();
  const order = await db.createOrder(user.id, PRO_PRICE_CENTS);
  redirect(`/billing?order=${order.id}`);
}
