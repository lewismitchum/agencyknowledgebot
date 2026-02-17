import "./globals.css";
import ThemeProvider from "@/components/theme-provider";

export const metadata = {
  title: "Louis.Ai",
  description: "Docs-only agency knowledge assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="page-bg min-h-dvh">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
