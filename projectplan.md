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
- [ ] 1.3 María añade las dos variables en Vercel; push + deploy
- [ ] 1.4 Verificar en producción con curl:
  - `GET /` sin credenciales → 401
  - `GET /` con credenciales → 200
  - `POST /api/track` sin credenciales → 200
  - `GET /adengine.js` sin credenciales → 200
  - `GET /api/cron/sync` sin `CRON_SECRET` → 401 (el suyo, no el de Basic Auth)

## 3. Vincular Stripe (Rankcoworker)

**Cómo funciona:** Stripe avisa a AdEngine de cada pago (`checkout.session.completed`, `invoice.paid`, `payment_intent.succeeded`). AdEngine busca el email del pagador en `Visitor`; si llegó desde un anuncio (tiene `gclid`), registra la venta y la sube a Google Ads como conversión.

**Supuesto:** la cuenta de Stripe de Rankcoworker solo cobra Rankcoworker. Si la misma cuenta cobrase otros negocios, sus ventas también se atribuirían a Rankcoworker (el webhook es por negocio, no por producto).

Sin cambios de código. Todo es configuración:

- [ ] 3.1 Stripe → Developers → Webhooks → Add endpoint:
  - URL: `https://adengine-omega.vercel.app/api/webhooks/stripe?negocio=cmunxjfi2000010sgyys2f42a`
  - Eventos: `checkout.session.completed`, `invoice.paid`, `payment_intent.succeeded`
- [ ] 3.2 Copiar el *Signing secret* (`whsec_…`) → Vercel `STRIPE_WEBHOOK_SECRET` → Redeploy
- [ ] 3.3 Verificar: en Stripe, "Send test event" (`checkout.session.completed`) → Stripe muestra respuesta 200 y en AdEngine aparece una línea `VENTA` en el historial del negocio (canal `organic`, porque el email de prueba no tiene gclid)

## Pendiente (después)
- Conectar Google Ads y asignar la cuenta al negocio
- Cambiar la contraseña de Neon (se pegó en el chat)
- Actualizar Next.js 14.2.15 (aviso de seguridad)
- Consent Mode en el banner de Rankcoworker (RGPD)
- Cron: `0 6 * * *` es 08:00 solo en horario de verano
