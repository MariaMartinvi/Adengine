/** @type {import('next').NextConfig} */
// ffmpeg y la fuente de los textos tienen que viajar con la función que monta los vídeos.
const nextConfig = { experimental: {
  serverComponentsExternalPackages: ["@prisma/client", "ffmpeg-static"],
  outputFileTracingIncludes: { "/api/anuncios/[id]/video": ["./node_modules/ffmpeg-static/ffmpeg", "./src/fonts/**"], "/api/negocios/[id]/referencias/video": ["./node_modules/ffmpeg-static/ffmpeg"], "/api/propuestas/[id]": ["./node_modules/ffmpeg-static/ffmpeg"] },
} };
export default nextConfig;
