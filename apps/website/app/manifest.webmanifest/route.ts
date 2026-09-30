const manifest = {
  name: "JURO — Юрист в кармане",
  short_name: "JURO",
  description: "Юридическая ситуация превращается в понятные факты, риски и следующий шаг.",
  start_url: "/ru",
  display: "standalone",
  background_color: "#f8f6f2",
  theme_color: "#061827",
  lang: "ru",
  icons: [
    { src: "/brand/JURO_avatar_1080.png", sizes: "1080x1080", type: "image/png" },
  ],
};

export function GET(): Response {
  return Response.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
}
