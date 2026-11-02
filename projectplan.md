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

### Varias portadas (01/10/2026)
- [x] Propuesta con varias imágenes (una URL por línea): un anuncio por imagen + vídeo opcional
- [x] "Añadir portada" en una campaña de Meta ya creada: nuevo anuncio en el mismo conjunto, mismos textos y presupuesto (`createAd` reutilizado). Verificado en vivo con una campaña de prueba en pausa (se añadió la segunda imagen sin errores) y borrado después

## 4b. Una campaña por canal en cada negocio
**Problema:** cada negocio solo muestra una campaña viva; proponer en un canal borra la propuesta pendiente del otro.
- [x] 4b.1 Al proponer, se borran solo los borradores del mismo canal (`channel: "google"` / `"meta"`)
- [x] 4b.2 Panel por canal (propuesta y campaña viva de Google y de Meta, cada una con su estado). Verificado en local: negocio con Google activa + propuesta Meta muestra las dos; "Pausar" actúa sobre la de Google y "Crear en pausa en Meta" sobre la de Meta; datos de prueba borrados

## 5. Amazon Ads (libros) · en espera de acceso a la API
**Por qué:** es el único canal que mide la venta real del libro (ACOS). Objetivo de María: volumen sin perder dinero (coste por libro ≤ regalías).
- [ ] 5.0 María: cuenta de Amazon Ads desde KDP (Marketing → Amazon Ads → Amazon.es)
- [ ] 5.1 María: perfil de seguridad "AdEngine" en Login with Amazon (developer.amazon.com)
- [x] 5.2 María: solicitud de acceso a la Amazon Ads API enviada (01/10/2026). Esperando respuesta de Amazon (puede tardar semanas; incierto si se concede a cuentas de KDP)
- [ ] 5.3 **No construir nada todavía** (decisión de María, 01/10/2026): solo se pide el acceso para no esperar semanas después. El adaptador se decide más adelante, con los resultados de Meta

## 6. TikTok Ads · canal universal de AdEngine

**Objetivo:** mismo ciclo que Google y Meta (ficha → propuesta → apruebas → se crea en pausa → activas → sincronización diaria con frenos), para cualquier negocio. TikTok es solo vídeo.

**Diseño (igual que Meta):**
- **Acceso:** app de desarrollador de TikTok for Business (Marketing API). TikTok tiene que aprobarla; mientras, se puede programar contra su *sandbox*. Conexión por OAuth una vez (token de larga duración, cifrado en la base de datos como el de Google).
- **Por negocio:** `tiktokAdvertiserId` (cuenta publicitaria) y `tiktokPixelId`. Una cuenta publicitaria por producto dentro del Business Center "Comartinvi".
- **Freno nativo:** presupuesto total del grupo de anuncios con fecha de fin (como en Meta). Más el de AdEngine: pausa el anuncio que gaste 2× CAC sin conversiones.
- **Público:** adultos (TikTok no permite anuncios a menores en la UE).
- **Medición:** píxel de TikTok en la web de cada negocio (por GTM donde ya hay GTM; por código en equipotierra.com) con el mismo evento de conversión que use ese negocio.

### Fase 0 · Preparación (María, sin código)
- [x] 0.1 Business Center "Comartinvi_bc_o7vloy" (7691699034276380693); cuenta de ChatSalsa: **Chatsalsa_qwt3d7** (7691700167782842420), en revisión por TikTok (01/10/2026). Hay otras cuentas creadas por error (Chatsalsa, Comartinvi, Comartinvi_adv): se ignoran
- [x] 0.2 María es desarrolladora en business-api.tiktok.com; app "AdEngine" enviada a revisión (01/10/2026) con permisos de cuentas, anuncios, informes, píxel, creatividades y Measurement; retorno `https://adengine-omega.vercel.app/api/tiktok/callback`. **Pendiente de aprobación**: el App ID y el Secret aparecerán al aprobarla
- [ ] 0.3 Píxel de TikTok del primer negocio
- [x] 0.4 Primer negocio en TikTok: **ChatSalsa** (ya tiene GTM GTM-P4PTW3CH; el píxel se pone por GTM) — decidido 01/10/2026

### Fase 1 · Conexión
- [ ] 1.1 `src/lib/tiktok/ads.ts` (cliente mínimo) + OAuth (`/api/tiktok/auth`, `/api/tiktok/callback`), token cifrado → verificar: lista las cuentas publicitarias
- [ ] 1.2 Campos de TikTok en la ficha (cuenta y píxel en desplegables) → verificar: se guardan y se recargan

### Fase 2 · Propuesta y creación en pausa
- [ ] 2.1 IA: texto de anuncio para TikTok (corto) → verificar: límites respetados
- [ ] 2.2 Subir vídeo(s) por URL → verificar: TikTok devuelve el id del vídeo
- [ ] 2.3 Crear campaña + grupo (presupuesto total, fecha de fin, adultos, optimización al evento del píxel) + anuncios EN PAUSA; si falla a medias, se borra → verificar: aparece en pausa con esos ajustes; prueba de fallo no deja restos
- [ ] 2.4 Activar/pausar desde AdEngine

### Fase 3 · Sincronización y frenos
- [ ] 3.1 Métricas por anuncio y día en el cron → verificar: coinciden con TikTok Ads Manager
- [ ] 3.2 Reglas (tope total, 2× CAC sin conversiones) con pruebas
- [ ] 3.3 Tabla por anuncio en el panel

## 7. Borrar fichas

**Problema:** hay fichas duplicadas (4× "ChatSalsa – Porra Halloween") y no se pueden quitar desde la app.

**Lo que ya hay:** `DELETE /api/negocios/[id]` existe (protegido por Basic Auth) y borra en cascada campañas, palabras, anuncios, métricas, propuestas, historial y ventas. Falta el botón y un freno.

**Freno:** si la ficha tiene una campaña **activa** en Google o Meta, no se borra (error 409: "Pausa la campaña antes de borrar"). Motivo: al borrar la ficha, el cron deja de vigilarla y la campaña seguiría gastando en Google/Meta sin tope de AdEngine. Las campañas en pausa sí se pueden borrar: se quedan pausadas en Google/Meta (no gastan) y se pueden eliminar allí a mano.

- [x] 7.1 Freno en `DELETE`: 409 si hay alguna campaña `ENABLED`; 404 si la ficha no existe → verificar: con `next dev`, curl a una ficha con campaña activa → 409 y sigue en la BD; ficha inexistente → 404. Hecho (02/11/2026): `tsc` OK; sin BD local, se verifica en producción en 7.3
- [x] 7.2 Botón "Borrar ficha" en `BusinessPanel` (rojo, al final), con `confirm()` que nombra el negocio; tras borrar vuelve a `/` → verificar: borrar una ficha duplicada sin campaña en local → desaparece de la lista. Hecho: si el borrado falla, el error sale arriba y la página sube hasta él
- [ ] 7.3 Push + borrar en producción los 3 duplicados sin campaña (lo haces tú desde el botón)

## 8. Editar campañas vivas desde AdEngine

**Problema:** una vez creada, AdEngine solo deja activar/pausar. Cambiar presupuesto o público obliga a tocar Meta/Google por fuera y el panel queda desfasado (Cuadros con Alma: Meta tiene 150 €, AdEngine cree 300 €). Además la edad de Meta está fija en 35-48 (la de Equipo Tierra) y un doble clic en "Crear" crea la campaña dos veces.

**Regla:** todo cambio pasa por AdEngine. AdEngine actualiza Meta/Google y su propia BD en el mismo paso, y lo apunta en el historial.

- [x] 8.1 Cambiar presupuesto de una campaña viva. Campos "€/día" y "tope total" + botón "Guardar presupuesto" en el bloque de la campaña. Meta: `lifetime_budget` del conjunto = tope y fecha de fin = hoy + (tope − gastado) ÷ €/día; rechaza un tope por debajo de lo ya gastado. Google: importe diario del presupuesto de la campaña; el tope total lo sigue vigilando el cron → verificar: en producción, Cuadros con Alma (Meta) a 5 €/día y 150 € → el panel muestra 150 €, Meta tiene 150 € y la fecha cuadra, línea en el historial. Hecho (02/11/2026): AdEngine y Meta en 5 €/día · 150 €, fin 2 dic, línea PRESUPUESTO
- [x] 8.2 Edad del público de Meta en la ficha (campos "edad mín./máx."; por defecto 18-65; Equipo Tierra se queda en 35-48). La usan las campañas nuevas → verificar: `tsc` OK y la propuesta de Meta de Caricaturea sale con la edad de su ficha. Hecho: columnas `ageMin`/`ageMax` (18-65 por defecto), Equipo Tierra fijada en 35-48, Cuadros con Alma 35-65; `approveMetaCampaign` usa la ficha (Caricaturea aún no tiene Meta para probarlo en vivo)
- [x] 8.3 Aplicar la edad de la ficha a una campaña de Meta viva (botón junto al presupuesto) → verificar: Cuadros con Alma pasa de 35-48 a 35-65 en Meta y en el historial. Hecho: Meta 35-65, línea PUBLICO. Ojo: Meta solo deja editar un conjunto cada 30 s (error #613); reintentar
- [x] 8.4 Doble clic en "Crear": la campaña pasa a `CREATING` de forma atómica antes de llamar a Meta/Google; un segundo clic recibe "ya se está creando"; si falla, vuelve a `DRAFT` → verificar: dos peticiones simultáneas de aprobar → una crea, la otra da error; solo una campaña en Meta. Hecho con el borrador de Google de Cuadros con Alma: una petición 200 (campaña 24417447066 en pausa, 5 €/día · 150 €), la otra 409
- [x] 8.6 Ficha arriba y debajo dos pestañas, Meta y Google, una al lado de la otra; cada una con su propuesta o su campaña viva → `next build` OK; revisión visual: María en el panel
- [ ] 8.5 Campaña duplicada de Cuadros con Alma en Meta (`120255427744780260`, en pausa): AdEngine no la conoce, así que no puede borrarla. La borra María en el Administrador de anuncios (o yo por API como excepción, si me lo dice)

**Tests:** el proyecto no tiene test runner. Cada tarea se verifica con `tsc --noEmit` y los pasos manuales de arriba, en producción y sobre campañas reales (en pausa salvo Cuadros con Alma Meta, que ya está activa).

## 9. Referencias que funcionan (inspiración para la IA)

**Idea (María):** pasar a AdEngine anuncios de la competencia que llevan tiempo activos (p. ej. Christian Modern, Biblioteca de anuncios) para que la IA escriba con referencias de lo que funciona. Cubre también el antiguo pendiente "Contexto / aprendizajes".

**Límites comprobados (02/11/2026):** la Biblioteca de anuncios es una página dinámica (no se puede leer desde el servidor de forma fiable) y su API pide una autorización aparte (error 10/2332002, facebook.com/ads/library/api) y solo devuelve anuncios comerciales mostrados en la UE.

**Regla (María, 02/11/2026): antes de generar, copiar lo que funciona.** Se copia la fórmula (formato, gancho, estructura, oferta, botón); no el contenido (frases, imágenes, vídeos, marca, cifras de otros).

- [ ] 9.1 Referencias por canal, cada canal en su pestaña, subidas por AdEngine (María, 02/11/2026): lista de referencias con nota de texto y captura opcional (se reduce en el navegador a ≤1280 px JPEG y se guarda en la BD; tabla `Reference`). Se pueden borrar. Vídeos no: captura del primer fotograma + nota → verificar: añadir una referencia con captura en cada pestaña, recargar y siguen ahí; borrar una
- [ ] 9.2 La IA recibe solo las referencias de su canal y **replica su estructura** (formato, gancho, longitud, oferta, botón) con datos reales del negocio; no calca frases, imágenes ni cifras ajenas. Cada anuncio propuesto indica qué referencia imita. Sin referencias no se genera: el botón de proponer pide añadirlas antes → verificar: "Volver a proponer" en Cuadros con Alma con las referencias de Christian Modern → Meta usa el ángulo (testimonio, casa nueva) y Google la oferta del 15 % y detalles reales (marco de madera, envío gratis Península y Baleares), sin repetir sus frases ni inventar reseñas

La IA ve las capturas (bloques de imagen en la llamada a Claude), como máximo las 6 referencias más recientes del canal.
- [ ] 9.3 (Opcional, más adelante) Leer solos los anuncios activos de una página de la competencia con la API de la Biblioteca. Requiere que María complete la autorización en facebook.com/ads/library/api; útil solo para competidores que anuncian en la UE

## Pendiente (después)
- [x] Borrada la ruta de diagnóstico `src/app/api/debug/ideas` (01/10/2026)
- [x] App OAuth de Google Cloud publicada ("In production") y Google Ads reconectado (01/10/2026)
- [x] Google Ads conectado; cuenta RankCoworker (9148745988) asignada; campaña creada y activada (01/10/2026)
- ~~Cambiar la contraseña de Neon~~ — descartado por María (01/10/2026)
- [x] Next.js 14.2.15 → 14.2.35 (01/10/2026). Verificado en local: build OK, login 401/200, snippet y track 200, cabecera de bypass del middleware → 401 (también 401 en producción antes del cambio). Quedan avisos que solo se arreglan en Next 15.5+/16 (salto de versión mayor, tarea aparte); casi todos afectan a funciones que no usamos (next/image, Server Actions, rewrites)
- Consent Mode en el banner de Rankcoworker (RGPD)
- Cron: `0 6 * * *` es 08:00 solo en horario de verano
- [x] Google Ads API v22 → v26 (02/11/2026): v22 ya rechazada por Google (400) y el permiso OAuth estaba revocado (`invalid_grant`, reconectado). Desde entonces el cron no leía Google: RankCoworker sin métricas ni frenos. Verificado: campos y enums usados existen en el discovery de v26
