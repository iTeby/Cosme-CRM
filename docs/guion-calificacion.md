# Guion de calificación

Las preguntas que hay que hacerle a alguien antes de cotizarle. Son 14, en cinco
bloques, y cada una dice para qué sirve: quien pregunta tiene que entender qué
está averiguando, o la respuesta no se aprovecha.

## Dónde está cada cosa

| Pieza | Archivo | Para qué |
|---|---|---|
| Copia canónica del texto | `src/lib/qualification.ts` | Las 14 preguntas, más la versión corta de las 5 que se pueden mandar escritas y los dos mensajes armados |
| Reposición en la base | `prisma/seed-preguntas.ts` (`npm run db:seed:preguntas`) | Crea o actualiza las filas de `qualification_questions` sin tocar respuestas ya guardadas |
| Pantalla suelta | `src/app/(app)/guion/` + `src/components/guion-calificacion.tsx` | Para atender a quien recién llamó o escribió, cuando todavía no hay ficha |
| Ventana sobre la bandeja | `src/components/guion-modal.tsx` + `src/app/api/qualification/route.ts` | El botón "Guion" de una conversación de WhatsApp: se llena mientras se habla y se guarda sin salir del chat |
| Pantalla con la ficha | `src/components/qualification-script.tsx` | Guarda las respuestas del interesado en `qualification_answers` |

Las dos pantallas leen las preguntas de la base, no del archivo: así no hay dos
guiones distintos. Si cambias un texto en `qualification.ts`, corre el seed.

## Por qué las preguntas viven en la base y no en el código

Cada respuesta guardada apunta al `id` de su pregunta. Si las preguntas fueran
una constante del código, cambiar el orden o el texto dejaría las respuestas
viejas apuntando a nada. Por eso están en `qualification_questions` y el archivo
de código es la copia de respaldo, no la fuente que lee la aplicación.

El seed nunca borra: si una pregunta sale del guion, la marca `active = false`.
Borrarla se llevaría las respuestas por el `onDelete: Cascade` de
`qualification_answers`, y esas respuestas son la historia del cliente.

Antes del 19-sep-2026 las 14 filas se habían insertado a mano con SQL y no
existían en ningún archivo: un reseteo de datos dejaba la ficha del interesado
sin nada que preguntar. El seed cierra ese agujero.

## Por qué solo 5 preguntas se mandan escritas

Las 14 son para una conversación. Por escrito, un cuestionario de catorce puntos
no se contesta. Las cinco que quedan son las que alguien responde de una sentada
desde el celular: quién es, a qué se dedica, dónde anota hoy, qué le quita
tiempo y para cuándo lo necesita.

Las que se preguntan hablando y no por escrito, a propósito:

- **El recorrido completo del cliente** (4) pide un relato, y escribiendo se
  contesta con una línea.
- **Lo que le cuesta en plata** (8) suena a interrogatorio si llega en una lista.
- **Quién decide** (10) y **el rango de inversión** (11) espantan por escrito y
  se contestan mal.
- **El cierre** (13 y 14) no tiene sentido sin haber escuchado lo anterior.

## Por qué el mensaje va dentro del enlace y no hay página pública

El botón de WhatsApp abre `wa.me` con el texto escrito, y el de correo abre el
programa de correo con `mailto:`. No hay formulario público, ni enlace con
token, ni tabla nueva, ni envío por Brevo. Tres razones:

1. Un formulario público en el CRM obliga a una ruta sin sesión, tokens por
   interesado y una pantalla más que mantener. Cinco preguntas en el chat donde
   la persona ya está escribiendo se contestan más que un formulario.
2. El correo sale desde la cuenta de Sebastián: queda en Enviados y la respuesta
   le llega a él. Un correo mandado por Brevo desde el Worker no aparece en
   Enviados y necesita el dominio verificado para no caer en spam.
3. Costo $0 y nada nuevo que se pueda romper un martes cualquiera.

**El largo importa.** El texto viaja dentro de la URL, y navegadores y servidores
intermedios truncan URLs largas. El mensaje armado mide 395 caracteres y la URL
codificada 650 (cada tilde y cada salto de línea pasan a ocupar tres). La
pantalla muestra el contador y avisa sobre 500: es un margen, no el punto exacto
donde se corta.

## El número de teléfono es opcional

Si el interesado ya escribió, el chat está abierto: `wa.me` sin número deja
elegir la conversación, y eso evita el error de abrir un chat con un
desconocido por un dígito mal tipeado. Cuando sí se escribe, un número chileno
en cualquier formato —+56 9 1234 5678, 912345678, 91234567— queda normalizado a
los once dígitos que espera el enlace. Si no alcanza a ser un número, la pantalla
lo dice y no lo pone en la URL.

## La ventana sobre la bandeja de WhatsApp

El botón **Guion** de cada conversación abre el guion encima del chat. Es para
el momento en que alguien escribe o llama: se anota mientras se conversa, sin
cambiar de pantalla y perder el hilo de lo que la persona está diciendo.

Dos botones al pie:

- **Mandarle las 5 preguntas** deja el texto escrito en el cuadro de respuesta,
  no lo envía. Es la misma regla de las respuestas rápidas: ningún mensaje sale
  por apretar un botón. El texto es una versión sin saludo —el bot ya saludó al
  principio de la conversación, y volver a presentarse suena a mensaje
  automático. Si la ventana de 24 horas está cerrada, el botón queda apagado.
- **Guardar en la ficha** escribe las respuestas en `qualification_answers`. Si
  el teléfono todavía no tiene ficha, la crea antes con la misma ruta que usa
  "Pasar a Clientes" (`/api/whatsapp/customer`), que busca por teléfono y no
  duplica: apretar dos veces no ensucia la cartera. El botón lo dice: mientras
  no hay ficha se lee "Crear ficha y guardar".

Las preguntas y lo ya respondido llegan de `GET /api/qualification?wa_id=…`, que
busca la ficha por teléfono con el mismo criterio. Así, si el interesado ya había
contestado algo en una conversación anterior, la ventana lo muestra en vez de
pedirlo de nuevo.
