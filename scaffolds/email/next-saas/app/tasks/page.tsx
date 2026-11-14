import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listTasks } from "@/lib/db";
import { createTask, logout, toggleTask } from "../actions";

export default async function TasksPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const tasks = await listTasks(user.id);
  return (
    <>
      <h1>{user.name}&apos;s tasks</h1>
      <form action={createTask} className="inline">
        <input name="title" placeholder="What needs doing?" required />
        <button type="submit">Add</button>
      </form>
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            <form action={toggleTask} className="inline">
              <input type="hidden" name="id" value={t.id} />
              <button type="submit">{t.done ? "Undo" : "Done"}</button>
              <Link href={`/tasks/${t.id}`} className={t.done ? "done" : undefined}>{t.title}</Link>
            </form>
          </li>
        ))}
      </ul>
      <form action={logout}><button type="submit">Sign out</button></form>
    </>
  );
}
