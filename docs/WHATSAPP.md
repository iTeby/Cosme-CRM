# Bandeja de WhatsApp

Ruta: `/whatsapp`. Acceso exclusivo a la cuenta activa `isebi@me.com` (cuenta de Sebastián verificada en Usuarios del CRM), comprobada en base de datos tanto en la página como en cada petición API.

El CRM consulta al Worker `cosme-whatsapp-bot` desde su servidor. El navegador nunca recibe credenciales de Meta ni el secreto de integración. Los historiales siguen almacenados en D1 y respaldados en Sheets.

## Configuración

- Vercel, producción: `WHATSAPP_INTEGRATION_SECRET`.
- Cloudflare, Worker del bot: `CRM_INTEGRATION_SECRET`.
- Ambos secretos deben tener el mismo valor aleatorio de al menos 32 caracteres.
- Las acciones POST exigen que el origen del navegador coincida con el de la petición al CRM.

El Worker expone `/integrations/crm` y `/integrations/crm/:telefono`, con autenticación Bearer y respuestas sin caché. El panel `/admin` conserva su protección de Cloudflare Access. Si Access protege el dominio completo, se necesita una política de servicio específica para la integración; no abrir el panel administrativo.

## Uso y límites

La bandeja consulta cada 30 segundos mientras está visible. Los borradores se conservan en memoria por conversación, no al cerrar o recargar la página. Se muestran los últimos 300 contactos y hasta 500 mensajes recientes de cada conversación.

Tomar una conversación o responder pausa el bot y el seguimiento. El servidor comprueba la ventana de 24 horas antes de enviar. No se reintentan envíos humanos automáticamente: ante un error ambiguo, revisar el historial antes de reenviar. La aceptación de la API no confirma entrega al teléfono.

Las respuestas se guardan en el historial compartido y se respaldan por el circuito existente de Sheets. La integración no crea clientes del CRM automáticamente.
