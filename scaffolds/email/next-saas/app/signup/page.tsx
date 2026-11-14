import { signup } from "../actions";

const ERRORS: Record<string, string> = {
  invalid: "Enter a name, a valid address and a password of at least 8 characters.",
  taken: "An account with that address already exists.",
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <h1>Create your account</h1>
      {error && <p className="error">{ERRORS[error] ?? "Something went wrong."}</p>}
      <form action={signup}>
        <label>Name <input name="name" required /></label>
        <label>Email <input name="email" type="email" required /></label>
        <label>Password <input name="password" type="password" minLength={8} required /></label>
        <button type="submit">Sign up</button>
      </form>
    </>
  );
}
