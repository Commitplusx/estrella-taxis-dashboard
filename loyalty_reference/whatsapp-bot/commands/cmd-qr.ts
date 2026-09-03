import { CommandContext } from './command-router.ts'
import { extract10Digits } from '../db.ts'
import { sendWA } from '../whatsapp.ts'
import { generateCloudinaryVIPCard } from '../../_shared/utils.ts'

export async function handleQrCommand(ctx: CommandContext): Promise<Response | null> {
  const { supabase, fromPhone, slashText } = ctx
  const cTel = extract10Digits(slashText.slice(4).trim())
  if (!cTel || cTel.length !== 10) {
    await sendWA(fromPhone, `⚠️ Formato: */qr 9631234567*`)
    return new Response('OK', { status: 200 })
  }

  const { data: cli } = await supabase.from('clientes')
    .select('nombre, puntos, acepta_terminos').eq('telefono', cTel).limit(1).maybeSingle()

  if (!cli) {
    await sendWA(fromPhone, `🔍 Cliente ${cTel} no encontrado. Regístralo primero con /fachada.`)
    return new Response('OK', { status: 200 })
  }

  if (cli.acepta_terminos === false) {
    const { sendWATemplate } = await import('../whatsapp.ts')
    await sendWATemplate(`52${cTel}`, 'estrella_terminos_condiciones', [cli.nombre || 'Cliente'])
    await sendWA(fromPhone, `⏳ El cliente *${cTel}* aún no acepta los términos.\nLe he enviado la solicitud. El QR se enviará automáticamente cuando acepte.`)

    await supabase.from('bot_memory').upsert({
      phone: `pending_qr_${cTel}`,
      history: [{ admin: fromPhone }],
      updated_at: new Date().toISOString()
    })
    return new Response('OK', { status: 200 })
  }

  const nombreCli = cli.nombre ? cli.nombre.split(' ')[0] : 'Cliente'
  const qrImageUrl = generateCloudinaryVIPCard(cTel, nombreCli, cli.puntos || 0, 0, false)
  const { sendVIPCardSmart } = await import('../whatsapp.ts')

  const result = await sendVIPCardSmart(`52${cTel}`, qrImageUrl, cli.nombre || 'Cliente', cli.puntos || 0, cTel)

  if (result && result.ok === false) {
    await sendWA(fromPhone, `❌ Hubo un error al enviar la plantilla: ${result.error}`)
  } else {
    await sendWA(fromPhone, `✅ ¡Tarjeta QR enviada exitosamente a ${cli.nombre || cTel}!`)
  }

  return new Response('OK', { status: 200 })
}
