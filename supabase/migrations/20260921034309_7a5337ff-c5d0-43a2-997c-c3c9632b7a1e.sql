UPDATE pfg_orders o
SET items = sub.new_items,
    updated_at = now()
FROM (
  SELECT
    o2.id,
    jsonb_agg(
      jsonb_build_object(
        'productId', COALESCE(li->>'ProductKey', li->>'DeliveryDetailProductKey'),
        'itemNumber', COALESCE(li->'DeliveryDetailUnitOfMeasures'->0->>'ProductNumber', li->>'ProductKey'),
        'name', COALESCE(NULLIF(li->>'ProductDescription', ''), 'Unknown'),
        'brand', li->>'ProductBrand',
        'quantity', COALESCE((li->'DeliveryDetailUnitOfMeasures'->0->>'QuantityOrdered')::numeric, 0),
        'quantityShipped', COALESCE((li->'DeliveryDetailUnitOfMeasures'->0->>'QuantityShipped')::numeric, 0),
        'unit', 'CS',
        'packSize', li->'DeliveryDetailUnitOfMeasures'->0->>'ProductPackSize',
        'price', COALESCE(
          NULLIF((li->'DeliveryDetailUnitOfMeasures'->0->>'UnitPrice')::numeric, 0),
          CASE
            WHEN COALESCE((li->'DeliveryDetailUnitOfMeasures'->0->>'QuantityOrdered')::numeric, 0) > 0
              THEN ROUND(COALESCE((li->>'ExtendedPrice')::numeric, 0)
                   / (li->'DeliveryDetailUnitOfMeasures'->0->>'QuantityOrdered')::numeric, 4)
          END,
          0
        ),
        'total', COALESCE((li->>'ExtendedPrice')::numeric, 0),
        'isCatchWeight', COALESCE((li->'DeliveryDetailUnitOfMeasures'->0->>'IsCatchWeight')::boolean, false),
        'isShorted', COALESCE((li->>'IsProductShorted')::boolean, false)
      )
      ORDER BY ord
    ) AS new_items
  FROM pfg_orders o2,
       LATERAL jsonb_array_elements(o2.items) WITH ORDINALITY AS t(li, ord)
  WHERE o2.items IS NOT NULL
    AND jsonb_array_length(o2.items) > 0
    AND o2.items->0 ? 'ProductKey'
    AND NOT (o2.items->0 ? 'itemNumber')
  GROUP BY o2.id
) sub
WHERE o.id = sub.id;