// app/join/[token]/page.tsx
import JoinClient from "../JoinClient";

type Props = {
  params: { token?: string };
};

export default function JoinTokenPage({ params }: Props) {
  const token = String(params?.token ?? "").trim() || null;
  return <JoinClient token={token} />;
}