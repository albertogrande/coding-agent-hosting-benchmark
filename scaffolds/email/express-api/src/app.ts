import express from "express";
import { Store } from "./store.js";
import { hashPassword, issueToken, requireAuth, verifyPassword, type AuthedRequest } from "./auth.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function createApp(store = new Store()) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => { res.json({ ok: true }); });

  app.post("/signup", async (req, res) => {
    const { email, name, password } = req.body ?? {};
    if (typeof email !== "string" || !email.includes("@") || typeof name !== "string" || !name || typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "email, name and a password of 8+ characters are required" });
      return;
    }
    if (await store.userByEmail(email)) { res.status(409).json({ error: "that address already has an account" }); return; }
    const user = await store.addUser(email, name, hashPassword(password));
    res.status(201).json({ id: user.id, token: issueToken(user.id) });
  });

  app.post("/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    const user = typeof email === "string" ? await store.userByEmail(email) : undefined;
    if (!user || typeof password !== "string" || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "address and password do not match" });
      return;
    }
    res.json({ token: issueToken(user.id) });
  });

  app.get("/me", requireAuth, async (req: AuthedRequest, res) => {
    const user = await store.user(req.userId!);
    if (!user) { res.status(404).end(); return; }
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  app.get("/tasks", requireAuth, async (req: AuthedRequest, res) => {
    res.json(await store.tasks(req.userId!));
  });

  app.post("/tasks", requireAuth, async (req: AuthedRequest, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    res.status(201).json(await store.addTask(req.userId!, title));
  });

  app.post("/tasks/:id/done", requireAuth, async (req: AuthedRequest, res) => {
    const task = await store.task(String(req.params.id));
    if (!task || task.ownerId !== req.userId) { res.status(404).end(); return; }
    res.json(await store.completeTask(task.id));
  });

  app.get("/tasks/:id/comments", requireAuth, async (req: AuthedRequest, res) => {
    res.json(await store.comments(String(req.params.id)));
  });

  app.post("/tasks/:id/comments", requireAuth, async (req: AuthedRequest, res) => {
    const task = await store.task(String(req.params.id));
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!task) { res.status(404).end(); return; }
    if (!body) { res.status(400).json({ error: "body is required" }); return; }
    res.status(201).json(await store.addComment(task.id, req.userId!, body));
  });

  app.get("/activity", requireAuth, async (req: AuthedRequest, res) => {
    const since = Date.now() - WEEK_MS;
    const recent = (iso: string | null) => !!iso && Date.parse(iso) >= since;
    const tasks = await store.tasks(req.userId!);
    const comments = await store.commentsBy(req.userId!);
    res.json({
      created: tasks.filter((t) => recent(t.createdAt)).length,
      completed: tasks.filter((t) => recent(t.doneAt)).length,
      comments: comments.filter((c) => recent(c.createdAt)).length,
    });
  });

  return app;
}
