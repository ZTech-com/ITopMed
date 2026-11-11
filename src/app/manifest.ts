import type { MetadataRoute } from "next";

/**
 * Web app manifest: installable on Android/Chrome/Edge (install prompt),
 * desktop (Windows/macOS/Linux via Chromium) and iOS/iPadOS (Share → Add to
 * Home Screen). Shortcuts open the most used screens from the app icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ITop Med",
    short_name: "ITop Med",
    description: "ITop Med — clinic management platform",
    lang: "uz-Latn",
    dir: "ltr",
    start_url: "/clinics?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#f5f5f7",
    theme_color: "#0a66d8",
    categories: ["medical", "business", "productivity"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Bemorlar · Patients", short_name: "Bemorlar", url: "/clinics?to=patients", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Navbat · Queue", short_name: "Navbat", url: "/clinics?to=queue", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Bugungi bemorlarim · My patients", short_name: "Qabul", url: "/clinics?to=my-queue", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
