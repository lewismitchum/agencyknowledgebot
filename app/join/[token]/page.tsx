// app/join/[...token]/page.tsx
import JoinClient from "../JoinClient";

type Props = {
  params: { token?: string[] };
};

export default function JoinTokenPage({ params }: Props) {
  const token = Array.isArray(params?.token) ? params.token[0] : "";
  const cleaned = String(token ?? "").trim() || null;
  return <JoinClient token={cleaned} />;
}