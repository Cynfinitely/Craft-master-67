import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: { default: "PoE2 Crafting Helper", template: "%s · PoE2 Crafting Helper" },
  description:
    "Browse Path of Exile 2 item bases and modifiers, reference crafting materials, plan crafting paths, and price-check items.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <SiteNav />
        <main id="main" tabIndex={-1} className="container-shell flex-1 py-6 outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
