import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { currentTheme } from "@/components/shell/app-shell";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

const sans = Manrope({ subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ITop Med", template: "%s · ITop Med" },
  description: "ITop Med — healthcare management platform",
  applicationName: "ITop Med",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "ITop Med", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f12" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, theme] = await Promise.all([getLocale(), currentTheme()]);
  return (
    <html lang={locale} data-theme={theme === "system" ? undefined : theme} className={sans.variable} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
