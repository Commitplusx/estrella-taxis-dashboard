const YCLOUD_API_KEY = Deno.env.get('YCLOUD_API_KEY');

if (!YCLOUD_API_KEY) {
  console.error("Falta YCLOUD_API_KEY. Ejecuta el script pasándola como variable de entorno.");
  Deno.exit(1);
}

async function fetchMessages() {
  let allMessages: any[] = [];
  let page = 1;
  let hasMore = true;
  let url = 'https://api.ycloud.com/v2/whatsapp/messages?limit=100';

  console.log("Iniciando descarga de historial de Ycloud...");

  while (hasMore && allMessages.length < 2000) {
    console.log(`Petición página ${page}... URL: ${url}`);
    const res = await fetch(url, {
      headers: {
        'X-API-Key': YCLOUD_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      console.error("Error fetching messages:", await res.text());
      break;
    }

    const data = await res.json();
    if (data.items && data.items.length > 0) {
      allMessages = allMessages.concat(data.items);
      console.log(`Descargados ${allMessages.length} mensajes en total...`);
    } else {
      hasMore = false;
    }

    // Ycloud paginación basada en cursor
    if (data.pageInfo && data.pageInfo.hasNextPage) {
       url = `https://api.ycloud.com/v2/whatsapp/messages?limit=100&pageAfter=${data.pageInfo.endCursor}`;
    } else if (data.items.length < 100) {
       hasMore = false;
    } else {
       // fallback
       url = `https://api.ycloud.com/v2/whatsapp/messages?limit=100&page=${page + 1}`;
    }
    page++;
  }

  Deno.writeTextFileSync('./historial_ycloud_raw.json', JSON.stringify(allMessages, null, 2));
  console.log(`¡Éxito! Se guardaron ${allMessages.length} mensajes en historial_ycloud_raw.json`);
}

fetchMessages();
