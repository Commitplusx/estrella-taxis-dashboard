# Exclusión de personal del chat de clientes

El teléfono de cualquier contacto `driver`, `owner`, `owner_driver` o `staff`, de una persona vinculada a una unidad, o de un conductor registrado en la base queda fuera de la conversación de atención a clientes cuando `exclude_operational_customers` está activado para esa base. La detección y comparación de teléfonos ocurre dentro de la base correspondiente.

Los textos y ubicaciones de esas personas se descartan antes de crear una sesión o llamar al intérprete, incluso si el número aparece también en la lista de clientes o el piloto acepta clientes nuevos. Si el bloqueo se activa mientras el mensaje esperaba turno, el worker lo vuelve a comprobar antes de iniciar la IA.

La exclusión no altera las ofertas salientes ni el ciclo del chofer. El botón propio de aceptar, rechazar o finalizar se valida contra la oferta, teléfono, unidad, sucursal y estado actuales. Los botones de ofertas caducadas se procesan para devolver la respuesta de no disponibilidad, sin asignar el viaje tarde. Un botón ajeno o de otra sucursal sigue rechazado. La autorización de entrega a conductores y el panel de pausa de emergencia conservan sus propias reglas.

La bandera es por base y por defecto está apagada. En el piloto de Pompeyo se activa después de aplicar la migración `20261101200000_taxi_staff_customer_exclusions`; el modo de atención pública permanece independiente. Para habilitarla o deshabilitarla, se cambia `taxi_bot_customer_access.exclude_operational_customers` de esa base y se incrementa `revision` dentro de una transacción. No se debe añadir teléfonos manuales a una lista global ni cambiar `sucursales`/canales para excluir personal.

La cobertura automatizada valida roles de dueño y chofer, aislamiento de sucursal, lista y modo público, mensajes que esperaban turno, ofertas salientes, aceptación/finalización propias y botones caducados. Esas pruebas no simulan una conversación real de WhatsApp.
