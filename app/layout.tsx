// app/layout.tsx
import "./globals.css";
import "./fetch-json-global";
import ThemeProvider from "@/components/theme-provider";

export const metadata = {
  title: "Louis.Ai",
  description: "Docs-only agency knowledge assistant",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased font-sans">
        {/* subtle global lighting */}
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(120,120,255,0.12),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(120,255,200,0.10),transparent_60%)]" />
        </div>

        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="page-bg min-h-dvh">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}