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

- UID del producto: `flat_product_pf_300x400-mm_pt_200-gsm-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver`
- Envío: método «Package 48/72». Pedido enviado el 3-nov a las 14:47 y entregado el 5-nov
  a las 9:49 en Barcelona (2 días; Gelato estimaba 6-9 nov).
- Canal: API. El pedido se pagó y entregó sin incidencias.

## Pendiente de conocer

- Lámina 50 × 70 y 70 × 100 (la lámina de nacimiento se imprime en 50 × 70).
- Lienzos (20×30 … 80×120) y marcos.
- Si el envío sube con el tamaño o con varias unidades.

## Margen con los datos que hay

Lámina 30 × 40 de Regalo para Bebés a 31,20 € (IVA incluido):
25,79 € sin IVA − 15,59 € de Gelato − ~0,70 € de Stripe ≈ **9,50 € (30 % del precio de venta)**.
