import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Configuración WhatsApp Coexistencia</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; margin-top: 100px; background-color: #f0f2f5; }
        .container { background-color: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 500px; margin: auto; }
        h1 { color: #1877f2; }
        button { padding: 15px 30px; font-size: 18px; font-weight: bold; background-color: #1877f2; color: white; border: none; border-radius: 8px; cursor: pointer; transition: background-color 0.3s; }
        button:hover { background-color: #166fe5; }
        p { color: #606770; line-height: 1.5; margin-bottom: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Conexión Segura Meta API</h1>
        <p>Estrella Eats - Haz clic en el botón para iniciar sesión con Meta y generar tu Código QR de Coexistencia. Escanéalo con tu App de WhatsApp Business.</p>
        
        <button onclick="launchWhatsAppSignup()">Generar Código QR</button>
    </div>

    <script>
      window.fbAsyncInit = function() {
        FB.init({
          appId      : '1663378581434704', 
          cookie     : true,
          xfbml      : true,
          version    : 'v19.0'
        });
      };

      (function(d, s, id) {
        var js, fjs = d.getElementsByTagName(s)[0];
        if (d.getElementById(id)) return;
        js = d.createElement(s); js.id = id;
        js.src = "https://connect.facebook.net/es_LA/sdk.js";
        fjs.parentNode.insertBefore(js, fjs);
      }(document, 'script', 'facebook-jssdk'));

      function launchWhatsAppSignup() {
        FB.login(function(response) {
          if (response.authResponse) {
            console.log('Conexión exitosa', response);
            alert("¡Proceso completado! Si Meta te dio el QR, ya estás conectado.");
          } else {
            console.log('Cancelado por el usuario');
          }
        }, {
          scope: 'whatsapp_business_management,whatsapp_business_messaging',
          extras: { setup: { "metadata": "estrella_eats_setup" } }
        });
      }
    </script>
</body>
</html>
`

serve(async (req) => {
  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(html, {
    status: 200,
    headers: headers,
  });
})
