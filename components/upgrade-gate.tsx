// components/upgrade-gate.tsx
"use client";

import React from "react";

type Props = {
  title?: string;
  message?: string;

  // New names (preferred)
  href?: string;
  cta?: string;

  // Back-compat names (your pages currently use these)
  ctaHref?: string;
  ctaLabel?: string;

  children?: React.ReactNode;
};

export function UpgradeGate(props: Props) {
  const title = props.title ?? "Upgrade required";
  const message =
    props.message ?? "This feature is available on a paid plan. Upgrade to unlock it.";

  const href = props.href ?? props.ctaHref ?? "/app/settings/billing";
  const cta = props.cta ?? props.ctaLabel ?? "Upgrade";

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-amber-800">{message}</div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={href}
          className="inline-flex items-center justify-center rounded-xl bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {cta}
        </a>

        {props.children ? (
          <div className="text-sm text-amber-800">{props.children}</div>
        ) : null}
      </div>
    </div>
  );
}

export default UpgradeGate;