import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { findTask, findUser, listComments } from "@/lib/db";
import { addComment } from "../../actions";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const task = await findTask(id);
  if (!task) notFound();
  const comments = await listComments(task.id);
  const authors = new Map(await Promise.all(comments.map(async (c) => [c.authorId, (await findUser(c.authorId))?.name ?? "someone"] as const)));
  return (
    <>
      <h1 className={task.done ? "done" : undefined}>{task.title}</h1>
      <h2>Comments</h2>
      <ul>
        {comments.map((c) => (
          <li key={c.id}><strong>{authors.get(c.authorId)}</strong>: {c.body}</li>
        ))}
      </ul>
      <form action={addComment}>
        <input type="hidden" name="taskId" value={task.id} />
        <textarea name="body" rows={3} required />
        <button type="submit">Comment</button>
      </form>
    </>
  );
}
