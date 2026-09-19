// El guion de calificación de Cosme SpA, en código.
//
// Las 14 preguntas viven en la tabla `qualification_questions` de la base,
// porque la ficha del interesado guarda cada respuesta apuntando al id de su
// pregunta. Este archivo es la copia canónica de ese contenido: sirve para
// restaurarlo si la base se vuelve a sembrar (`npm run db:seed:preguntas`),
// para poder leer el guion sin abrir un cliente SQL, y para armar los dos
// mensajes que se le mandan al interesado.
//
// Si cambias una pregunta acá, corre el seed: la pantalla del guion y la ficha
// leen de la base, no de este archivo.

export interface PreguntaGuion {
  position: number;
  block: string;
  text: string;
  /// Por qué se pregunta. No se le muestra al interesado: es para quien pregunta.
  reason: string;
  /// Versión corta y en tono de mensaje, para las 5 que se mandan por WhatsApp
  /// o correo. `null` = esa pregunta solo se hace hablando, porque por escrito
  /// espanta (presupuesto, quién decide) o pide un relato largo.
  corta: string | null;
}

export const PREGUNTAS_GUION: PreguntaGuion[] = [
  {
    position: 1,
    block: "Quién es",
    text: "¿Cuál es tu nombre y el de tu negocio?",
    reason: "Identifica al interesado y abre la ficha.",
    corta: "¿Cómo te llamas y cómo se llama tu negocio?",
  },
  {
    position: 2,
    block: "Quién es",
    text: "¿A qué se dedica el negocio y hace cuánto funciona?",
    reason: "Rubro y madurez. Un negocio de dos meses y uno de diez años necesitan cosas distintas.",
    corta: "¿A qué se dedica?",
  },
  {
    position: 3,
    block: "Quién es",
    text: "¿Cuántas personas trabajan en él, contándote a ti?",
    reason: "Tamaño real. Define si el sistema es para una persona o para un equipo con roles.",
    corta: null,
  },
  {
    position: 4,
    block: "Cómo trabaja hoy",
    text: "Cuéntame cómo llega un cliente tuyo desde que te contacta hasta que le cobras.",
    reason: "La pregunta central. Radiografía el flujo real: reservas, pedidos, atención, cobro.",
    corta: null,
  },
  {
    position: 5,
    block: "Cómo trabaja hoy",
    text: "¿Dónde anotas hoy los pedidos, las horas o el stock: cuaderno, WhatsApp, Excel, alguna app?",
    reason: "Herramientas actuales. Lo que se va a reemplazar o a integrar.",
    corta: "¿Dónde anotas hoy los pedidos o las horas?",
  },
  {
    position: 6,
    block: "Cómo trabaja hoy",
    text: "¿Cuántos clientes o pedidos atiendes en una semana normal?",
    reason: "Volumen. Separa lo que se resuelve con un formulario de lo que necesita un sistema.",
    corta: null,
  },
  {
    position: 7,
    block: "Dónde duele",
    text: "¿Qué es lo que más tiempo te quita o más errores te produce cada semana?",
    reason: "El cuello de botella declarado. Es lo que el Diagnóstico va a revisar primero.",
    corta: "¿Qué es lo que más tiempo te quita cada semana?",
  },
  {
    position: 8,
    block: "Dónde duele",
    text: "¿Qué te está costando plata hoy por no tener esto resuelto: horas perdidas, clientes que no vuelven, errores de cobro?",
    reason: "Traduce el dolor a costo. Sin esto no hay forma de justificar una inversión.",
    corta: null,
  },
  {
    position: 9,
    block: "Dónde duele",
    text: "¿Ya probaste alguna solución antes? ¿Qué pasó?",
    reason: "Historial. Evita repetir lo que ya falló y revela expectativas.",
    corta: null,
  },
  {
    position: 10,
    block: "Decisión",
    text: "¿Quién toma la decisión de contratar esto y quién más tiene que estar de acuerdo?",
    reason: "Identifica al que firma. Si no es quien escribe, la conversación cambia.",
    corta: null,
  },
  {
    position: 11,
    block: "Decisión",
    text: "¿Tienes un rango de inversión en mente, o prefieres que te oriente con el catálogo?",
    reason: "Presupuesto sin incomodar. Ubica al interesado entre el Diagnóstico, una Pieza, un Sistema o algo a medida.",
    corta: null,
  },
  {
    position: 12,
    block: "Decisión",
    text: "¿Para cuándo necesitas tenerlo funcionando, y por qué esa fecha?",
    reason: "Urgencia real. Una fecha con motivo es una venta; una fecha sin motivo es una consulta.",
    corta: "¿Para cuándo necesitas tenerlo funcionando?",
  },
  {
    position: 13,
    block: "Cierre",
    text: "Con lo que me cuentas, el primer paso es el Diagnóstico Técnico: una sesión de 60 minutos, informe y cotización, por $80.000 que se descuentan del proyecto si sigues con nosotros. ¿Te acomoda partir por ahí, o prefieres una cotización directa?",
    reason: "Propone el camino y bifurca el flujo: Diagnóstico o cotización.",
    corta: null,
  },
  {
    position: 14,
    block: "Cierre",
    text: "¿Por qué medio prefieres que te mande la propuesta, y a qué correo va la factura?",
    reason: "Cierra la logística y deja listo el siguiente paso.",
    corta: null,
  },
];

/// Las 5 que se pueden mandar escritas, en el orden del guion.
export const PREGUNTAS_CORTAS = PREGUNTAS_GUION.filter((p) => p.corta !== null);

/// Tope práctico de un mensaje de wa.me. No lo impone WhatsApp: lo imponen los
/// navegadores y los servidores intermedios que truncan URLs largas. Ojo que la
/// URL queda más larga que el texto —cada tilde y cada salto de línea se
/// escriben con tres caracteres al codificarla—, así que 500 es un margen, no
/// el punto exacto donde se corta. La pantalla avisa al acercarse.
export const LARGO_MAXIMO_WHATSAPP = 500;

function listaCorta(): string {
  return PREGUNTAS_CORTAS.map((p, i) => `${i + 1}. ${p.corta}`).join("\n");
}

export function mensajeWhatsApp(): string {
  return [
    "Hola, soy Sebastián de Cosme SpA.",
    "",
    "Para proponerte algo que te sirva, necesito cinco cosas:",
    "",
    listaCorta(),
    "",
    "Respóndeme por acá con lo que tengas a mano y te digo qué se puede hacer y cuánto cuesta.",
  ].join("\n");
}

/// La misma lista, sin presentarse: dentro de una conversación de WhatsApp que
/// ya va andando, el bot ya saludó y volver a decir "hola, soy Sebastián" suena
/// a mensaje automático.
export function mensajeChat(): string {
  return [
    "Para proponerte algo que te sirva necesito cinco cosas:",
    "",
    listaCorta(),
    "",
    "Respóndeme con lo que tengas a mano y te digo qué se puede hacer y cuánto cuesta.",
  ].join("\n");
}

export const ASUNTO_CORREO = "Cinco preguntas para armar tu propuesta — Cosme SpA";

export function cuerpoCorreo(): string {
  return [
    "Hola:",
    "",
    "Gracias por escribir. Para proponerte algo que de verdad te sirva —y no una lista de funciones que no vas a usar— necesito entender cómo trabajas hoy. Son cinco preguntas:",
    "",
    listaCorta(),
    "",
    "Con tus respuestas te digo qué se puede hacer, en cuánto tiempo y cuánto cuesta. Si preferimos conversarlo, el primer paso es el Diagnóstico Técnico: una sesión de 60 minutos, informe escrito y cotización, y su valor se descuenta del proyecto si sigues adelante.",
    "",
    "Saludos,",
    "Sebastián Velásquez",
    "Asesoría, Consultoría e Inversiones Cosme SpA",
    "cosmespa.cl",
  ].join("\n");
}

/// El guion completo en texto plano, para pegarlo en una nota o imprimirlo.
export function guionCompletoEnTexto(preguntas: { position: number; block: string; text: string }[]): string {
  const lineas: string[] = ["Guion de calificación — Cosme SpA", ""];
  let bloqueActual = "";
  for (const p of preguntas) {
    if (p.block !== bloqueActual) {
      bloqueActual = p.block;
      lineas.push(bloqueActual.toUpperCase());
    }
    lineas.push(`${p.position}. ${p.text}`);
    lineas.push("");
  }
  return lineas.join("\n").trimEnd();
}

/// Un número chileno escrito como sea —+56 9 1234 5678, 912345678, 56912345678—
/// queda en el formato que espera wa.me: solo dígitos, con el 56 adelante.
/// Devuelve null si no alcanza a ser un número: entonces se abre WhatsApp sin
/// destinatario y él elige el chat, que es lo normal cuando el cliente ya escribió.
export function normalizarNumeroChile(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, "");
  if (digitos.length === 0) return null;
  if (digitos.startsWith("56") && digitos.length === 11) return digitos;
  if (digitos.length === 9 && digitos.startsWith("9")) return `56${digitos}`;
  if (digitos.length === 8) return `569${digitos}`;
  return null;
}
