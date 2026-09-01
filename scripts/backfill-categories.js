// Script de una sola ejecución: asigna una categoría a cada producto existente
// según su nombre. Se ejecuta contra la base de datos de producción ya
// verificada (proyecto Neon cosme-crm-produccion, branch production).
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const MAPPING = {
  "Adaptador Enchufe Universal": "Electrónica y Tecnología",
  "Alcohol Gel 1L": "Limpieza",
  "Alfombra Goma Entrada": "Hogar y Cocina",
  "Almohada de Viaje": "Accesorios y Viaje",
  "Archivador de Metal 3 Cajones": "Artículos de Oficina",
  "Aspiradora Robot": "Electrodomésticos",
  "Auriculares Bluetooth": "Electrónica y Tecnología",
  "Basurero de Acero Inoxidable": "Hogar y Cocina",
  "Batidora de Mano": "Electrodomésticos",
  "Bolsas de Basura 50x70 x10": "Limpieza",
  "Botella de Agua Reutilizable": "Deporte y Aire Libre",
  "Botiquín Primeros Auxilios": "Seguridad y Protección",
  "Cable USB-C 2 Metros": "Electrónica y Tecnología",
  "Cafetera de Cápsulas": "Electrodomésticos",
  "Candado TSA": "Accesorios y Viaje",
  "Cargador Portátil 10000mAh": "Electrónica y Tecnología",
  "Cartucho Tinta Negra": "Artículos de Oficina",
  "Cinta Métrica 5 Metros": "Herramientas",
  "Cloro Gel 1L": "Limpieza",
  "Copas de Vino x6": "Hogar y Cocina",
  "Cuaderno Universitario 100h": "Artículos de Oficina",
  "Cuchillo de Chef 8 pulgadas": "Hogar y Cocina",
  "Cámara de Seguridad WiFi": "Seguridad y Protección",
  "Cápsulas de Café x50": "Hogar y Cocina",
  "Destructora de Papel": "Artículos de Oficina",
  "Detector de Humo Batería": "Seguridad y Protección",
  "Detergente Líquido 3L": "Limpieza",
  "Disco Duro Externo 2TB": "Electrónica y Tecnología",
  "Dispensador de Agua": "Electrodomésticos",
  "Escoba con Pala": "Limpieza",
  "Escritorio Ajustable Eléctrico": "Artículos de Oficina",
  "Estufa Eléctrica": "Electrodomésticos",
  "Extintor Polvo Químico 1KG": "Seguridad y Protección",
  "Funda para Laptop 14 pulgadas": "Accesorios y Viaje",
  "Guantes de Trabajo": "Herramientas",
  "Hervidor de Agua Eléctrico": "Electrodomésticos",
  "Impresora Multifuncional": "Electrónica y Tecnología",
  "Jabón Líquido Manos 500ml": "Limpieza",
  "Juego de Destornilladores x6": "Herramientas",
  "Juego de Ollas x5": "Hogar y Cocina",
  "Juego de Platos x12": "Hogar y Cocina",
  "Laptop Pro 14 pulgadas": "Electrónica y Tecnología",
  "Lentes de Seguridad": "Seguridad y Protección",
  "Licuadora 1.5L": "Electrodomésticos",
  "Linterna Frontal LED": "Deporte y Aire Libre",
  "Llave Inglesa Ajustable": "Herramientas",
  "Lonchera Térmica": "Hogar y Cocina",
  "Lámpara de Escritorio LED": "Artículos de Oficina",
  "Líquido Limpiapisos 5L": "Limpieza",
  "Maleta de Cabina 20 pulgadas": "Accesorios y Viaje",
  "Marcadores Pizarra x4": "Artículos de Oficina",
  "Martillo Carpintero": "Herramientas",
  "Mascarilla Capilar Hidratante": "Cuidado Personal",
  "Mascarilla con Filtro N95 x10": "Seguridad y Protección",
  "Memoria RAM 16GB": "Electrónica y Tecnología",
  "Microondas 20L": "Electrodomésticos",
  "Micrófono Condensador USB": "Electrónica y Tecnología",
  "Mochila Porta Laptop": "Accesorios y Viaje",
  "Mochila Urbana Resistente": "Accesorios y Viaje",
  "Monitor Curvo 27 pulgadas": "Electrónica y Tecnología",
  "Mouse Inalámbrico Ergonómico": "Electrónica y Tecnología",
  "Navaja Multiusos": "Herramientas",
  "Nivel de Burbuja 30cm": "Herramientas",
  "Olla a Presión Eléctrica": "Electrodomésticos",
  "Papel Carta Resma 500h": "Artículos de Oficina",
  "Papel Higiénico 18 Rollos": "Limpieza",
  "Parlante Bluetooth Impermeable": "Electrónica y Tecnología",
  "Parrilla a Carbón Portátil": "Deporte y Aire Libre",
  "Pizarra Magnética Blanca": "Artículos de Oficina",
  "Plancha a Vapor": "Electrodomésticos",
  "Purificador de Aire": "Electrodomésticos",
  "Refrigerador Mini 45L": "Electrodomésticos",
  "Reloj Inteligente Serie 5": "Electrónica y Tecnología",
  "Repetidor WiFi": "Electrónica y Tecnología",
  "Router WiFi 6": "Electrónica y Tecnología",
  "Sacacorchos Eléctrico": "Hogar y Cocina",
  "Saco de Dormir": "Deporte y Aire Libre",
  "Sartén Antiadherente 24cm": "Hogar y Cocina",
  "Set Herramientas Básicas x40": "Herramientas",
  "Set Lápices Gel x12": "Artículos de Oficina",
  "Set de Cubiertos x24": "Hogar y Cocina",
  "Silla Gamer Élite": "Artículos de Oficina",
  "Silla de Oficina Ergonómica": "Artículos de Oficina",
  "Smartphone Alpha": "Electrónica y Tecnología",
  "Soporte para Monitor": "Artículos de Oficina",
  "Suavizante de Ropa 2L": "Limpieza",
  "Tabla de Cortar de Bambú": "Hogar y Cocina",
  "Tablet 10 pulgadas": "Electrónica y Tecnología",
  "Taladro Inalámbrico 12V": "Herramientas",
  "Taza de Cerámica 300ml": "Hogar y Cocina",
  "Teclado Mecánico RGB": "Electrónica y Tecnología",
  "Termo de Acero Inoxidable 1L": "Deporte y Aire Libre",
  "Tienda de Campaña 4 Personas": "Deporte y Aire Libre",
  "Toallas de Papel Nova x3": "Limpieza",
  "Tostadora 2 Rebanadas": "Electrodomésticos",
  "Trapeador Microfibra Giratorio": "Limpieza",
  "Unidad SSD 1TB": "Electrónica y Tecnología",
  "Vasos de Vidrio x6": "Hogar y Cocina",
  "Ventilador de Torre": "Electrodomésticos",
  "Webcam 1080p": "Electrónica y Tecnología",
};

async function main() {
  const products = await prisma.product.findMany({ select: { id: true, name: true, category: true } });
  console.log(`Total productos en BD: ${products.length}`);
  console.log(`Total en mapping: ${Object.keys(MAPPING).length}`);

  let updated = 0;
  let missing = [];
  for (const p of products) {
    const category = MAPPING[p.name];
    if (!category) {
      missing.push(p.name);
      continue;
    }
    await prisma.product.update({ where: { id: p.id }, data: { category } });
    updated++;
  }

  console.log(`Actualizados: ${updated}`);
  if (missing.length) {
    console.log(`SIN MAPEO (${missing.length}):`);
    missing.forEach((m) => console.log(" - " + m));
  }

  const counts = await prisma.product.groupBy({
    by: ["category"],
    _count: { category: true },
  });
  console.log("Resumen por categoría:");
  counts
    .sort((a, b) => b._count.category - a._count.category)
    .forEach((c) => console.log(`  ${c.category}: ${c._count.category}`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
