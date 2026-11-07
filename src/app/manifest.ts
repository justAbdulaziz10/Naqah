import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NAQAH | ناقة",
    short_name: "ناقة",
    description: "إدارة هادئة لعزبة الإبل، مع آخر المستجدات المهمة.",
    lang: "ar",
    dir: "rtl",
    start_url: "/ar/app",
    scope: "/",
    display: "standalone",
    background_color: "#f5f0e8",
    theme_color: "#29241f",
    icons: [
      { src: "/pwa-icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/512.png?purpose=maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Call Lab",
        short_name: "Lab",
        description: "Try a NAQAH call",
        url: "/ar/app/lab",
        icons: [{ src: "/pwa-icons/192.png?shortcut=lab", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Tickets",
        url: "/ar/app/tickets",
        icons: [{ src: "/pwa-icons/192.png?shortcut=tickets", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Herd",
        url: "/ar/app/herd",
        icons: [{ src: "/pwa-icons/192.png?shortcut=herd", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
