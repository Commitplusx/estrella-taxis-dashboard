import nodemailer from "npm:nodemailer";

Deno.serve(async (req: Request) => {
  // Manejo de CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }

  try {
    const { name, email, password } = await req.json();

    // Configuración de Spacemail
    const transporter = nodemailer.createTransport({
      host: "mail.spacemail.com",
      port: 465,
      secure: true,
      auth: {
        user: "soporte@estrella-eats.mx",
        pass: "Deiff2412",
      },
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #2563eb; text-align: center;">¡Bienvenido a Estrella Taxis!</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Has sido invitado a la plataforma de administración de flotillas de Estrella Taxis.</p>
        <p>Tus credenciales de acceso son:</p>
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <p style="margin: 0;"><strong>Correo:</strong> ${email}</p>
          <p style="margin: 0; margin-top: 8px;"><strong>Contraseña:</strong> ${password}</p>
        </div>
        <p>Por seguridad, te recomendamos cambiar tu contraseña una vez que inicies sesión.</p>
        <br>
        <p>Saludos,<br><strong>El Equipo de Estrella Taxis</strong></p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: '"Soporte Estrella" <soporte@estrella-eats.mx>',
      to: email,
      subject: "Tus accesos para Estrella Taxis 🚖",
      html: html,
    });

    return new Response(JSON.stringify({ success: true, messageId: info.messageId }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/welcome-email' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --data '{"name":"Functions"}'

*/
