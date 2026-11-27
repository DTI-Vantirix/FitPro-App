import React from "react";
import logoStacked from "@/assets/brand/vantrarun-stacked-full-colour.svg";

// `icon` is still accepted so the sign-in pages need no change; the brand logo
// stands in its place.
export default function AuthLayout({ title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src={logoStacked} alt="VantraRun" className="mx-auto mb-3 h-28 w-auto p-2" />
          <p className="vr-label mb-8">Own every mile.</p>
          <h1 className="text-4xl text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-3">{subtitle}</p>}
        </div>
        <div className="bg-card rounded-3xl border border-border p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
