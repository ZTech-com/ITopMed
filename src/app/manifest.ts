import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ITop Med",
    short_name: "ITop Med",
    description: "ITop Med healthcare management platform",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#0a66d8",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
