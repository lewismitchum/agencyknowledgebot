import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          
          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Louis.Ai — All rights reserved
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>

            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>

            <Link href="/acceptable-use" className="hover:text-foreground">
              Acceptable Use
            </Link>

            <Link href="/billing-policy" className="hover:text-foreground">
              Billing Policy
            </Link>

            <Link href="/support" className="hover:text-foreground">
              Support
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}