// app/join/[...token]/page.tsx
import { Suspense } from "react";
import JoinClient from "../JoinClient";

type Props = {
  params: { token?: string[] };
};

function JoinTokenInner({ token }: { token: string | null }) {
  return <JoinClient token={token} />;
}

export default function JoinTokenPage({ params }: Props) {
  const raw = Array.isArray(params?.token) ? params!.token![0] : "";
  const token = String(raw ?? "").trim() || null;

  return (
    <Suspense fallback={null}>
      <JoinTokenInner token={token} />
    </Suspense>
  );
}