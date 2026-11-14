import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type User = { id: string; email: string; name: string; passwordHash: string; createdAt: string };
export type Task = { id: string; ownerId: string; title: string; done: boolean; createdAt: string; doneAt: string | null };
export type Comment = { id: string; taskId: string; authorId: string; body: string; createdAt: string };
type Data = { users: User[]; tasks: Task[]; comments: Comment[] };

const empty = (): Data => ({ users: [], tasks: [], comments: [] });

export class Store {
  constructor(private file: string = path.join(process.cwd(), "data", "db.json")) {}

  private async read(): Promise<Data> {
    try {
      return { ...empty(), ...JSON.parse(await fs.readFile(this.file, "utf8")) };
    } catch {
      return empty();
    }
  }

  private async write(d: Data): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(d, null, 2));
  }

  async userByEmail(email: string) {
    return (await this.read()).users.find((u) => u.email === email.toLowerCase());
  }

  async user(id: string) {
    return (await this.read()).users.find((u) => u.id === id);
  }

  async users() {
    return (await this.read()).users;
  }

  async addUser(email: string, name: string, passwordHash: string): Promise<User> {
    const d = await this.read();
    const u: User = { id: crypto.randomUUID(), email: email.toLowerCase(), name, passwordHash, createdAt: new Date().toISOString() };
    d.users.push(u);
    await this.write(d);
    return u;
  }

  async tasks(ownerId: string) {
    return (await this.read()).tasks.filter((t) => t.ownerId === ownerId);
  }

  async task(id: string) {
    return (await this.read()).tasks.find((t) => t.id === id);
  }

  async addTask(ownerId: string, title: string): Promise<Task> {
    const d = await this.read();
    const t: Task = { id: crypto.randomUUID(), ownerId, title, done: false, createdAt: new Date().toISOString(), doneAt: null };
    d.tasks.push(t);
    await this.write(d);
    return t;
  }

  async completeTask(id: string): Promise<Task | undefined> {
    const d = await this.read();
    const t = d.tasks.find((x) => x.id === id);
    if (t && !t.done) { t.done = true; t.doneAt = new Date().toISOString(); await this.write(d); }
    return t;
  }

  async comments(taskId: string) {
    return (await this.read()).comments.filter((c) => c.taskId === taskId);
  }

  async commentsBy(authorId: string) {
    return (await this.read()).comments.filter((c) => c.authorId === authorId);
  }

  async addComment(taskId: string, authorId: string, body: string): Promise<Comment> {
    const d = await this.read();
    const c: Comment = { id: crypto.randomUUID(), taskId, authorId, body, createdAt: new Date().toISOString() };
    d.comments.push(c);
    await this.write(d);
    return c;
  }
}
