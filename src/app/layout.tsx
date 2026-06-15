import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "PoE2 Crafting Helper",
  description:
    "Browse Path of Exile 2 item bases and modifiers, reference crafting materials, plan crafting paths, and price-check items.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

const shellWidth =
  "mx-auto w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[1400px] px-4 sm:px-6 lg:px-8";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <SiteNav />
        <main className={`${shellWidth} flex-1 py-6`}>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
