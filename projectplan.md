# AdEngine · plan

## 1. Proteger la app con contraseña

**Problema:** `adengine-omega.vercel.app` es pública. Cualquiera puede crear negocios, aprobar y activar campañas con la cuenta de Google Ads.

**Solución:** Basic Auth en `src/middleware.ts` (un archivo, ~20 líneas). Usuario y contraseña en variables de entorno `ADMIN_USER` / `ADMIN_PASSWORD`. El navegador pide las credenciales una vez y las recuerda.

**Rutas que quedan públicas** (las llaman servicios externos, no personas):
- `/api/track` y `/adengine.js` → las webs anunciadas (snippet)
- `/api/webhooks/stripe` → Stripe (verifica firma propia)
- `/api/cron/sync` → cron de Vercel (ya protegido con `CRON_SECRET`)

Todo lo demás (páginas, `/api/negocios`, `/api/propuestas`, `/api/campanas`, `/api/google/*`) pide contraseña.

- [x] 1.1 Crear `src/middleware.ts` → verificado: `tsc --noEmit` OK y, con `next dev` local, `/` y `/api/negocios` → 401 sin credenciales (y con credenciales malas), `/` → 200 con credenciales; `/adengine.js`, `/api/track`, `/api/webhooks/stripe`, `/api/cron/sync` siguen llegando a su ruta sin pedir contraseña
- [x] 1.2 Añadir `ADMIN_USER` y `ADMIN_PASSWORD` a `.env.example` y README
- [x] 1.3 María añade las dos variables en Vercel; push + deploy (commit 0b98e5e)
- [x] 1.4 Verificado en producción con curl (30/09/2026): `/`, `/negocios/nuevo`, `/api/negocios`, `/api/google/auth` → 401; `/adengine.js` y `/api/track` → 200; `/api/webhooks/stripe` → 400 (firma, llega a la ruta); `/api/cron/sync` → 401 del propio CRON_SECRET
  - `GET /` sin credenciales → 401
  - `GET /` con credenciales → 200
  - `POST /api/track` sin credenciales → 200
  - `GET /adengine.js` sin credenciales → 200
  - `GET /api/cron/sync` sin `CRON_SECRET` → 401 (el suyo, no el de Basic Auth)

## 3. Vincular Stripe (Rankcoworker)

**Cómo funciona:** Stripe avisa a AdEngine de cada pago (`checkout.session.completed`, `invoice.paid`, `payment_intent.succeeded`). AdEngine busca el email del pagador en `Visitor`; si llegó desde un anuncio (tiene `gclid`), registra la venta y la sube a Google Ads como conversión.

**Supuesto:** la cuenta de Stripe de Rankcoworker solo cobra Rankcoworker. Si la misma cuenta cobrase otros negocios, sus ventas también se atribuirían a Rankcoworker (el webhook es por negocio, no por producto).

Sin cambios de código. Todo es configuración:

- [x] 3.1 Webhook creado por API (we_1ULg7fFJyDU54kF6EjE9o2ti, live, 01/10/2026):
  - URL: `https://adengine-omega.vercel.app/api/webhooks/stripe?negocio=cmunxjfi2000010sgyys2f42a`
  - Eventos: solo `checkout.session.completed` (los otros duplicarían la venta)
- [x] 3.2 Copiar el *Signing secret* (`whsec_…`) → Vercel `STRIPE_WEBHOOK_SECRET` → Redeploy
- [x] 3.3 Verificado (01/10/2026): evento `checkout.session.completed` firmado con el secret → 200 `{"ok":true}`; se registró la venta (6 EUR, canal `organic`, sin subir porque el email no tenía gclid) y la línea `VENTA` del historial. Filas de prueba borradas después

## Pendiente (después)
- Campo "Contexto / aprendizajes" en la ficha que se pase a la IA al elegir palabras y escribir anuncios (feedback de campañas pasadas). No es necesario para el MVP: mientras tanto, el feedback se aplica a mano en la propuesta
- [x] Borrada la ruta de diagnóstico `src/app/api/debug/ideas` (01/10/2026)
- [x] App OAuth de Google Cloud publicada ("In production") y Google Ads reconectado (01/10/2026)
- [x] Google Ads conectado; cuenta RankCoworker (9148745988) asignada; campaña creada y activada (01/10/2026)
- ~~Cambiar la contraseña de Neon~~ — descartado por María (01/10/2026)
- [x] Next.js 14.2.15 → 14.2.35 (01/10/2026). Verificado en local: build OK, login 401/200, snippet y track 200, cabecera de bypass del middleware → 401 (también 401 en producción antes del cambio). Quedan avisos que solo se arreglan en Next 15.5+/16 (salto de versión mayor, tarea aparte); casi todos afectan a funciones que no usamos (next/image, Server Actions, rewrites)
- Consent Mode en el banner de Rankcoworker (RGPD)
- Cron: `0 6 * * *` es 08:00 solo en horario de verano
