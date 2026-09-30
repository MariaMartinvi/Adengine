# AdEngine

Motor de publicidad prudente: pegas una URL, la herramienta redacta la ficha del negocio, propone una campaña de Google Búsqueda con CPC reales, tú revisas y apruebas, y ella la crea **en pausa**. Cada día sincroniza datos y aplica reglas: baja y pausa sola, subir siempre te lo pregunta.

Diseñado para varios negocios y varios canales. Hoy tiene el adaptador de Google (`src/lib/google`); Meta, TikTok y Amazon entran como adaptadores nuevos sin tocar el núcleo (`src/lib/engine.ts`).

## Despliegue en Vercel (una vez, ~20 min)

1. **Importa este repositorio** en Vercel (Add New → Project). Framework: Next.js. No despliegues todavía si te pide variables; añádelas primero.
2. **Base de datos**: en el proyecto de Vercel → Storage → Create → Postgres (o Neon). Al conectarla, Vercel crea `DATABASE_URL` sola. Si usas Neon, copia la cadena `postgresql://…` como `DATABASE_URL`.
3. **Variables de entorno** (Settings → Environment Variables), según `.env.example`:
   - `APP_URL`: la URL del proyecto, p. ej. `https://adengine.vercel.app` (sin barra final).
   - `ENCRYPTION_KEY`: ejecuta `openssl rand -hex 32` y pega el resultado.
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: del cliente OAuth «AdEngine» en Google Cloud.
   - `GOOGLE_LOGIN_CUSTOMER_ID`: el MCC sin guiones (`6253938766`).
   - `ANTHROPIC_API_KEY`: clave de la API de Anthropic (console.anthropic.com).
   - `CRON_SECRET`: cualquier cadena larga aleatoria.
   - `STRIPE_WEBHOOK_SECRET`: se rellena en el paso 6.
4. **Despliega.** El build crea o actualiza las tablas solo (`prisma db push`), no hay que instalar nada en tu ordenador.
5. **Google Cloud**: en el cliente OAuth «AdEngine» añade la URI de redirección autorizada: `APP_URL/api/google/callback` (p. ej. `https://adengine.vercel.app/api/google/callback`). En la pantalla de consentimiento, publica la app o añade el correo del MCC como usuario de prueba.
6. **Stripe** (por negocio): Developers → Webhooks → Add endpoint → `APP_URL/api/webhooks/stripe?negocio=<id del negocio>` con los eventos `checkout.session.completed`, `invoice.paid`, `payment_intent.succeeded`. Copia el «Signing secret» a `STRIPE_WEBHOOK_SECRET`.
7. **Snippet** en cada web anunciada, antes de `</body>`:
   ```html
   <script src="https://adengine.vercel.app/adengine.js" data-endpoint="https://adengine.vercel.app/api/track"></script>
   ```
   y cuando la web conozca el email (registro o checkout): `window.adengine.identify(email)`. Con eso la venta de Stripe se atribuye al clic de Google y se sube como conversión.

El cron (`vercel.json`) llama a `/api/cron/sync` cada día a las 08:00 (Madrid). Vercel envía `CRON_SECRET` automáticamente.

## Flujo de uso

1. **Conectar Google Ads** (arriba a la derecha) con el correo del MCC.
2. **Añadir negocio** → pegar URL → la ficha aparece rellena. Revisa los cuatro topes: CAC tope, CPC máximo, presupuesto diario, gasto total. Elige la cuenta de Google Ads del negocio. Guardar.
3. **Proponer campaña**: consulta CPC y volúmenes reales en Google, elige palabras con intención de compra, escribe anuncios y negativas.
4. **Revisar y aprobar**: edita CPC por palabra, quita palabras, ajusta presupuesto. «Crear en pausa en Google Ads».
5. **Activar** cuando quieras. Pausar cuando quieras.
6. Cada día: panel con gasto, clics, ventas y coste por venta frente al tope; propuestas para aprobar o descartar.

## Reglas de prudencia (automáticas vs. con aprobación)

| Regla | Qué hace | Quién decide |
|---|---|---|
| Gasto acumulado ≥ gasto total máximo | Detiene la campaña | Automática |
| Palabra gasta ≥ 2× CAC tope sin ventas (14 días) | Pausa la palabra | Automática |
| Palabra vende a ≤ 70 % del CAC tope | Propone subir puja +15 % (nunca sobre el CPC máximo) | Tú |
| Palabra con ≥ 15 clics, sin ventas, CPC cerca del máximo | Propone bajar puja −20 % | Tú |
| Búsqueda real con ≥ 4 clics y sin ventas | Propone añadir negativa | Tú |

La puja es manual con techo por palabra: el CPC real nunca puede superar el máximo que aprobaste. Solo Búsqueda (sin partners ni display), lunes a viernes de 8 a 20 h.

## Estructura

- `src/lib/engine.ts` — núcleo: ficha, propuesta, aprobación, sincronización y reglas (independiente del canal)
- `src/lib/google/` — adaptador de Google Ads (OAuth + REST). Los futuros `meta/`, `tiktok/`, `amazon/` van al lado
- `src/lib/ai.ts` — generación con el modelo: ficha, selección de palabras, anuncios
- `src/app/api/` — rutas: negocios, propuestas, estado, cron, track, webhook de Stripe
- `public/adengine.js` — snippet universal de medición
- `prisma/schema.prisma` — datos
