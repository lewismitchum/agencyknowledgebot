// app/join/page.tsx
import JoinClient from "./JoinClient";

type JoinPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(searchParams: JoinPageProps["searchParams"], key: string): string | null {
  const v = searchParams?.[key];
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export default function JoinPage({ searchParams }: JoinPageProps) {
  const token =
    getParam(searchParams, "token") ||
    getParam(searchParams, "invite") ||
    getParam(searchParams, "t") ||
    getParam(searchParams, "code");

  return <JoinClient token={token ? String(token).trim() : null} />;
}