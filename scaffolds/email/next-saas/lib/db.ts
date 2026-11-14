import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type User = { id: string; email: string; name: string; passwordHash: string; plan: "free" | "pro"; createdAt: string };
export type Task = { id: string; ownerId: string; title: string; done: boolean; createdAt: string; doneAt: string | null };
export type Comment = { id: string; taskId: string; authorId: string; body: string; createdAt: string };
export type Order = { id: string; userId: string; plan: "pro"; amountCents: number; currency: "usd"; createdAt: string };

type Data = { users: User[]; tasks: Task[]; comments: Comment[]; orders: Order[] };

const FILE = path.join(process.cwd(), "data", "db.json");
const empty = (): Data => ({ users: [], tasks: [], comments: [], orders: [] });

async function read(): Promise<Data> {
  try {
    return { ...empty(), ...JSON.parse(await fs.readFile(FILE, "utf8")) };
  } catch {
    return empty();
  }
}

async function write(data: Data): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, FILE);
}

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const d = await read();
  return d.users.find((u) => u.email === email.toLowerCase());
}

export async function findUser(id: string): Promise<User | undefined> {
  return (await read()).users.find((u) => u.id === id);
}

export async function listUsers(): Promise<User[]> {
  return (await read()).users;
}

export async function createUser(input: { email: string; name: string; passwordHash: string }): Promise<User> {
  const d = await read();
  const user: User = { id: newId(), email: input.email.toLowerCase(), name: input.name, passwordHash: input.passwordHash, plan: "free", createdAt: now() };
  d.users.push(user);
  await write(d);
  return user;
}

export async function updateUser(id: string, patch: Partial<Omit<User, "id">>): Promise<void> {
  const d = await read();
  d.users = d.users.map((u) => (u.id === id ? { ...u, ...patch } : u));
  await write(d);
}

export async function listTasks(ownerId?: string): Promise<Task[]> {
  const tasks = (await read()).tasks;
  return ownerId ? tasks.filter((t) => t.ownerId === ownerId) : tasks;
}

export async function findTask(id: string): Promise<Task | undefined> {
  return (await read()).tasks.find((t) => t.id === id);
}

export async function createTask(ownerId: string, title: string): Promise<Task> {
  const d = await read();
  const task: Task = { id: newId(), ownerId, title, done: false, createdAt: now(), doneAt: null };
  d.tasks.push(task);
  await write(d);
  return task;
}

export async function toggleTask(id: string): Promise<void> {
  const d = await read();
  d.tasks = d.tasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? null : now() } : t));
  await write(d);
}

export async function listComments(taskId: string): Promise<Comment[]> {
  return (await read()).comments.filter((c) => c.taskId === taskId);
}

export async function addComment(taskId: string, authorId: string, body: string): Promise<Comment> {
  const d = await read();
  const comment: Comment = { id: newId(), taskId, authorId, body, createdAt: now() };
  d.comments.push(comment);
  await write(d);
  return comment;
}

export async function createOrder(userId: string, amountCents: number): Promise<Order> {
  const d = await read();
  const order: Order = { id: newId(), userId, plan: "pro", amountCents, currency: "usd", createdAt: now() };
  d.orders.push(order);
  d.users = d.users.map((u) => (u.id === userId ? { ...u, plan: "pro" } : u));
  await write(d);
  return order;
}

export async function findOrder(id: string): Promise<Order | undefined> {
  return (await read()).orders.find((o) => o.id === id);
}
