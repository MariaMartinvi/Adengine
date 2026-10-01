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

## 4. Meta Ads · primer negocio: Equipo Tierra (libro)

**Objetivo:** AdEngine crea y gobierna campañas de Meta (Facebook + Instagram) con el mismo esquema que Google: ficha → propuesta → apruebas → se crea en pausa → activas → sincronización diaria con frenos.

**Cómo se mide (opción A acordada):** el anuncio lleva a equipotierra.com, nunca directo a Amazon. El píxel de Meta registra el clic en "Comprar en Amazon" como conversión (`InitiateCheckout`). Meta optimiza hacia gente que hace ese clic. Las ventas reales se comparan a mano con el informe de KDP (gasto semanal vs libros vendidos).

**Diferencias con Google que marcan el diseño:**
- Sin palabras clave: **público + creatividades**. Público amplio (Advantage+: país + edad), que es lo que Meta recomienda hoy; nada de intereses al principio.
- Las **imágenes las pones tú** (portada, ilustraciones). La IA escribe los textos.
- **Freno nativo de Meta:** el `spend_cap` de la campaña = gasto total máximo. Meta la para sola aunque AdEngine falle. Más el freno de AdEngine: pausa un anuncio que gaste 2× CAC sin conversiones.
- **Acceso sin OAuth:** token de un *usuario del sistema* del Business Manager (no caduca). Una variable `META_ACCESS_TOKEN` para todas las cuentas; cada negocio guarda su `metaAdAccountId` y su `metaPixelId`.

**Suposiciones (confirmar):** España, español; público adultos 25-55 (padres/docentes); 5 €/día, 100 € tope; conversión = clic en el botón de Amazon.

### Fase 0 · Preparación (María, sin código)
- [x] 0.1 Porfolio renombrado a "Comartinvi"; cuenta publicitaria "Equipo Tierra" creada (EUR, Europe/Madrid) con método de pago
- [x] 0.2 Píxel "Equipo Tierra" creado: 1431144915623956, conectado a la cuenta publicitaria
- [x] 0.3 App de Meta "AdEngine" creada en el porfolio Comartinvi con el caso de uso "API de marketing"
- [x] 0.4 Usuario del sistema "AdEngine" con acceso total a la cuenta, al píxel y a la app; token sin caducidad con `ads_management`, `ads_read`, `business_management`. Verificado (01/10/2026): lee la cuenta `act_2190420808485726` (Equipo Tierra, EUR, Europe/Madrid, activa) y el píxel `1431144915623956`. **La Ads API exige v26.0** (las versiones antiguas dan error 2635)
- [ ] 0.4b María pone el token en Vercel como `META_ACCESS_TOKEN`
- [ ] 0.5 Decir dónde está el código de equipotierra.com (o acceso para editarla) → verificar: sé cómo añadir el píxel

### Fase 1 · Medición en equipotierra.com
- [ ] 1.1 Píxel base en todas las páginas → verificar: "Meta Pixel Helper" detecta `PageView`
- [ ] 1.2 Evento `InitiateCheckout` al pulsar cualquier enlace a Amazon (ebook y papel) → verificar: aparece en "Probar eventos" del Administrador de eventos

### Fase 2 · AdEngine: datos y acceso a Meta
- [ ] 2.1 Campos nuevos en `Business` (`metaAdAccountId`, `metaPixelId`) y en `Campaign`/`Ad` para ids de Meta; `prisma db push` aditivo → verificar: build OK, datos existentes intactos
- [ ] 2.2 `src/lib/meta/ads.ts`: cliente mínimo de la Marketing API (leer cuenta) → verificar: con el token lee nombre y moneda de la cuenta
- [ ] 2.3 Selector de canal y campos de Meta en la ficha → verificar: se guardan y se recargan

### Fase 3 · Propuesta y creación en pausa
- [ ] 3.1 IA: textos de Meta (texto principal, titular, descripción) a partir de la ficha → verificar: test con una ficha de ejemplo, límites de caracteres respetados
- [ ] 3.2 Subida de 1-3 imágenes en la propuesta → verificar: se suben a Meta y devuelve sus hashes
- [ ] 3.3 Crear campaña + conjunto + anuncios EN PAUSA con `spend_cap`, presupuesto diario, público ES 25-55 y optimización a `InitiateCheckout` → verificar: aparece en el Administrador de anuncios, en pausa, con esos ajustes
- [ ] 3.4 Activar/pausar desde AdEngine → verificar: cambia el estado en Meta y en el panel

### Fase 4 · Sincronización y frenos
- [ ] 4.1 Cron diario: gasto, impresiones, clics y conversiones por anuncio → verificar: los números coinciden con el Administrador de anuncios
- [ ] 4.2 Regla: pausar anuncio con gasto ≥ 2× CAC sin conversiones; parar campaña al llegar al tope → verificar: test con datos simulados
- [ ] 4.3 Panel: métricas de Meta en la ficha del negocio → verificar: se ven tras la primera sincronización

## Pendiente (después)
- Campo "Contexto / aprendizajes" en la ficha que se pase a la IA al elegir palabras y escribir anuncios (feedback de campañas pasadas). No es necesario para el MVP: mientras tanto, el feedback se aplica a mano en la propuesta
- [x] Borrada la ruta de diagnóstico `src/app/api/debug/ideas` (01/10/2026)
- [x] App OAuth de Google Cloud publicada ("In production") y Google Ads reconectado (01/10/2026)
- [x] Google Ads conectado; cuenta RankCoworker (9148745988) asignada; campaña creada y activada (01/10/2026)
- ~~Cambiar la contraseña de Neon~~ — descartado por María (01/10/2026)
- [x] Next.js 14.2.15 → 14.2.35 (01/10/2026). Verificado en local: build OK, login 401/200, snippet y track 200, cabecera de bypass del middleware → 401 (también 401 en producción antes del cambio). Quedan avisos que solo se arreglan en Next 15.5+/16 (salto de versión mayor, tarea aparte); casi todos afectan a funciones que no usamos (next/image, Server Actions, rewrites)
- Consent Mode en el banner de Rankcoworker (RGPD)
- Cron: `0 6 * * *` es 08:00 solo en horario de verano
