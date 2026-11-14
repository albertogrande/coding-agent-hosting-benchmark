import { login } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      {error && <p className="error">That address and password do not match.</p>}
      <form action={login}>
        <label>Email <input name="email" type="email" required /></label>
        <label>Password <input name="password" type="password" required /></label>
        <button type="submit">Sign in</button>
      </form>
    </>
  );
}
