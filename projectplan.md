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

- [x] 9.1 Referencias por canal, cada canal en su pestaña, subidas por AdEngine (María, 02/11/2026): lista de referencias con nota de texto y captura opcional (se reduce en el navegador a ≤1280 px JPEG y se guarda en la BD; tabla `Reference`). Se pueden borrar. Vídeos no: captura del primer fotograma + nota → verificar: añadir una referencia con captura en cada pestaña, recargar y siguen ahí; borrar una. Hecho (02/11/2026): en producción, añadir y borrar referencia de prueba en Caricaturea OK (queda la línea REFERENCIA en el historial)
- [ ] 9.2 La IA recibe solo las referencias de su canal y **replica su estructura** (formato, gancho, longitud, oferta, botón) con datos reales del negocio; no calca frases, imágenes ni cifras ajenas. Cada anuncio propuesto indica qué referencia imita. Sin referencias no se genera: el botón de proponer pide añadirlas antes → verificar: "Volver a proponer" en Cuadros con Alma con las referencias de Christian Modern → Meta usa el ángulo (testimonio, casa nueva) y Google la oferta del 15 % y detalles reales (marco de madera, envío gratis Península y Baleares), sin repetir sus frases ni inventar reseñas. Código hecho y bloqueo comprobado ("Añade al menos una referencia que funcione en Google antes de proponer"); falta la prueba con las referencias reales que suba María

La IA ve las capturas (bloques de imagen en la llamada a Claude), como máximo las 6 referencias más recientes del canal.
- [ ] 9.5 Campo "Nuestro cuadro" en cada referencia (María, 02/11/2026): el anuncio que se genere a partir de esa referencia es de ese cuadro; la regla de la IA dice que imagen, vídeo y producto son siempre nuestros → verificar: guardar una referencia con cuadro y verlo en la tarjeta
- [ ] 9.4 Referencias de vídeo: casilla "Es un vídeo" y campo obligatorio "Música y audio" (la IA no oye el vídeo; lo describe María). Secuencia: María pone el enlace → Claude dice lo que ve (fotogramas) → María añade la música → se guarda → verificar: guardar un vídeo sin música da error; con música se guarda y la IA lo recibe como "(vídeo) … Música y audio: …"
- [ ] 9.3 (Opcional, más adelante) Leer solos los anuncios activos de una página de la competencia con la API de la Biblioteca. Requiere que María complete la autorización en facebook.com/ads/library/api; útil solo para competidores que anuncian en la UE

## 10. Botón "Comprar" y enlace al cuadro en Meta

**Por qué:** AdEngine pone siempre "Más información" y manda todo a la portada. Christian Modern usa "Comprar" y cada anuncio lleva a la página de su cuadro (titular = nombre del producto).

- [x] 10.1 Botón de Meta en la ficha (Comprar / Más información / Registrarte; por defecto Comprar). Equipo Tierra y ChatSalsa se quedan en "Más información" → verificar: la ficha guarda el botón y los anuncios nuevos lo usan. Hecho (02/11/2026): `metaCta` (SHOP_NOW por defecto), Equipo Tierra fijada en LEARN_MORE; build OK
- [x] 10.2 Enlace por anuncio: al proponer, cada imagen puede llevar su enlace (`imagen | enlace`, una por línea); sin enlace, la web de la ficha → verificar: la propuesta guarda el enlace de cada anuncio. Código hecho; se prueba en vivo con la propuesta nueva de Cuadros con Alma (sección 11)
- [ ] 10.3 Rehacer los anuncios de una campaña de Meta viva con el botón y los enlaces actuales (en Meta el botón no se edita: se crea un anuncio nuevo y se pausa el viejo). Enlace editable por anuncio en el panel → verificar: Cuadros con Alma pasa a "Comprar" y cada anuncio a la página de su cuadro; los viejos quedan en pausa. Código hecho y desplegado (el anuncio viejo queda en pausa con su historial y se crea uno nuevo, para no mezclar el gasto del día). No aplicado: María decide rehacer Cuadros con Alma desde cero

## 11. Cuadros con Alma desde cero

**Decisión (María, 02/11/2026):** parar todo lo de Cuadros con Alma y hacerlo bien desde cero. Hecho: campaña de Meta pausada desde AdEngine (Meta: 0 € gastados), Google ya en pausa. Se mantienen ficha y referencias.

- [x] 11.1 Botón "Archivar campaña" (solo en pausa o detenida): queda en pausa en Meta/Google con su historial, estado ARCHIVED en AdEngine, el cron no la toca, y la pestaña vuelve a permitir proponer → verificar: archivar las dos de Cuadros con Alma; las pestañas muestran "Proponer"; siguen en pausa en Meta/Google. Hecho (02/11/2026): las dos archivadas; Meta sigue PAUSED; la pestaña Meta muestra el campo «imagen | enlace»
- [ ] 11.2 Referencias de Cuadros con Alma: Meta (vídeo de Christian Modern ya guardado + sus 2 anuncios de imagen) y Google (Centro de transparencia), con la secuencia enlace → lo que veo → música → guardar
- [ ] 11.3 Propuesta de Meta: botón Comprar, cada imagen con el enlace a su cuadro, textos que copian la fórmula de las referencias
- [ ] 11.4 Propuesta de Google con referencias: oferta del 15 % y detalles reales, sin reseñas inventadas
- [ ] 11.5 María revisa, se crean en pausa y las activa ella

## 12. Anuncios casi iguales a las referencias, con nuestros productos y en castellano

**Petición (María, 02/11/2026):** que AdEngine proponga anuncios casi al 100 % iguales a las referencias, pero con nuestros productos y en castellano.
**Límite:** testimonios, reseñas y cifras ("#1", "4,9 estrellas", "el más regalado") no se copian: serían falsos. Todo lo demás sí (formato, estructura, longitud, tono, gancho, botón). Si falta una frase real, AdEngine avisa o usa una nuestra.

- [x] 12.1 Productos en la ficha (nombre, enlace, imagen), comunes a Meta y Google; carga inicial desde la web de Cuadros con Alma → verificar: lista de 21 cuadros en la ficha, se pueden quitar y añadir. Hecho (02/11/2026): 20 cuadros + "La tienda en general" cargados desde la web; datos reales y presupuesto 5 €/día · 150 € en la ficha
- [x] 12.2 "Nuestro cuadro" de cada referencia = desplegable de productos → verificar: las referencias existentes quedan enlazadas a su producto. Hecho: las 9 referencias enlazadas
- [x] 12.3 Propuesta de Meta: un anuncio por referencia con imagen y enlace del producto y textos calcados en estructura; para vídeos, además, guion para grabar → verificar: propuesta de Cuadros con Alma con 3 anuncios y "Imita" de cada uno. Hecho: 3 anuncios con enlace a su cuadro y guion de vídeo en los 2 de vídeo. Pendiente de revisión de María (frase de fundadora calcada de StarminStudio; frase entre comillas que parece testimonio)
- [x] 12.4 Propuesta de Google: un anuncio por referencia, calcado en estructura, con el enlace de su producto o la tienda → verificar: propuesta de Cuadros con Alma con un anuncio por referencia de Google. Hecho: 4 anuncios válidos de 6 referencias (la IA a veces da títulos de más de 30: se descartan; el error ya dice qué llegó). Lector de JSON de la IA más robusto

## 13. Vídeos en los anuncios de Meta

**Petición (María, 02/11/2026):** que Claude cree los vídeos (con las fotos de cada cuadro, estilo de la prueba de La oveja que faltaba), pero que AdEngine deje editar cada anuncio y subir su propio vídeo o imagen.

- [x] 13.1 Almacén de archivos: Vercel Blob `adengine-media` (público, enlazado al proyecto; `BLOB_READ_WRITE_TOKEN`). Público porque Meta descarga el vídeo por su enlace
- [x] 13.2 En la propuesta de Meta, cada anuncio con "Cambiar por mi vídeo o imagen": el navegador sube el archivo directo al almacén (sin el límite de 4,5 MB) y AdEngine lo pasa a Meta; el vídeo guarda como miniatura la imagen del anuncio → verificar: subir el vídeo de prueba a un anuncio de Cuadros con Alma, se ve en la tarjeta y Meta lo procesa. Hecho (02/11/2026): vídeo de prueba subido al almacén y puesto en el anuncio 1 de Cuadros con Alma; Meta lo da por listo (8,3 s) con la foto del cuadro de miniatura. La subida desde el navegador (botón del panel) la prueba María
- [ ] 13.3 Vídeos de Claude para los anuncios de vídeo (La oveja que faltaba, Calvario al alba) con la música que elija María de la Sound Collection de Meta, subidos por la misma vía

## 14. "Comprar" en la ruta del enlace de Google

**Decisión (María, 02/11/2026):** en búsqueda no hay botón; se pone "comprar" en la ruta visible del enlace (cuadrosconalma.com/comprar/cuadros). Campo en la ficha, se aplica a todos los anuncios de búsqueda al crearlos.

- [ ] 14.1 Campo "Ruta del enlace en Google" (2 partes, 15 caracteres, sin espacios) → `path1`/`path2` del anuncio adaptable → verificar: Cuadros con Alma guardado como comprar / cuadros; al crear la campaña de Google los anuncios lo llevan

## 15. Imágenes en los anuncios de búsqueda de Google

**Petición (María, 02/11/2026).** Al crear la campaña de Google, AdEngine sube las fotos de hasta 3 cuadros (los de sus anuncios, luego los de las referencias de Meta) recortadas a 1,91:1 y 1:1 y las enlaza a la campaña (AD_IMAGE). Google decide cuándo enseñarlas; si la cuenta aún no las admite, se apunta en el historial y la campaña se crea igual.

- [ ] 15.1 Subida y enlace de imágenes al crear la campaña de Google → verificar: al crear la de Cuadros con Alma, línea IMAGENES en el historial y los recursos de imagen enlazados en Google Ads

## 16. Remarketing en Meta

**Petición (María, 02/11/2026):** usar remarketing en Meta desde el principio. Reparto acordado: 80 % captación, 20 % remarketing, dentro del mismo tope.

- [x] 16.1 Públicos por negocio creados por AdEngine desde el píxel: "Visitantes 30 días" (todo el tráfico) y "Compradores 180 días" (Purchase, para excluir). Se guardan en la ficha y se reutilizan → verificar: aparecen en la cuenta de Meta de Cuadros con Alma. Código hecho; se crean al crear la campaña (comprobar entonces)
- [x] 16.2 Al crear la campaña de Meta: conjunto de captación (80 % del tope, público de la ficha) + conjunto de remarketing (20 %, visitantes sin compradores), con los mismos anuncios en los dos. Si el remarketing falla, la campaña se crea igual y se apunta → verificar: dos conjuntos en Meta con 120 € y 30 €. Código hecho; comprobar al crear la de Cuadros con Alma
- [x] 16.3 Métricas y frenos con dos conjuntos: el gasto de los dos anuncios gemelos se suma por día antes de guardarlo; la regla de pausa pausa los dos; el presupuesto y el rehacer/añadir anuncios tocan los dos conjuntos → verificar: `tsc`, build y, con datos, que el gasto del panel cuadra con Meta. `tsc` y build OK; cuadre con datos reales pendiente

Nota: el píxel se instaló el 02/11/2026; Meta necesita ~100 personas en el público para enseñar remarketing, así que ese conjunto gastará poco al principio.

## 17. Cada palabra clave de Google lleva a su página

**Petición (María, 02/11/2026):** las búsquedas de cuadros concretos o temas (Buen Pastor, Virgen María, versículos…) deben aterrizar en esa página, no en la portada. La web ya tiene una página por cuadro y 36 colecciones (/coleccion/…, p. ej. buen-pastor, virgen-maria, versiculos).

- [x] 17.1 Enlace por palabra clave: la IA que elige las palabras asigna a cada una la página más específica de la ficha (cuadro, colección o tienda); se guarda en la palabra y, al crear, va como `finalUrls` de la palabra en Google; desplegable "Lleva a" en la tabla de la propuesta → `tsc` y build OK
- [x] 17.2 Colecciones de la web cargadas como páginas en la ficha de Cuadros con Alma → verificar: aparecen en "Nuestros productos" y en el desplegable. Hecho: 39 colecciones; la sección de productos es plegable
- [x] 17.3 Volver a proponer Google de Cuadros con Alma → verificar: cada palabra con su página (Buen Pastor → /coleccion/buen-pastor, versículos → /coleccion/versiculos…). Hecho: 6 anuncios, 27 palabras, las 27 con página. Arreglado de paso: descripciones de las referencias = dos de 90; acortado en dos rondas sin cortar frases; filtro de rankings/reseñas/cifras ("más regalado", "nº 1", "estrellas"…)

## 18. Google por temas y negocios nuevos sin ayuda

**Petición (María, 02/11/2026):** que cada búsqueda vea la imagen de su cuadro (grupos por tema) y que el siguiente negocio se pueda montar entero desde AdEngine.

- [x] 18.1 Grupos por tema: la IA que elige las palabras las agrupa en 3-7 temas; cada grupo con su página (colección o cuadro) y hasta 2 fotos de cuadros del tema
- [x] 18.2 Un anuncio por grupo, que habla del tema y calca la referencia que mejor le encaje (indica cuál)
- [x] 18.3 Al crear: un grupo de anuncios de Google por tema, con sus palabras, su anuncio (a la página del grupo) y sus fotos (AD_IMAGE a nivel de grupo); las pausas y cambios de puja usan el grupo de cada palabra
- [x] 18.4 Panel: columna "Grupo" en las palabras y el grupo en cada anuncio de la propuesta
- [x] 18.5 Botón "Importar desde la web" en la ficha: lee /sitemap.xml y carga cada página de producto y colección con su título y su foto (og:image o la del sitemap) → verificar con caricaturea.com. Código de 18.1-18.5 hecho, `tsc` y build OK; falta probar en producción
- [x] 18.6 Volver a proponer Google de Cuadros con Alma → verificar: grupos Virgen María, Buen Pastor, versículos… cada uno con su anuncio, su página y sus fotos. Hecho (02/11/2026): 6 grupos (Religiosos modernos, Virgen María, Buen Pastor, Versículos, Jesús y Sagrado Corazón, Regalos), 32 palabras, 6 anuncios, 2 fotos por grupo. Importar probado con Caricaturea: 14 colecciones + 150 diseños con foto (los productos están en /p/: se saltan páginas por palabras, no por ruta). Pendiente: comprobar al crear que Google acepta grupos e imágenes

## 19. Vídeo obligatorio cuando la referencia es un vídeo

**Petición (María, 03/11/2026):** si una referencia de Meta es un vídeo, la propuesta tiene que traer un vídeo parecido hecho con nuestro producto, no una imagen.

**Cómo es hoy:** cada referencia de Meta da un anuncio con la imagen del producto; el vídeo lo monta Claude a mano (ffmpeg + textos renderizados con Chrome) y María lo sube con "Cambiar medio". Ejemplo: `videos/bebes/bebes-tamano-real.mp4` (misma habitación, 6 estilos de lámina, 2 textos, 10 s, 9:16).

**Suposiciones (a confirmar):**
- Los vídeos de referencia que copiamos son "fotos con cortes o zoom + textos encima + música" (los de The Birth Poster, Karykatura, Cuadros con Alma). No grabamos vídeo real ni voz en off.
- Hace falta más de una foto por producto (en el de Bebés: la lámina en varios estilos). Si el producto tiene 1 sola foto, el vídeo se hace con zoom lento sobre esa foto.
- La música es un archivo por negocio que sube María (bajado de la Sound Collection de Meta). Sin música, el vídeo va en silencio.
- Obligatorio = si la referencia es vídeo y el producto no tiene fotos, la propuesta se para con un aviso claro (igual que hoy cuando falta el producto).

**Cómo se monta en el servidor:** ffmpeg dentro de la función de Vercel (paquete `ffmpeg-static`) y una fuente .ttf en el repo para los textos (sin emojis: ffmpeg no pinta emojis de color). Cada vídeo se monta en su propia llamada (máx. 300 s) para no pasarse del tiempo: la propuesta se crea con "vídeo pendiente" y el panel pide los vídeos uno a uno.

**Alternativa descartada por ahora:** montar el vídeo en el navegador de María (canvas + grabadora). Pinta emojis, pero Chrome graba en WebM y no siempre en MP4, y depende de tener la pestaña abierta.

TODOs (uno a uno, cada uno se prueba antes de pasar al siguiente):
- [x] 19.1 Fotos por producto: en "Nuestros productos" cada producto admite varias fotos (subir, ver y quitar) → verificar: subir las 6 láminas de Bebés a un producto y verlas en el panel. Hecho (03/11/2026): las 6 fotos de la lámina de nacimiento (habitación con cómoda, 6 estilos) guardadas en el producto; la subida desde el botón del panel la prueba María
- [x] 19.2 Música por negocio: campo en la ficha para subir un mp3/mp4 → verificar: subir la Pavane a Cuadros con Alma y oírla desde la ficha. Hecho a medias (03/11/2026): campo, subida y aviso «Sin música» en la ficha y en la propuesta; probado el montaje con la Pavane desde el almacén. Falta que María suba la música de cada negocio
- [x] 19.3 Montador `src/lib/video.ts`: fotos + textos con tiempos + música → mp4 9:16 en Blob. Primero en local → verificar: con las 6 láminas sale un vídeo como `bebes-tamano-real.mp4`. Hecho (03/11/2026): 10 s con textos y música en ~5 s
- [x] 19.4 El montador en Vercel (ruta `POST /api/anuncios/[id]/video`) → verificar: generar el vídeo de un anuncio de prueba en producción y que Meta lo dé por listo. Hecho (03/11/2026): anuncio 1 de la propuesta de Bebés montado en 19 s y subido a Meta. El ffmpeg de Linux no trae drawtext: los textos se pintan como imagen con sharp
- [x] 19.5 Guion del vídeo: la IA, a partir de la descripción de la referencia, devuelve escenas (segundos, foto, texto en castellano adaptado) → verificar: con la referencia de The Birth Poster devuelve ~10 s, 6 cortes, "Recuerda lo pequeño que era" / "Diseña la tuya". Hecho (03/11/2026): 10 s, «Recuerda lo pequeñito que era 👶» (0-4 s) / «Diseña la tuya ahora 👉». La 1.ª versión dejó 4 s fijos al final → regla de mantener el ritmo
- [x] 19.6 Propuesta de Meta: referencia de vídeo → anuncio de vídeo (obligatorio; aviso si faltan fotos); el panel monta los vídeos pendientes y los enseña en la tarjeta → verificar: proponer Bebés y que los anuncios de referencias de vídeo salgan con vídeo. Hecho (03/11/2026): propuesta de Bebés con 7 anuncios, el de la referencia de vídeo con guion; «Crear en pausa» se bloquea hasta que estén montados. Ojo: solo cuentan como vídeo las referencias marcadas como vídeo
- [x] 19.7 "Rehacer vídeo con mis comentarios" en la tarjeta (cambiar textos, orden o duración) → verificar: pedir un cambio de texto y que el vídeo nuevo lo lleve. Hecho (03/11/2026): «que se vea el cuadro entero y cambie cada 1,7 s» → vídeo nuevo con el cuadro entero y el ritmo pedido

## 20. Medir la compra de verdad, por negocio, campaña y anuncio (1.1 del plan de validación de MVPs)

**Petición (María, 03/11/2026):** que AdEngine sepa qué campaña y qué anuncio trae cada venta, para decidir si un MVP vende a un coste que deja margen.

**Cómo está hoy (revisado 03/11/2026):**
- Cada web cobra con su Stripe y tiene su webhook (`checkout.session.completed`): Cuadros (`fe/main.py`), Caricaturea (`app/main.py`, en la cuenta Chatsalsa), Bebés (`bp/main.py`). AdEngine NO recibe esas ventas (su webhook `/api/webhooks/stripe` no está dado de alta en ninguna cuenta).
- Las 3 webs ya lanzan en el navegador `track('purchase')` en la página de gracias → Meta recibe `Purchase` del píxel (sin `eventID`, así que no se puede emparejar con un aviso del servidor). Google solo recibe la conversión si `GADS_LABEL` está puesto, y no lo está en ninguna.
- Meta optimiza y AdEngine cuenta "clic a compra" (`InitiateCheckout`), no compras.
- AdEngine ya sabe subir ventas a Google por gclid (`uploadClickConversion`, acción "Venta · negocio" tipo subida), pero nunca le llegan.
- Bebés usa la cuenta de Google de Caricaturea.

**Enfoque (recomendado):** cada web, al cobrar, avisa a AdEngine; AdEngine apunta la venta y se la pasa a Google y a Meta. Un solo sitio que entiende de anuncios para todos los MVP; en cada web, un cambio pequeño y siempre el mismo.
- En la web, al crear el pago de Stripe, se guardan en `metadata` los identificadores del clic: `gclid` (Google), `_fbc`/`_fbp` (Meta), y la página de entrada.
- El webhook de la web, al cobrar, manda a AdEngine `POST /api/ventas` (con una clave por negocio): pedido, importe, email, gclid, fbc, fbp.
- AdEngine: guarda la venta con su canal; si hay gclid la sube a Google (acción "Venta · negocio"); siempre manda `Purchase` a Meta por la API de conversiones (CAPI) con `event_id` = id del pedido. En el navegador, `fbq('track','Purchase', …, {eventID: id del pedido})` para que Meta no la cuente dos veces.
- Google: solo subida desde AdEngine (sin etiqueta en el navegador), así no hay dobles.

**Alternativa descartada:** poner la etiqueta de Google y la CAPI dentro de cada web. Más rápido para una web, pero hay que repetirlo (claves, código) en cada MVP nuevo y AdEngine seguiría sin ver las ventas.

TODOs (uno a uno, cada uno probado antes de pasar al siguiente):
- [x] 20.1 AdEngine: `POST /api/ventas?negocio=…` con clave por negocio (se ve y se copia en la ficha); guarda la venta (pedido único: si llega dos veces no se duplica) → verificar: mandar una venta de prueba con curl, sale en «Ventas registradas»; repetirla no la duplica; sin clave → 401. Hecho (03/11/2026): sin clave, clave mala o de otro negocio → 401; sin importe o texto raro → 400; modo `test: true` comprueba sin guardar. El índice único (negocio, pedido) pedía `--accept-data-loss` en el despliegue: el duplicado se controla en el código. El duplicado real se verá con la 1.ª venta
- [x] 20.2 AdEngine sube a Google la venta con gclid → verificar: venta de prueba con un gclid real de un clic de hoy; Google la acepta (o explica por qué no). Hecho (03/11/2026): Google ya NO admite `uploadClickConversions` a integraciones nuevas → Data Manager API (`events:ingest`, permiso `datamanager`, API habilitada en el proyecto 149248140387, Google reconectado). Validación (`validateOnly`) OK
- [x] 20.3 AdEngine manda `Purchase` a Meta por CAPI (email con hash, fbc, fbp, importe, event_id) → verificar: evento de prueba con el código de prueba del Administrador de eventos; aparece como «Servidor». Hecho (03/11/2026): Meta responde `events_received: 1` (el token del usuario del sistema puede escribir en el píxel de Bebés)
- [ ] 20.4 Web de Bebés: identificadores del clic en el pago de Stripe + aviso a AdEngine en el webhook + `eventID` en el Purchase del navegador → verificar: compra en el entorno de prueba de Stripe de Bebés → venta en AdEngine con canal, y en Meta un único Purchase (navegador + servidor emparejados)
- [ ] 20.5 Lo mismo en Caricaturea → verificar: igual que 20.4 (sin comprar de verdad: evento de prueba de Stripe o compra de 1 €, lo decide María)
- [ ] 20.6 Lo mismo en Cuadros con Alma → verificar: igual
- [ ] 20.7 AdEngine lee de Meta las compras (`purchase`) por anuncio además de los clics a compra, y enseña ventas y coste por venta por campaña y anuncio → verificar: tras 20.4–20.6, la tabla de anuncios muestra compras y coste por compra

**Lo que necesito de María:** confirmar que puedo tocar los 3 repos de las webs (despliegan solos en Render al subir) y cómo probamos 20.5/20.6 (evento de prueba de Stripe o compra real pequeña).

## Pendiente (después)
- [x] Borrada la ruta de diagnóstico `src/app/api/debug/ideas` (01/10/2026)
- [x] App OAuth de Google Cloud publicada ("In production") y Google Ads reconectado (01/10/2026)
- [x] Google Ads conectado; cuenta RankCoworker (9148745988) asignada; campaña creada y activada (01/10/2026)
- ~~Cambiar la contraseña de Neon~~ — descartado por María (01/10/2026)
- [x] Next.js 14.2.15 → 14.2.35 (01/10/2026). Verificado en local: build OK, login 401/200, snippet y track 200, cabecera de bypass del middleware → 401 (también 401 en producción antes del cambio). Quedan avisos que solo se arreglan en Next 15.5+/16 (salto de versión mayor, tarea aparte); casi todos afectan a funciones que no usamos (next/image, Server Actions, rewrites)
- Consent Mode en el banner de Rankcoworker (RGPD)
- Cron: `0 6 * * *` es 08:00 solo en horario de verano
- [x] Google Ads API v22 → v26 (02/11/2026): v22 ya rechazada por Google (400) y el permiso OAuth estaba revocado (`invalid_grant`, reconectado). Desde entonces el cron no leía Google: RankCoworker sin métricas ni frenos. Verificado: campos y enums usados existen en el discovery de v26
