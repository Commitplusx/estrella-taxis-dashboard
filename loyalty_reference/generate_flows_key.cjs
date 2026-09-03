const crypto = require('crypto');
const fs = require('fs');

console.log('Generando par de llaves RSA (2048 bits) para WhatsApp Flows...');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

fs.writeFileSync('flows_private.pem', privateKey);
fs.writeFileSync('flows_public.pem', publicKey);

console.log('✅ Llaves generadas exitosamente:');
console.log(' - flows_private.pem (Se guardará en Supabase Secrets)');
console.log(' - flows_public.pem (La subirás al WhatsApp Manager)');
