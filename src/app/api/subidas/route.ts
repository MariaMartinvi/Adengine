import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
// Token para subir vídeos e imágenes de anuncios desde el navegador directamente al almacén (Vercel Blob),
// sin pasar por el límite de 4,5 MB de las funciones. La ruta está detrás de la contraseña de AdEngine.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as HandleUploadBody;
    const res = await handleUpload({
      body, request: req,
      onBeforeGenerateToken: async () => ({ allowedContentTypes: ["video/*", "image/*"], maximumSizeInBytes: 300 * 1024 * 1024, addRandomSuffix: true }),
    });
    return NextResponse.json(res);
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
