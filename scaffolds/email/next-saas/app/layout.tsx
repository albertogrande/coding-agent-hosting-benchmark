import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = { title: "Team Tasks", description: "A small task tracker for teams" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/">Team Tasks</Link>
          <nav>
            <Link href="/tasks">Tasks</Link>
            <Link href="/billing">Billing</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
