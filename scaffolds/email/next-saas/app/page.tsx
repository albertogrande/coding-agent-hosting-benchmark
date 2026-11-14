import Link from "next/link";
import { currentUser } from "@/lib/auth";

export default async function Home() {
  const user = await currentUser();
  return (
    <>
      <h1>Keep your team&apos;s work in one list</h1>
      <p>Create tasks, mark them done, and talk about them in comments.</p>
      {user ? (
        <p>Signed in as {user.name}. <Link href="/tasks">Open your tasks</Link></p>
      ) : (
        <p><Link href="/signup">Create an account</Link> or <Link href="/login">sign in</Link>.</p>
      )}
    </>
  );
}
