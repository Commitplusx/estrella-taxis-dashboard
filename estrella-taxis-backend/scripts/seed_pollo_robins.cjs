const SUPABASE_URL = 'https://knghdwpxheenkpuajkxl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuZ2hkd3B4aGVlbmtwdWFqa3hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTQ5ODgsImV4cCI6MjEwMDk5MDk4OH0.GYTrjUjrbbcBsZHTPbD5GrPub1ZOoFCe8JuNF9SQoMA';
const TENANT_ID = '6ddfb4b8-9714-4013-af59-e9fd5f1d592a'; // Pollo Robins

const items = [
  // Pollo Robin's Tradicional
  {
    tenant_id: TENANT_ID,
    nombre: "Pollo Robin's 8 Piezas",
    tipo_item: "Pollo",
    precio: 180,
    detalles: { descripcion: "8 piezas de pollo crujiente tradicional Robin's" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Pollo Robin's 6 Piezas",
    tipo_item: "Pollo",
    precio: 145,
    detalles: { descripcion: "6 piezas de pollo crujiente tradicional Robin's" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Pollo Robin's 4 Piezas (Medio Pollo)",
    tipo_item: "Pollo",
    precio: 95,
    detalles: { descripcion: "4 piezas de pollo crujiente Robin's (Medio Pollo)" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Pollo Robin's 2 Piezas",
    tipo_item: "Pollo",
    precio: 50,
    detalles: { descripcion: "2 piezas de pollo crujiente Robin's" },
    disponible: true
  },

  // Pollo Bañado
  {
    tenant_id: TENANT_ID,
    nombre: "Pollo Bañado 8 Piezas",
    tipo_item: "Pollo Bañado",
    precio: 215,
    detalles: { descripcion: "8 piezas bañadas en tu salsa favorita (BBQ, Mango Habanero, Tamarindo Enchilado o Enchilado). Incluye salsa picante y aderezos" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Pollo Bañado 6 Piezas",
    tipo_item: "Pollo Bañado",
    precio: 165,
    detalles: { descripcion: "6 piezas bañadas en tu salsa favorita (BBQ, Mango Habanero, Tamarindo Enchilado o Enchilado)" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Pollo Bañado 4 Piezas",
    tipo_item: "Pollo Bañado",
    precio: 110,
    detalles: { descripcion: "4 piezas bañadas en tu salsa favorita (BBQ, Mango Habanero, Tamarindo Enchilado o Enchilado)" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Pollo Bañado 2 Piezas",
    tipo_item: "Pollo Bañado",
    precio: 60,
    detalles: { descripcion: "2 piezas bañadas en tu salsa favorita (BBQ, Mango Habanero, Tamarindo Enchilado o Enchilado)" },
    disponible: true
  },

  // Combos
  {
    tenant_id: TENANT_ID,
    nombre: "Paquete Llenes (Combo 1)",
    tipo_item: "Combo",
    precio: 89,
    detalles: { descripcion: "2 piezas de Pollo Robin's + 1 complemento + 1 papas fritas + 1 refresco 600 ml" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Paquete Enamores (Combo 2)",
    tipo_item: "Combo",
    precio: 166,
    detalles: { descripcion: "4 piezas de Pollo Robin's (medio pollo) + 1 complemento + 1 papas fritas + 1 refresco 1.5 L" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Paquete Disfrutes (Combo 3)",
    tipo_item: "Combo",
    precio: 211,
    detalles: { descripcion: "6 piezas de Pollo Robin's + 1 complemento + 1 papas fritas + 1 refresco 1.5 L" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Paquete Alcance (Combo 4)",
    tipo_item: "Combo",
    precio: 256,
    detalles: { descripcion: "8 piezas de Pollo Robin's + 1 complemento + 1 papas fritas + 1 refresco 2 L" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Paquete Invites (Combo 5)",
    tipo_item: "Combo",
    precio: 325,
    detalles: { descripcion: "10 piezas de Pollo Robin's + 1 complemento + 2 papas fritas + 1 refresco 2 L" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Paquete Compartas (Combo 6)",
    tipo_item: "Combo",
    precio: 399,
    detalles: { descripcion: "12 piezas de Pollo Robin's + 2 complementos + 2 papas fritas + 1 refresco 3 L" },
    disponible: true
  },

  // Complementos
  {
    tenant_id: TENANT_ID,
    nombre: "Papas Fritas",
    tipo_item: "Complemento",
    precio: 30,
    detalles: { descripcion: "Orden de papas fritas crujientes" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Puré de Papa",
    tipo_item: "Complemento",
    precio: 30,
    detalles: { descripcion: "Puré de papa con gravy tradicional" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Coleslaw (Ensalada de Col)",
    tipo_item: "Complemento",
    precio: 30,
    detalles: { descripcion: "Ensalada de col dulce y fresca" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Coditos con Crema",
    tipo_item: "Complemento",
    precio: 30,
    detalles: { descripcion: "Ensalada fría de coditos con crema" },
    disponible: true
  },

  // Alitas
  {
    tenant_id: TENANT_ID,
    nombre: "Alitas 5 Piezas",
    tipo_item: "Alitas",
    precio: 65,
    detalles: { descripcion: "5 alitas con tu salsa o dip favorito" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Alitas 10 Piezas",
    tipo_item: "Alitas",
    precio: 119,
    detalles: { descripcion: "10 alitas con tu salsa o dip favorito" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Alitas 15 Piezas",
    tipo_item: "Alitas",
    precio: 169,
    detalles: { descripcion: "15 alitas con tu salsa o dip favorito" },
    disponible: true
  },

  // Boneless
  {
    tenant_id: TENANT_ID,
    nombre: "Boneless 5 Piezas",
    tipo_item: "Boneless",
    precio: 65,
    detalles: { descripcion: "5 piezas de pechuga empanizada boneless" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Boneless 10 Piezas",
    tipo_item: "Boneless",
    precio: 119,
    detalles: { descripcion: "10 piezas de pechuga empanizada boneless" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Boneless 15 Piezas",
    tipo_item: "Boneless",
    precio: 169,
    detalles: { descripcion: "15 piezas de pechuga empanizada boneless" },
    disponible: true
  },

  // Nuggets
  {
    tenant_id: TENANT_ID,
    nombre: "Nuggets 10 Piezas",
    tipo_item: "Nuggets",
    precio: 79,
    detalles: { descripcion: "10 nuggets de pollo crujientes" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Nuggets 15 Piezas",
    tipo_item: "Nuggets",
    precio: 99,
    detalles: { descripcion: "15 nuggets de pollo crujientes" },
    disponible: true
  },

  // Dips
  {
    tenant_id: TENANT_ID,
    nombre: "Dip Salsa BBQ",
    tipo_item: "Dips",
    precio: 19,
    detalles: { descripcion: "Salsa BBQ porción individual" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Dip Ranch",
    tipo_item: "Dips",
    precio: 19,
    detalles: { descripcion: "Aderezo ranch individual" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Dip Mango Habanero",
    tipo_item: "Dips",
    precio: 19,
    detalles: { descripcion: "Salsa mango habanero picante" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Dip Tamarindo Enchilado",
    tipo_item: "Dips",
    precio: 19,
    detalles: { descripcion: "Salsa agridulce tamarindo enchilado" },
    disponible: true
  },
  {
    tenant_id: TENANT_ID,
    nombre: "Dip Enchilado",
    tipo_item: "Dips",
    precio: 19,
    detalles: { descripcion: "Salsa enchilada picante" },
    disponible: true
  }
];

async function seed() {
  console.log(`Insertando ${items.length} productos para Pollo Robins vía Edge Function...`);
  
  const promptEmpresa = `Horario de atención: 9am a 5pm, todos los días.
NOTAS INTERNAS:
- "Un pollo" entero equivale a 8 piezas. "Medio Pollo" equivale a 4 piezas.
- Salsas disponibles: BBQ, Ranch, Mango Habanero, Tamarindo Enchilado y Enchilado.
- Complementos: Papas fritas, Puré de papa, Coleslaw y Coditos con crema.
- Combos: Paquete Llenes, Enamores, Disfrutes, Alcance, Invites y Compartas.
- Promoción especial Miércoles: 2 Dips x $29 y 2 Papas x $49.`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ycloud-webhook`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'seed_menu',
      tenant_id: TENANT_ID,
      items,
      prompt_personalizado: promptEmpresa
    })
  });

  const resData = await res.json();
  console.log("Resultado de seed_menu:", res.status, resData);
}

seed();
