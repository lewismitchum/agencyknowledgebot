import "@/app/globals.css";
import Link from "next/link";
import PublicHeader from "./public-header";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl border bg-card" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">Louis.Ai</div>
              <div className="text-xs text-muted-foreground">Let’s Alter Minds</div>
            </div>
          </Link>

          <nav className="flex items-center gap-2">
            <Link
              href="/pricing"
              className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Login
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Louis.Ai • Let’s Alter Minds
          </div>
          <div className="flex gap-3 text-sm">
            <Link className="text-muted-foreground hover:text-foreground" href="/pricing">
              Pricing
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/signup">
              Start
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
