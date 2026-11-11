# Costes de Gelato (imprenta)

Fuente única de costes de impresión y envío para las webs que imprimen con Gelato
(Regalo para Bebés, Caricaturea, Cuadros con Alma). Sirve para calcular márgenes y el
`marginPct` de las fichas de AdEngine. Añadir aquí cada dato nuevo con su fecha y origen.

Gelato factura a Comartinvi con IVA 0,00 €: los importes son netos. Los precios de las
webs llevan IVA incluido (21 %), así que el margen se calcula sobre precio / 1,21.

## Datos reales (de pedidos)

| Producto | Tamaño | Producto | Envío a España | Recargo transportista | Total | Fecha | Origen |
|---|---|---|---|---|---|---|---|
| Premium Matte Poster 200 g (lámina sin marco) | 30 × 40 cm | 7,90 € | 7,39 € | 0,30 € | **15,59 €** | 2026-11-03 | Pedido RB2611024993BA (prueba interna, Regalo para Bebés) |

| Premium Matte Poster 200 g (lámina sin marco) | 50 × 70 cm | 18,37 € | 7,39 € | 0,30 € | **26,06 €** | 2026-11 | Pedido de prueba «poster» (cancelado por un fallo del archivo; el precio es el que cotizó Gelato) |
| Canvas, bastidor de madera slim (lienzo) | 20 × 30 cm | 11,89 € | 6,69 € | — | **18,58 €** | 2026-11-02 | Pedido HInft2zVHTvoGpTQWy2I6g (compra de prueba de María en Caricaturea) |

- UID lienzo 20 × 30: `canvas_200x300-mm-8x12-inch_canvas_wood-fsc-slim_4-0_ver`. Enviado el 2-nov y entregado el 3-nov (1 día).
- UID 50 × 70: `flat_product_pf_500x700-mm_pt_200-gsm-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver`
- El envío «Package 48/72» cuesta lo mismo (7,39 € + 0,30 €) en 30 × 40 y en 50 × 70.
- UID 30 × 40: `flat_product_pf_300x400-mm_pt_200-gsm-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver`
- Envío: método «Package 48/72». Pedido enviado el 3-nov a las 14:47 y entregado el 5-nov
  a las 9:49 en Barcelona (2 días; Gelato estimaba 6-9 nov).
- Canal: API. El pedido se pagó y entregó sin incidencias.

## Pendiente de conocer

- Lámina 70 × 100 (trillizos).
- Lienzos de 30×40 en adelante y marcos.
- Si el envío sube con el tamaño o con varias unidades.

## Margen con los datos que hay

Lámina 30 × 40 de Regalo para Bebés a 31,20 € (IVA incluido):
25,79 € sin IVA − 15,59 € de Gelato − ~0,70 € de Stripe ≈ **9,50 € (30 % del precio de venta)**.

Lámina de nacimiento 50 × 70 de Regalo para Bebés a 63,20 € (IVA incluido):
52,23 € sin IVA − 26,06 € de Gelato − ~1,20 € de Stripe ≈ **25 € (39 % del precio de venta)**.
Con el 10 % del correo de recuperación (56,88 €): ≈ 19,80 €.
Archivo digital a 19,90 €: 16,45 € sin IVA − ~0,55 € de Stripe ≈ **15,90 €**.

Lienzo 20 × 30 de Caricaturea a 35,90 € (IVA incluido):
29,67 € sin IVA − 18,58 € de Gelato − ~0,80 € de Stripe ≈ **10,30 € (29 % del precio de venta)**.
