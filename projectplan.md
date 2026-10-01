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
- **Freno nativo de Meta:** el conjunto lleva **presupuesto total** (= gasto total máximo) con fecha de fin (total ÷ diario días). Meta nunca gasta más. (El `spend_cap` de campaña exige mínimo 100 €.) Más el freno de AdEngine (fase 4): pausa un anuncio que gaste 2× CAC sin conversiones.
- **UE (DSA):** cada conjunto declara anunciante y pagador (`dsa_beneficiary`/`dsa_payor`), campo "Anunciante" de la ficha.
- **Acceso sin OAuth:** token de un *usuario del sistema* del Business Manager (no caduca). Una variable `META_ACCESS_TOKEN` para todas las cuentas; cada negocio guarda su `metaAdAccountId` y su `metaPixelId`.

**Decidido:** España, español; público 35-48 años; conversión = clic en el botón de Amazon. Página de Facebook "Equipo Tierra" (1254151691124601). App de Meta publicada (modo Live): en modo desarrollo Meta no deja crear anuncios.

### Fase 0 · Preparación (María, sin código)
- [x] 0.1 Porfolio renombrado a "Comartinvi"; cuenta publicitaria "Equipo Tierra" creada (EUR, Europe/Madrid) con método de pago
- [x] 0.2 Píxel "Equipo Tierra" creado: 1431144915623956, conectado a la cuenta publicitaria
- [x] 0.3 App de Meta "AdEngine" creada en el porfolio Comartinvi con el caso de uso "API de marketing"
- [x] 0.4 Usuario del sistema "AdEngine" con acceso total a la cuenta, al píxel y a la app; token sin caducidad con `ads_management`, `ads_read`, `business_management`. Verificado (01/10/2026): lee la cuenta `act_2190420808485726` (Equipo Tierra, EUR, Europe/Madrid, activa) y el píxel `1431144915623956`. **La Ads API exige v26.0** (las versiones antiguas dan error 2635)
- [ ] 0.4b María pone el token en Vercel como `META_ACCESS_TOKEN`
- [x] 0.5 Código: github.com/evavillaro/equipotierra-web (Astro, Render despliega `main`). María es colaboradora

### Fase 1 · Medición en equipotierra.com
- [x] 1.1 Píxel en todas las páginas, **sin banner de cookies** (decisión de María, 01/10/2026; el código del banner se escribió y se descartó). Privacidad actualizada. Fusionado a `main` (PR #1) y publicado en Render
- [x] 1.2 `InitiateCheckout` en los enlaces `/dp/` de Amazon (Kindle/Papel; la reseña y la página de autora no cuentan). Verificado con la versión compilada servida bajo el dominio real: llegan `PageView` e `InitiateCheckout` al píxel. Ojo: Meta ignora navegadores automáticos y `localhost`
- [x] 1.3 Verificado en la web real (01/10/2026): una visita envía `PageView` y el botón Kindle envía `InitiateCheckout` y abre Amazon

**Creatividades elegidas:** portada (`/img/portada.jpg`, 900×1391) y tráiler (`/video/trailer.mp4`, 32 s). Un conjunto de anuncios con dos anuncios (imagen y vídeo) y los mismos textos; AdEngine los coge de equipotierra.com y los sube a Meta

### Fase 2 · AdEngine: datos y acceso a Meta
- [x] 2.1 Campos nuevos en `Business` (`metaAdAccountId`, `metaPixelId`), `Campaign` (`metaCampaignId`, `metaAdSetId`) y `Ad` (`metaAdId`). SQL revisado antes: solo `ADD COLUMN`. Aplicado; datos existentes intactos (1 negocio, 1 campaña activa, 12 palabras)
- [x] 2.2 `src/lib/meta/ads.ts` (v26.0): `listAdAccounts`, `listPixels`. Verificado en vivo: lee Equipo Tierra (EUR) y su píxel; sin token → "Falta META_ACCESS_TOKEN"; token malo → error de Meta legible
- [x] 2.3 Desplegables "Cuenta de Meta" y "Píxel de Meta" en la ficha (input de respaldo sin token). Verificado con navegador en local sobre un negocio de prueba (borrado después): elegir cuenta → guardar → aparece el píxel → elegir → guardar → al recargar persisten ambos; 0 errores de consola

### Fase 3 · Propuesta y creación en pausa
- [x] 3.1 `writeMetaAds` (texto principal ≤300, titular ≤40, descripción ≤30, recortados por seguridad; habla al adulto si el producto es para menores). Pendiente de probar en producción (la clave de Anthropic solo está en Vercel)
- [x] 3.2 Imagen (URL) + vídeo opcional (URL) se suben a la biblioteca de la cuenta al proponer. Verificado en vivo: portada → hash, tráiler → vídeo procesado (`ready`)
- [x] 3.3 Crear en pausa desde la pantalla de revisión (textos editables). Verificado de punta a punta en local con un negocio de prueba: campaña PAUSED, conjunto con 50 € totales hasta +10 días, optimización `INITIATED_CHECKOUT` del píxel, 2 anuncios con la página. Borrado después en Meta y en la base de datos
- [x] 3.4 `setStatus` distingue canal; verificado pausar vía `/api/campanas/:id/estado` contra Meta

### Fase 4 · Sincronización y frenos
- [x] 4.1 `syncMetaCampaign`: insights por anuncio y día (gasto, impresiones, clics en enlace, `InitiateCheckout`) en `DailyMetric.adId`; el cron incluye campañas de Meta. Probado contra la campaña real (sin entrega aún: 0 filas, sin errores). **Pendiente: comparar con el Administrador de anuncios cuando haya datos**
- [x] 4.2 Reglas: campaña detenida al llegar al tope; anuncio pausado con gasto ≥ 2× CAC sin conversiones (`metaAdsToPause`, función pura). 6 casos de prueba OK
- [x] 4.3 Tabla por anuncio (impresiones, clics, gasto, clics a compra, coste por clic a compra). Verificada en local con datos sembrados (sumas correctas, anuncio pausado atenuado); datos borrados

## Pendiente (después)
- Campo "Contexto / aprendizajes" en la ficha que se pase a la IA al elegir palabras y escribir anuncios (feedback de campañas pasadas). No es necesario para el MVP: mientras tanto, el feedback se aplica a mano en la propuesta
- [x] Borrada la ruta de diagnóstico `src/app/api/debug/ideas` (01/10/2026)
- [x] App OAuth de Google Cloud publicada ("In production") y Google Ads reconectado (01/10/2026)
- [x] Google Ads conectado; cuenta RankCoworker (9148745988) asignada; campaña creada y activada (01/10/2026)
- ~~Cambiar la contraseña de Neon~~ — descartado por María (01/10/2026)
- [x] Next.js 14.2.15 → 14.2.35 (01/10/2026). Verificado en local: build OK, login 401/200, snippet y track 200, cabecera de bypass del middleware → 401 (también 401 en producción antes del cambio). Quedan avisos que solo se arreglan en Next 15.5+/16 (salto de versión mayor, tarea aparte); casi todos afectan a funciones que no usamos (next/image, Server Actions, rewrites)
- Consent Mode en el banner de Rankcoworker (RGPD)
- Cron: `0 6 * * *` es 08:00 solo en horario de verano
